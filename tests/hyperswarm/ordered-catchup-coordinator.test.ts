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
    acceptedOperations: [],
    portableTerminalOperations: [],
    unaddressableOperations: [],
    retryable: false,
};

function createCoordinator(overrides: Partial<Pick<
    OrderedCatchupCoordinatorOptions,
    | 'getConnection'
    | 'importPipeline'
    | 'onFailure'
    | 'onComplete'
    | 'onHandoffDeferred'
    | 'onIndexRefreshed'
    | 'onProtocolViolation'
    | 'bulkReads'
    | 'operationPages'
    | 'sendBulkToPeer'
    | 'sendToPeer'
    | 'syncStats'
    | 'syncStore'
>> = {}) {
    const connection = {
        capabilities: normalizePeerCapabilities({
            ordered: { count: 1, sourceReady: true },
        }),
        wireVersion: 2,
    } as ConnectionInfo;
    const importPipeline = overrides.importPipeline ?? {
        available: true, recovering: false,
        waitForIdle: jest.fn(async () => undefined),
        refreshIndex: jest.fn(async () => bootstrapResult),
    } as unknown as ImportPipeline;
    const sendToPeer = overrides.sendToPeer ?? (() => true);
    return createOrderedCatchupCoordinator({
        maxOpsPerPage: 256,
        maxBytesPerPage: 1_000_000,
        idleTimeoutMs: 120_000,
        syncStore: overrides.syncStore ?? new InMemoryOperationSyncStore(),
        importPipeline: overrides.importPipeline ?? importPipeline,
        syncStats: overrides.syncStats ?? createMediatorSyncStats(),
        cipher: new CipherNode(),
        bulkReads: overrides.bulkReads ?? createBulkWorkScheduler(2),
        operationPages: overrides.operationPages ?? createOperationPageBudget(5, 5_000_000),
        getConnection: overrides.getConnection ?? (key => key === peerKey ? connection : undefined),
        createSessionId: () => 'session',
        sendToPeer,
        sendBulkToPeer: overrides.sendBulkToPeer ?? (async (key, message) => sendToPeer(key, message)),
        onIndexRefreshed: overrides.onIndexRefreshed ?? jest.fn(async () => undefined),
        onComplete: overrides.onComplete ?? jest.fn(async () => false),
        onHandoffDeferred: overrides.onHandoffDeferred ?? jest.fn(async () => undefined),
        onFailure: overrides.onFailure ?? jest.fn(async () => undefined),
        onProtocolViolation: overrides.onProtocolViolation ?? jest.fn(),
    });
}

describe('ordered catch-up coordinator shutdown', () => {
    it.each(['wait', 'refresh'] as const)('stops a completion transition during %s when shutdown begins', async phase => {
        let release!: () => void;
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        const blocked = jest.fn(async () => {
            markStarted();
            await new Promise<void>(resolve => { release = resolve; });
            return bootstrapResult;
        });
        const importPipeline = {
            available: true,
            waitForIdle: phase === 'wait' ? blocked : jest.fn(async () => undefined),
            refreshIndex: phase === 'refresh' ? blocked : jest.fn(async () => bootstrapResult),
        } as unknown as ImportPipeline;
        const onIndexRefreshed = jest.fn(async () => undefined);
        const onComplete = jest.fn(async () => false);
        const coordinator = createCoordinator({ importPipeline, onComplete, onIndexRefreshed });

        expect(coordinator.createClientSession(peerKey, `shutdown-${phase}`)).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_done', sessionId: `shutdown-${phase}`,
        });
        await started;
        const shutdown = coordinator.shutdown();
        release();
        await shutdown;

        expect(onIndexRefreshed).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('contains a rejected deferred handoff after a completed client session', async () => {
        const onHandoffDeferred = jest.fn(async () => { throw new Error('handoff failed'); });
        const coordinator = createCoordinator({ onHandoffDeferred });

        expect(coordinator.createClientSession(peerKey, 'handoff-error')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_done', sessionId: 'handoff-error',
        });
        await nextTurn();

        expect(onHandoffDeferred).toHaveBeenCalledTimes(1);
        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });

    it.each([true, false])('classifies an epoch-cancelled import separately from other retries: %s', async indexEpochChanged => {
        const onFailure = jest.fn(async () => undefined);
        const importPipeline = {
            available: true, recovering: false,
            enqueue: jest.fn<ImportPipeline['enqueue']>(async (_request, onComplete) => {
                const result = { ...importResult, retryable: true, indexEpochChanged };
                onComplete?.(result);
                return result;
            }),
        } as unknown as ImportPipeline;
        const coordinator = createCoordinator({ onFailure, importPipeline });
        const unsigned = {
            type: 'create' as const,
            created: '2026-01-01T00:00:00.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
        };
        const operation = {
            ...unsigned,
            signature: {
                hash: new CipherNode().hashJSON(unsigned),
                signed: unsigned.created,
                value: 'signature',
            },
        };
        expect(coordinator.createClientSession(peerKey, 'reset-session')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push', sessionId: 'reset-session',
            cursor: { syncOrder: 1, id: operation.signature.hash }, hasMore: false,
            operations: [operation],
        });
        await nextTurn();
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
            reason: indexEpochChanged ? 'gatekeeper_reset' : 'ordered_catchup_import_retryable',
        }));
        await coordinator.shutdown();
    });

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
            available: true, recovering: false,
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
            sessionId: 'failed-import',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: [operation],
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
                available: true,
                recovering: false,
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
            sessionId: 'capacity',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: [operation],
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
            sessionId: 'forged-page',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: [operation],
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
            available: true,
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
            sessionId: 'disconnect-import',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: [operation],
        });

        expect(request?.cancelled?.()).toBe(false);
        coordinator.removePeer(peerKey, 'disconnect');
        expect(request?.cancelled?.()).toBe(true);

        releaseImport();
        await coordinator.shutdown();
    });
});

