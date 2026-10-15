import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';

import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import { normalizePeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import {
    createOrderedCatchupCoordinator,
    type OrderedCatchupCoordinatorOptions,
} from '../../services/mediators/hyperswarm/src/ordered-catchup-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { createBulkWorkScheduler } from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';

const peerKey = 'a'.repeat(64);
const bootstrapResult = {
    countBefore: 0,
    countAfter: 0,
    mode: 'snapshot' as const,
    pages: 0,
    exported: 0,
    mapped: 0,
    invalid: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    snapshotComplete: true,
    durationMs: 0,
};

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

function makeOperation(index = 0) {
    const cipher = new CipherNode();
    const unsigned = {
        type: 'create' as const,
        created: new Date(Date.UTC(2026, 7, 1, 12, 0, 0, index)).toISOString(),
        mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
    };
    return {
        ...unsigned,
        signature: {
            signed: unsigned.created,
            hash: cipher.hashJSON(unsigned),
            value: 'signature',
        },
    };
}

const importResult = {
    knownIds: [],
    persistedIds: [],
    pendingIds: [],
    capacityDeferredIds: [],
    retryable: false,
};

function createCoordinator(overrides: Partial<Pick<
    OrderedCatchupCoordinatorOptions,
    | 'getConnection'
    | 'importPipeline'
    | 'onFailure'
    | 'onIndexRefreshed'
    | 'onProtocolViolation'
    | 'bulkReads'
    | 'operationPages'
    | 'sendBulkToPeer'
    | 'sendToPeer'
    | 'syncStore'
>> = {}) {
    const connection = {
        capabilities: normalizePeerCapabilities({
            orderedCatchup: true,
            orderedCatchupVersion: 1,
        }),
    } as ConnectionInfo;
    const importPipeline = {
        waitForIdle: jest.fn(async () => undefined),
        refreshIndex: jest.fn(async () => bootstrapResult),
    } as unknown as ImportPipeline;
    const sendToPeer = overrides.sendToPeer ?? (() => true);
    return createOrderedCatchupCoordinator({
        version: 1,
        maxOpsPerPage: 256,
        maxBytesPerPage: 1_000_000,
        idleTimeoutMs: 120_000,
        syncStore: overrides.syncStore ?? new InMemoryOperationSyncStore(),
        importPipeline: overrides.importPipeline ?? importPipeline,
        syncStats: createMediatorSyncStats(),
        cipher: new CipherNode(),
        bulkReads: overrides.bulkReads ?? createBulkWorkScheduler(2),
        operationPages: overrides.operationPages ?? createOperationPageBudget(5, 5_000_000),
        getConnection: overrides.getConnection ?? (key => key === peerKey ? connection : undefined),
        createSessionId: () => 'session',
        createBaseMessage: type => ({ type, time: '', node: '', relays: [] }),
        sendToPeer,
        sendBulkToPeer: overrides.sendBulkToPeer ?? (async (key, message) => sendToPeer(key, message)),
        onIndexRefreshed: overrides.onIndexRefreshed ?? jest.fn(async () => undefined),
        onComplete: jest.fn(async () => false),
        onHandoffDeferred: jest.fn(async () => undefined),
        onFailure: overrides.onFailure ?? jest.fn(async () => undefined),
        onProtocolViolation: overrides.onProtocolViolation ?? jest.fn(),
    });
}

describe('ordered catch-up coordinator shutdown', () => {
    it('drains an asynchronous client failure callback', async () => {
        let releaseFailure!: () => void;
        let markFailureStarted!: () => void;
        const failureStarted = new Promise<void>(resolve => {
            markFailureStarted = resolve;
        });
        const onFailure = jest.fn(() => new Promise<void>(resolve => {
            releaseFailure = resolve;
            markFailureStarted();
        }));
        const coordinator = createCoordinator({ onFailure });

        expect(coordinator.createClientSession(peerKey, 'client-session')).toBe(true);
        coordinator.removePeer(peerKey, 'disconnect');
        await failureStarted;
        let shutdownSettled = false;
        const shutdown = coordinator.shutdown().then(() => { shutdownSettled = true; });
        await nextTurn();
        expect(shutdownSettled).toBe(false);

        releaseFailure();
        await shutdown;
    });

    it('drains an asynchronous transition failure after its completion task exits', async () => {
        let releaseTransition!: () => void;
        let markTransitionStarted!: () => void;
        const transitionStarted = new Promise<void>(resolve => {
            markTransitionStarted = resolve;
        });
        const onIndexRefreshed = jest.fn(() => new Promise<void>(resolve => {
            releaseTransition = resolve;
            markTransitionStarted();
        }));
        let releaseFailure!: () => void;
        let markFailureStarted!: () => void;
        const failureStarted = new Promise<void>(resolve => {
            markFailureStarted = resolve;
        });
        const onFailure = jest.fn(() => new Promise<void>(resolve => {
            releaseFailure = resolve;
            markFailureStarted();
        }));
        const coordinator = createCoordinator({ onFailure, onIndexRefreshed });

        expect(coordinator.createClientSession(peerKey, 'transition-session')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_done',
            time: '',
            node: '',
            relays: [],
            sessionId: 'transition-session',
        });
        await transitionStarted;
        coordinator.removePeer(peerKey, 'disconnect');
        await failureStarted;
        releaseTransition();
        await nextTurn();

        let shutdownSettled = false;
        const shutdown = coordinator.shutdown().then(() => { shutdownSettled = true; });
        await nextTurn();
        expect(shutdownSettled).toBe(false);

        releaseFailure();
        await shutdown;
    });

    it('isolates asynchronous failure callback rejection during shutdown', async () => {
        const coordinator = createCoordinator({
            onFailure: jest.fn(async () => {
                throw new Error('callback failed');
            }),
        });

        expect(coordinator.createClientSession(peerKey, 'failed-session')).toBe(true);
        coordinator.removePeer(peerKey, 'disconnect');
        await expect(coordinator.shutdown()).resolves.toBeUndefined();
    });

    it('fails a client session when an admitted import rejects', async () => {
        const onFailure = jest.fn(async () => undefined);
        const importPipeline = {
            enqueue: jest.fn(async () => { throw new Error('import failed'); }),
            waitForIdle: jest.fn(async () => undefined),
            refreshIndex: jest.fn(async () => bootstrapResult),
        } as unknown as ImportPipeline;
        const coordinator = createCoordinator({ importPipeline, onFailure });
        const unsigned = {
            type: 'create' as const,
            created: '2026-08-01T12:00:00.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
        };
        const operation = {
            ...unsigned,
            signature: {
                signed: '2026-08-01T12:00:00.000Z',
                hash: new CipherNode().hashJSON(unsigned),
                value: 'signature',
            },
        };

        expect(coordinator.createClientSession(peerKey, 'failed-import')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            time: '',
            node: '',
            relays: [],
            sessionId: 'failed-import',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            data: [operation],
        });
        await nextTurn();

        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'ordered_catchup_import_retryable',
        }));
        await coordinator.shutdown();
    });

    it('fails a requested page without penalizing the peer when import capacity is unavailable', async () => {
        const operationPages = createOperationPageBudget(1, 1_000_000);
        const held = operationPages.reserve(1)!;
        const enqueue = jest.fn();
        const onFailure = jest.fn(async () => undefined);
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({
            importPipeline: {
                enqueue,
                waitForIdle: jest.fn(async () => undefined),
                refreshIndex: jest.fn(async () => bootstrapResult),
            } as unknown as ImportPipeline,
            onFailure,
            onProtocolViolation,
            operationPages,
        });
        const operation = makeOperation();

        expect(coordinator.createClientSession(peerKey, 'capacity')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            time: '',
            node: '',
            relays: [],
            sessionId: 'capacity',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            data: [operation],
        });
        await nextTurn();

        expect(enqueue).not.toHaveBeenCalled();
        expect(onProtocolViolation).not.toHaveBeenCalled();
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'ordered_catchup_import_capacity',
        }));
        held.release();
        await coordinator.shutdown();
    });

    it('rejects a current page whose operation ID does not match its content', async () => {
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({ onProtocolViolation });
        const operation = {
            type: 'create' as const,
            created: '2026-08-01T12:00:00.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
            signature: {
                signed: '2026-08-01T12:00:00.000Z',
                hash: 'f'.repeat(64),
                value: 'signature',
            },
        };

        expect(coordinator.createClientSession(peerKey, 'forged-page')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            time: '',
            node: '',
            relays: [],
            sessionId: 'forged-page',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            data: [operation],
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            expect.stringContaining('content ID mismatch'),
            expect.any(Object),
        );
        await coordinator.shutdown();
    });

    it('cancels queued page imports when the peer disconnects', async () => {
        let request: { cancelled?: () => boolean } | undefined;
        let releaseImport!: () => void;
        const importPipeline = {
            enqueue: jest.fn((queued: { cancelled?: () => boolean }) => {
                request = queued;
                return new Promise(resolve => {
                    releaseImport = () => resolve({
                        knownIds: [], persistedIds: [], pendingIds: [],
                        capacityDeferredIds: [], retryable: false,
                    });
                });
            }),
            waitForIdle: jest.fn(async () => undefined),
            refreshIndex: jest.fn(async () => bootstrapResult),
        } as unknown as ImportPipeline;
        const coordinator = createCoordinator({ importPipeline });
        const unsigned = {
            type: 'create' as const,
            created: '2026-08-01T12:00:00.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
        };
        const operation = {
            ...unsigned,
            signature: {
                signed: unsigned.created,
                hash: new CipherNode().hashJSON(unsigned),
                value: 'signature',
            },
        };

        expect(coordinator.createClientSession(peerKey, 'disconnect-import')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            time: '',
            node: '',
            relays: [],
            sessionId: 'disconnect-import',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            data: [operation],
        });

        expect(request?.cancelled?.()).toBe(false);
        coordinator.removePeer(peerKey, 'disconnect');
        expect(request?.cancelled?.()).toBe(true);

        releaseImport();
        await coordinator.shutdown();
    });
});

