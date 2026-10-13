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

function createCoordinator(overrides: Partial<Pick<
    OrderedCatchupCoordinatorOptions,
    'importPipeline' | 'onFailure' | 'onIndexRefreshed' | 'onProtocolViolation'
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
    return createOrderedCatchupCoordinator({
        version: 1,
        maxOpsPerPage: 256,
        maxBytesPerPage: 1_000_000,
        idleTimeoutMs: 120_000,
        syncStore: new InMemoryOperationSyncStore(),
        importPipeline: overrides.importPipeline ?? importPipeline,
        syncStats: createMediatorSyncStats(),
        cipher: new CipherNode(),
        getConnection: key => key === peerKey ? connection : undefined,
        createSessionId: () => 'session',
        createBaseMessage: type => ({ type, time: '', node: '', relays: [] }),
        sendToPeer: () => true,
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