describe('ordered catch-up request authorization', () => {
    it('fails a client when its prefetched continuation cannot be sent', async () => {
        const operation = makeOperation();
        const onFailure = jest.fn(async () => undefined);
        const importPipeline = {
            available: true,
            enqueue: jest.fn<ImportPipeline['enqueue']>(async (_request, onComplete) => {
                onComplete?.(importResult);
                return importResult;
            }),
            waitForIdle: jest.fn(async () => undefined),
            refreshIndex: jest.fn(async () => bootstrapResult),
        } as unknown as ImportPipeline;
        const coordinator = createCoordinator({ importPipeline, onFailure, sendToPeer: () => false });

        expect(coordinator.createClientSession(peerKey, 'prefetch-failed')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push', sessionId: 'prefetch-failed',
            cursor: { syncOrder: 1, id: operation.signature.hash }, hasMore: true, operations: [operation],
        });
        await nextTurn();

        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'send_ordered_catchup_req_failed',
        }));
        await coordinator.shutdown();
    });

    it('releases a page when import completion throws during prefetch', async () => {
        const operation = makeOperation();
        const sendToPeer = jest.fn<OrderedCatchupCoordinatorOptions['sendToPeer']>()
            .mockImplementationOnce(() => { throw new Error('prefetch failed'); })
            .mockReturnValue(true);
        const importPipeline = {
            available: true,
            enqueue: jest.fn<ImportPipeline['enqueue']>(async (_request, onComplete) => {
                onComplete?.(importResult);
                return importResult;
            }),
        } as unknown as ImportPipeline;
        const operationPages = createOperationPageBudget(1, 1_000_000);
        const coordinator = createCoordinator({ importPipeline, operationPages, sendToPeer });

        expect(coordinator.createClientSession(peerKey, 'completion-error')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push', sessionId: 'completion-error',
            cursor: { syncOrder: 1, id: operation.signature.hash }, hasMore: true, operations: [operation],
        });

        expect(operationPages.getMetrics().pages).toBe(0);
        await coordinator.shutdown();
    });

    it('ignores a repeated terminal response while completion is still draining', async () => {
        let release!: () => void;
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        const importPipeline = {
            available: true,
            waitForIdle: jest.fn(async () => {
                markStarted();
                await new Promise<void>(resolve => { release = resolve; });
            }),
            refreshIndex: jest.fn(async () => bootstrapResult),
        } as unknown as ImportPipeline;
        const coordinator = createCoordinator({ importPipeline });

        expect(coordinator.createClientSession(peerKey, 'terminal')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_done', sessionId: 'terminal',
        });
        await started;
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_done', sessionId: 'terminal',
        });
        release();
        await nextTurn();

        expect(importPipeline.refreshIndex).toHaveBeenCalledTimes(1);
        await coordinator.shutdown();
    });

    it('enforces page bounds before ignoring an unknown session', async () => {
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({ onProtocolViolation });
        const operation = makeOperation();

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'unknown-session',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: Array.from({ length: 257 }, () => operation),
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'invalid_ordered_catchup_push: operation page exceeds 256 operations',
            expect.any(Object),
        );
        await coordinator.shutdown();
    });

    it('does not verify operation content for an unknown bounded session', async () => {
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({ onProtocolViolation });
        const validOperation = makeOperation();
        const operation = {
            ...validOperation,
            signature: { ...validOperation.signature, hash: 'f'.repeat(64) },
        };

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'unknown-session',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: [operation],
        });

        expect(onProtocolViolation).not.toHaveBeenCalled();
        await coordinator.shutdown();
    });

    it.each(['ordered_catchup_push', 'ordered_catchup_done'] as const)(
        'rejects unsolicited %s messages for a live session',
        async type => {
            const onProtocolViolation = jest.fn();
            const enqueue = jest.fn(async () => importResult);
            const coordinator = createCoordinator({
                importPipeline: {
                    available: true,
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
                    sessionId: 'unsolicited',
                    cursor: { syncOrder: 1, id: operation.signature.hash },
                    hasMore: true,
                    operations: [operation],
                }
                : {
                    type,
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
            sessionId: 'empty-page',
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
            hasMore: false,
            operations: [],
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'invalid_ordered_catchup_push: ordered_catchup_push operations must not be empty',
            expect.any(Object),
        );
        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });

    it.each([
        [
            'missing signature',
            () => {
                const operation = makeOperation();
                return {
                    type: operation.type,
                    created: operation.created,
                    mdip: operation.mdip,
                };
            },
            'operation.signature is required',
        ],
        [
            'missing signature hash',
            () => {
                const operation = makeOperation();
                return {
                    ...operation,
                    signature: {
                        signed: operation.signature.signed,
                        value: operation.signature.value,
                    },
                };
            },
            'operation.signature.hash is required',
        ],
        [
            'non-string signature hash',
            () => {
                const operation = makeOperation();
                return { ...operation, signature: { ...operation.signature, hash: 7 } };
            },
            'operation.signature.hash must be a string',
        ],
    ])('rejects a final operation with %s through the protocol path', async (_name, makeMalformed, reason) => {
        const enqueue = jest.fn(async () => importResult);
        const onProtocolViolation = jest.fn();
        const operationPages = createOperationPageBudget(5, 5_000_000);
        const syncStats = createMediatorSyncStats();
        const coordinator = createCoordinator({
            importPipeline: {
                available: true,
                enqueue,
                waitForIdle: jest.fn(async () => undefined),
                refreshIndex: jest.fn(async () => bootstrapResult),
            } as unknown as ImportPipeline,
            onProtocolViolation,
            operationPages,
            syncStats,
        });

        expect(coordinator.createClientSession(peerKey, 'malformed-page')).toBe(true);
        await expect(coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'malformed-page',
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
            hasMore: false,
            operations: [makeMalformed() as never],
        })).resolves.toBeUndefined();

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            expect.stringContaining(reason),
            expect.any(Object),
        );
        expect(enqueue).not.toHaveBeenCalled();
        expect(operationPages.getMetrics().pages).toBe(0);
        expect(syncStats.orderedCatchupPagesReceived).toBe(0);
        expect(syncStats.orderedCatchupOpsReceived).toBe(0);
        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });

    it('rejects duplicate operations within one page before reserving import capacity', async () => {
        const enqueue = jest.fn(async () => importResult);
        const onProtocolViolation = jest.fn();
        const operationPages = createOperationPageBudget(5, 5_000_000);
        const syncStats = createMediatorSyncStats();
        const coordinator = createCoordinator({
            importPipeline: {
                available: true,
                enqueue,
                waitForIdle: jest.fn(async () => undefined),
                refreshIndex: jest.fn(async () => bootstrapResult),
            } as unknown as ImportPipeline,
            onProtocolViolation,
            operationPages,
            syncStats,
        });
        const operation = makeOperation();

        expect(coordinator.createClientSession(peerKey, 'duplicate-operations')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'duplicate-operations',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: [operation, operation],
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'ordered_catchup_push_contains_duplicate_operations',
            expect.any(Object),
        );
        expect(enqueue).not.toHaveBeenCalled();
        expect(operationPages.getMetrics().pages).toBe(0);
        expect(syncStats.orderedCatchupPagesReceived).toBe(0);
        expect(syncStats.orderedCatchupOpsReceived).toBe(0);
        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });

    it('measures each admitted operation page once before import', async () => {
        const enqueue = jest.fn(async () => importResult);
        const coordinator = createCoordinator({
            importPipeline: {
                available: true,
                enqueue,
                waitForIdle: jest.fn(async () => undefined),
                refreshIndex: jest.fn(async () => bootstrapResult),
            } as unknown as ImportPipeline,
        });
        const operation = makeOperation();
        const measuredOperation = { ...operation };
        const toJSON = jest.fn(() => operation);
        Object.defineProperty(measuredOperation, 'toJSON', { value: toJSON });

        expect(coordinator.createClientSession(peerKey, 'measured-page')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'measured-page',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: false,
            operations: [measuredOperation],
        });

        expect(toJSON).toHaveBeenCalledTimes(1);
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
            data: [measuredOperation],
        }), expect.any(Function));
        await coordinator.shutdown();
    });

    it('rejects a duplicate page while the next request is outstanding', async () => {
        const onProtocolViolation = jest.fn();
        const importPipeline = {
            available: true,
            enqueue: jest.fn(async () => importResult),
            waitForIdle: jest.fn(async () => undefined),
            refreshIndex: jest.fn(async () => bootstrapResult),
        } as unknown as ImportPipeline;
        const coordinator = createCoordinator({ importPipeline, onProtocolViolation });
        const operation = makeOperation();
        const page = {
            type: 'ordered_catchup_push' as const,
            sessionId: 'duplicate-page',
            cursor: { syncOrder: 1, id: operation.signature.hash },
            hasMore: true,
            operations: [operation],
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

    it('rejects a page cursor that does not identify its final operation', async () => {
        const onProtocolViolation = jest.fn();
        const enqueue = jest.fn(async () => importResult);
        const coordinator = createCoordinator({
            importPipeline: {
                available: true,
                enqueue,
                waitForIdle: jest.fn(async () => undefined),
                refreshIndex: jest.fn(async () => bootstrapResult),
            } as unknown as ImportPipeline,
            onProtocolViolation,
        });
        const operation = makeOperation();

        expect(coordinator.createClientSession(peerKey, 'mismatched-cursor')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'mismatched-cursor',
            cursor: { syncOrder: 1, id: 'f'.repeat(64) },
            hasMore: true,
            operations: [operation],
        });

        expect(onProtocolViolation).toHaveBeenCalledWith(
            peerKey,
            'mismatched_ordered_catchup_cursor',
            expect.any(Object),
        );
        expect(enqueue).not.toHaveBeenCalled();
        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });
});