describe('ordered catch-up request authorization', () => {
    it.each(['ordered_catchup_push', 'ordered_catchup_done'] as const)(
        'rejects unsolicited %s messages for a live session',
        async type => {
            const onProtocolViolation = jest.fn();
            const enqueue = jest.fn(async () => importResult);
            const coordinator = createCoordinator({
                importPipeline: {
                    enqueue,
                    waitForIdle: jest.fn(async () => undefined),
                    refreshIndex: jest.fn(async () => bootstrapResult),
                } as unknown as ImportPipeline,
                onProtocolViolation,
            });
            const operation = makeOperation();

            expect(coordinator.createClientSession(peerKey, 'unsolicited', false)).toBe(true);
            await coordinator.handleMessage(peerKey, type === 'ordered_catchup_push'
                ? {
                    type,
                    time: '',
                    node: '',
                    relays: [],
                    sessionId: 'unsolicited',
                    cursor: { syncOrder: 1, id: operation.signature.hash },
                    hasMore: true,
                    data: [operation],
                }
                : {
                    type,
                    time: '',
                    node: '',
                    relays: [],
                    sessionId: 'unsolicited',
                });

            expect(onProtocolViolation).toHaveBeenCalledWith(
                peerKey,
                `unsolicited_${type}`,
                expect.any(Object),
            );
            expect(enqueue).not.toHaveBeenCalled();
            expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
            await coordinator.shutdown();
        },
    );

    it('rejects an empty push without consuming it as a terminal response', async () => {
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({ onProtocolViolation });

        expect(coordinator.createClientSession(peerKey, 'empty-page')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            time: '',
            node: '',
            relays: [],
            sessionId: 'empty-page',
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
            hasMore: false,
            data: [],
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'empty_ordered_catchup_push',
            expect.any(Object),
        );
        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });

    it('rejects a duplicate page while the next request is outstanding', async () => {
        const onProtocolViolation = jest.fn();
        const importPipeline = {
            enqueue: jest.fn(async () => importResult),
            waitForIdle: jest.fn(async () => undefined),
            refreshIndex: jest.fn(async () => bootstrapResult),
        } as unknown as ImportPipeline;
        const coordinator = createCoordinator({ importPipeline, onProtocolViolation });
        const operation = makeOperation();
        const page = {
            type: 'ordered_catchup_push' as const,
            time: '',
            node: '',
            relays: [],
            sessionId: 'duplicate-page',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: true,
            data: [operation],
        };

        expect(coordinator.createClientSession(peerKey, page.sessionId)).toBe(true);
        await coordinator.handleMessage(peerKey, page);
        await coordinator.handleMessage(peerKey, page);

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'non_advancing_ordered_catchup_cursor',
            expect.any(Object),
        );
        expect(importPipeline.enqueue).toHaveBeenCalledTimes(1);
        await coordinator.shutdown();
    });
});

describe('ordered catch-up server cursors and scheduling', () => {
    function makeCompatibleConnection(): ConnectionInfo {
        return {
            capabilities: normalizePeerCapabilities({
                orderedCatchup: true,
                orderedCatchupVersion: 1,
            }),
        } as ConnectionInfo;
    }

    function createServerStore() {
        const operations = Array.from({ length: 257 }, (_, index) => makeOperation(index));
        const rows = operations.map((operation, index) => ({
            id: operation.signature.hash,
            ts: index,
            syncOrder: index + 1,
            operation,
        }));
        return {
            operations,
            store: {
                count: jest.fn(async () => rows.length),
                countOrdered: jest.fn(async () => rows.length),
                iterateOrdered: jest.fn(async ({ after }: { after?: { syncOrder: number } | null }) => (
                    after ? rows.filter(row => row.syncOrder > after.syncOrder) : rows
                )),
            } as unknown as InMemoryOperationSyncStore,
        };
    }

    it('does not materialize an outbound page when page capacity is unavailable', async () => {
        const operationPages = createOperationPageBudget(1, 1_000_000);
        const held = operationPages.reserve(1)!;
        const { store } = createServerStore();
        const coordinator = createCoordinator({ operationPages, syncStore: store });

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'capacity',
        });

        expect(store.iterateOrdered).not.toHaveBeenCalled();
        held.release();
        await coordinator.shutdown();
    });

    it('requires the exact cursor from the preceding server page', async () => {
        const { operations, store } = createServerStore();
        const sent: Array<Record<string, unknown>> = [];
        const coordinator = createCoordinator({
            syncStore: store,
            sendToPeer: (_key, message) => {
                sent.push(message as unknown as Record<string, unknown>);
                return true;
            },
        });

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'server',
        });
        expect(sent[0]).toMatchObject({
            type: 'ordered_catchup_push',
            hasMore: true,
            cursor: { syncOrder: 256, id: operations[255].signature.hash },
        });

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req',
            time: '',
            node: '',
            relays: [],
            sessionId: 'server',
            cursor: sent[0].cursor as { syncOrder: number; id: string },
        });
        expect(sent[1]).toMatchObject({
            type: 'ordered_catchup_push',
            hasMore: false,
            cursor: { syncOrder: 257, id: operations[256].signature.hash },
        });
        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });

    it.each([
        ['missing', undefined],
        ['regressing', { syncOrder: 255, id: makeOperation(254).signature.hash }],
        ['skipped', { syncOrder: 257, id: makeOperation(256).signature.hash }],
    ])('rejects a %s continuation cursor', async (_case, cursor) => {
        const { store } = createServerStore();
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({ syncStore: store, onProtocolViolation });

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'server',
        });
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req',
            time: '',
            node: '',
            relays: [],
            sessionId: 'server',
            ...(cursor ? { cursor } : {}),
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'unexpected_ordered_catchup_req_cursor',
            expect.any(Object),
        );
        await coordinator.shutdown();
    });

    it('rejects a cursor on the first request of a new session', async () => {
        const { operations, store } = createServerStore();
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({ syncStore: store, onProtocolViolation });

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req',
            time: '',
            node: '',
            relays: [],
            sessionId: 'server',
            cursor: { syncOrder: 1, id: operations[0].signature.hash },
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'unexpected_initial_ordered_catchup_cursor',
            expect.any(Object),
        );
        await coordinator.shutdown();
    });

    it('runs no more than two ordered page reads across peers', async () => {
        const peerKeys = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
        const connection = {
            capabilities: normalizePeerCapabilities({
                orderedCatchup: true,
                orderedCatchupVersion: 1,
            }),
        } as ConnectionInfo;
        const releases: Array<() => void> = [];
        let active = 0;
        let peak = 0;
        const starts: string[] = [];
        const store = {
            count: jest.fn(async () => 1),
            countOrdered: jest.fn(async () => 1),
            iterateOrdered: jest.fn(async () => {
                const index = starts.length;
                starts.push(peerKeys[index]);
                active += 1;
                peak = Math.max(peak, active);
                await new Promise<void>(resolve => releases.push(resolve));
                active -= 1;
                return [];
            }),
        } as unknown as InMemoryOperationSyncStore;
        const coordinator = createCoordinator({
            syncStore: store,
            getConnection: key => peerKeys.includes(key) ? connection : undefined,
        });

        const requests = peerKeys.map((key, index) => coordinator.handleMessage(key, {
            type: 'ordered_catchup_req',
            time: '',
            node: '',
            relays: [],
            sessionId: `server-${index}`,
        }));
        await nextTurn();
        expect(starts).toHaveLength(2);
        expect(peak).toBe(2);

        releases.shift()?.();
        await nextTurn();
        await nextTurn();
        expect(starts).toHaveLength(3);
        for (const release of releases) {
            release();
        }
        await Promise.all(requests);
        expect(peak).toBe(2);
        await coordinator.shutdown();
    });

    it('allows a replacement connection while a stale page read is still active', async () => {
        let connection = makeCompatibleConnection();
        let releaseFirstRead!: () => void;
        let markFirstReadStarted!: () => void;
        const firstReadStarted = new Promise<void>(resolve => {
            markFirstReadStarted = resolve;
        });
        let reads = 0;
        const store = {
            count: jest.fn(async () => 1),
            countOrdered: jest.fn(async () => 1),
            iterateOrdered: jest.fn(async () => {
                reads += 1;
                if (reads === 1) {
                    markFirstReadStarted();
                    await new Promise<void>(resolve => {
                        releaseFirstRead = resolve;
                    });
                }
                return [];
            }),
        } as unknown as InMemoryOperationSyncStore;
        const sent: Array<Record<string, unknown>> = [];
        const coordinator = createCoordinator({
            syncStore: store,
            getConnection: key => key === peerKey ? connection : undefined,
            sendToPeer: (_key, message) => {
                sent.push(message as unknown as Record<string, unknown>);
                return true;
            },
        });

        const staleRequest = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'stale',
        });
        await firstReadStarted;
        coordinator.removePeer(peerKey, 'disconnect');
        connection = makeCompatibleConnection();

        const replacementRequest = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'replacement',
        });
        await nextTurn();
        expect(reads).toBe(1);

        releaseFirstRead();
        await staleRequest;
        await replacementRequest;
        expect(reads).toBe(2);
        expect(sent).toContainEqual(expect.objectContaining({
            type: 'ordered_catchup_done',
            sessionId: 'replacement',
        }));

        expect(sent).not.toContainEqual(expect.objectContaining({ sessionId: 'stale' }));
        await coordinator.shutdown();
    });

    it('does not let a failed stale send clear a replacement session with the same ID', async () => {
        const { store } = createServerStore();
        let connection = makeCompatibleConnection();
        let releaseFirstSend!: (sent: boolean) => void;
        let markFirstSendStarted!: () => void;
        const firstSendStarted = new Promise<void>(resolve => {
            markFirstSendStarted = resolve;
        });
        let sends = 0;
        const coordinator = createCoordinator({
            syncStore: store,
            getConnection: key => key === peerKey ? connection : undefined,
            sendBulkToPeer: async () => {
                sends += 1;
                if (sends === 1) {
                    markFirstSendStarted();
                    return new Promise<boolean>(resolve => {
                        releaseFirstSend = resolve;
                    });
                }
                return true;
            },
        });

        const staleRequest = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'shared-session',
        });
        await firstSendStarted;
        coordinator.removePeer(peerKey, 'disconnect');
        connection = makeCompatibleConnection();
        const replacementRequest = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'shared-session',
        });

        releaseFirstSend(false);
        await Promise.all([staleRequest, replacementRequest]);

        expect(sends).toBe(2);
        expect(coordinator.getPeerState(peerKey).serverSessionId).toBe('shared-session');
        await coordinator.shutdown();
    });

    it('does not cancel another pending bulk job when a server session completes', async () => {
        const { operations, store } = createServerStore();
        jest.spyOn(store, 'iterateOrdered').mockResolvedValue([{
            id: operations[0].signature!.hash,
            ts: 1,
            signedTs: 1,
            syncOrder: 1,
            operation: operations[0],
            insertedAt: 1,
        }]);
        const bulkReads = createBulkWorkScheduler(1);
        let releaseSend!: () => void;
        let markSendStarted!: () => void;
        const sendStarted = new Promise<void>(resolve => {
            markSendStarted = resolve;
        });
        const coordinator = createCoordinator({
            bulkReads,
            syncStore: store,
            sendBulkToPeer: async () => {
                markSendStarted();
                await new Promise<void>(resolve => { releaseSend = resolve; });
                return true;
            },
        });

        const request = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'complete',
        });
        await sendStarted;
        const pending = bulkReads.run(peerKey, async () => 'next');

        releaseSend();
        await request;
        await expect(pending).resolves.toBe('next');
        await coordinator.shutdown();
        await bulkReads.shutdown();
    });

    it('cancels an expired pending page read so the peer can retry', async () => {
        const { store } = createServerStore();
        const bulkReads = createBulkWorkScheduler(1);
        let releaseBlocker!: () => void;
        const blocker = bulkReads.run('other-peer', () => new Promise<void>(resolve => {
            releaseBlocker = resolve;
        }));
        const coordinator = createCoordinator({ bulkReads, syncStore: store });

        const expired = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'expired',
        });
        await nextTurn();
        expect(coordinator.getPeerState(peerKey).serverSessionId).toBe('expired');

        coordinator.expire(Date.now() + 120_001);
        await expect(expired).resolves.toBeUndefined();
        releaseBlocker();
        await blocker;

        await expect(coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', time: '', node: '', relays: [], sessionId: 'retry',
        })).resolves.toBeUndefined();
        await coordinator.shutdown();
        await bulkReads.shutdown();
    });
});