describe('ordered catch-up server cursors and scheduling', () => {
    function makeCompatibleConnection(): ConnectionInfo {
        return {
            capabilities: normalizePeerCapabilities({
                ordered: { count: 1, sourceReady: true },
            }),
            wireVersion: 2,
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

    it.each(['status', 'page'] as const)('clears server state when a %s read fails', async phase => {
        const failure = new Error(`${phase} read failed`);
        const { store } = createServerStore();
        if (phase === 'status') {
            jest.spyOn(store, 'count').mockRejectedValue(failure);
        }
        else {
            jest.spyOn(store, 'iterateOrdered').mockRejectedValue(failure);
        }
        const coordinator = createCoordinator({ syncStore: store });

        await expect(coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', sessionId: `failed-${phase}`,
        })).rejects.toBe(failure);

        expect(coordinator.getActiveSessionId(peerKey)).toBeNull();
        await coordinator.shutdown();
    });

    it('drops messages when their connection disappears during dispatch', async () => {
        const connection = makeCompatibleConnection();
        const connections = [
            connection, undefined,
            connection,
            connection, undefined,
            connection,
            connection, undefined,
        ];
        const onProtocolViolation = jest.fn();
        const coordinator = createCoordinator({
            getConnection: () => connections.shift(),
            onProtocolViolation,
        });
        const operation = makeOperation();

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', sessionId: 'disconnected-request',
        });
        expect(coordinator.createClientSession(peerKey, 'disconnected-push')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_push', sessionId: 'disconnected-push',
            cursor: { syncOrder: 1, id: operation.signature.hash }, hasMore: false, operations: [operation],
        });
        coordinator.reset();
        expect(coordinator.createClientSession(peerKey, 'disconnected-done')).toBe(true);
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_done', sessionId: 'disconnected-done',
        });

        expect(onProtocolViolation).not.toHaveBeenCalled();
        await coordinator.shutdown();
    });

    it('records an initial request send failure and an idle client timeout', async () => {
        const onFailure = jest.fn(async () => undefined);
        const coordinator = createCoordinator({ sendToPeer: () => false, onFailure });

        expect(coordinator.startClient(peerKey, 'test', 1)).toBe(true);
        await nextTurn();
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'send_ordered_catchup_req_failed',
        }));

        const idle = createCoordinator({ onFailure });
        expect(idle.createClientSession(peerKey, 'idle')).toBe(true);
        idle.expire(Date.now() + 120_001);
        await nextTurn();
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'idle_timeout' }));
        await Promise.all([coordinator.shutdown(), idle.shutdown()]);
    });

    it('does not start a client while imports are unavailable', async () => {
        const coordinator = createCoordinator({
            importPipeline: { available: false } as ImportPipeline,
        });

        expect(coordinator.startClient(peerKey, 'unavailable', 1)).toBe(false);
        const shutdown = coordinator.shutdown();
        expect(coordinator.shutdown()).toBe(shutdown);
        await shutdown;
    });

    it('keeps one live server expectation and expires it from the coordinator sweep', async () => {
        const coordinator = createCoordinator();

        coordinator.expectServerRequest(peerKey, 'first', 10);
        const expected = coordinator.getPeerState(peerKey);
        coordinator.expectServerRequest(peerKey, 'replacement', 20);
        expect(coordinator.getPeerState(peerKey)).toEqual(expected);

        coordinator.expire(expected.serverPendingUntil);
        expect(coordinator.getPeerState(peerKey).serverPendingUntil).toBe(0);
        await coordinator.shutdown();
    });

    it('does not materialize an outbound page when page capacity is unavailable', async () => {
        const operationPages = createOperationPageBudget(1, 1_000_000);
        const held = operationPages.reserve(1)!;
        const { store } = createServerStore();
        const coordinator = createCoordinator({ operationPages, syncStore: store });

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', sessionId: 'capacity',
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
            type: 'ordered_catchup_req', sessionId: 'server',
        });
        expect(sent[0]).toMatchObject({
            type: 'ordered_catchup_push',
            hasMore: true,
            cursor: { syncOrder: 256, id: operations[255].signature.hash },
        });

        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req',
            sessionId: 'server',
            after: sent[0].cursor as { syncOrder: number; id: string },
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
            type: 'ordered_catchup_req', sessionId: 'server',
        });
        await coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req',
            sessionId: 'server',
            ...(cursor ? { after: cursor } : {}),
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
            sessionId: 'server',
            after: { syncOrder: 1, id: operations[0].signature.hash },
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
                ordered: { count: 1, sourceReady: true },
            }),
            wireVersion: 2,
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
            type: 'ordered_catchup_req', sessionId: 'stale',
        });
        await firstReadStarted;
        coordinator.removePeer(peerKey, 'disconnect');
        connection = makeCompatibleConnection();

        const replacementRequest = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', sessionId: 'replacement',
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
            type: 'ordered_catchup_req', sessionId: 'shared-session',
        });
        await firstSendStarted;
        coordinator.removePeer(peerKey, 'disconnect');
        connection = makeCompatibleConnection();
        const replacementRequest = coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', sessionId: 'shared-session',
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
            type: 'ordered_catchup_req', sessionId: 'complete',
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
            type: 'ordered_catchup_req', sessionId: 'expired',
        });
        await nextTurn();
        expect(coordinator.getPeerState(peerKey).serverSessionId).toBe('expired');

        coordinator.expire(Date.now() + 120_001);
        await expect(expired).resolves.toBeUndefined();
        releaseBlocker();
        await blocker;

        await expect(coordinator.handleMessage(peerKey, {
            type: 'ordered_catchup_req', sessionId: 'retry',
        })).resolves.toBeUndefined();
        await coordinator.shutdown();
        await bulkReads.shutdown();
    });
});
