import { jest } from '@jest/globals';

import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';

const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

jest.unstable_mockModule('@mdip/common/logger', () => ({
    childLogger: jest.fn(() => mockLogger),
}));

describe('Negentropy coordinator', () => {
    it('waits for mirror recovery before scheduling peers after a reset cancellation', async () => {
        const { createPeerSyncCoordinator } = await import('../../services/mediators/hyperswarm/src/peer-sync-coordinator.ts');
        const finishTransition = jest.fn();
        const getPeerKeys = jest.fn(() => []);
        const coordinator = createPeerSyncCoordinator({
            getOrderedCatchupCoordinator: () => ({ finishTransition }),
            getNegentropyCoordinator: () => ({ getActiveSessionCount: () => 0 }),
            getPeerKeys,
        } as unknown as Parameters<typeof createPeerSyncCoordinator>[0]);
        await coordinator.handleNegentropySessionClosed('peer', 'gatekeeper_reset');
        expect(finishTransition).toHaveBeenCalledWith('peer');
        expect(getPeerKeys).not.toHaveBeenCalled();
        await coordinator.handleNegentropySessionClosed('peer', 'complete');
        expect(getPeerKeys).toHaveBeenCalledTimes(1);
        await coordinator.shutdown();
    });

    it.each(['remote', 'terminal'])('closes %s imports interrupted by reset without unresolved-operation warnings', async phase => {
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { createConnectionInfo },
            { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: { write() {}, destroy() {}, remotePublicKey: Buffer.from(peerKey, 'hex') } as never,
            peerName: 'test-peer',
        });
        const store = new InMemoryOperationSyncStore();
        const enqueue = jest.fn<ImportPipeline['enqueue']>(async request => request.kind === phase
            ? { knownIds: [], persistedIds: [], retryable: true, indexEpochChanged: true }
            : { knownIds: [], persistedIds: [], retryable: false });
        const importPipeline = {
            queued: 0, running: 0, indexEpoch: 'old-epoch', enqueue,
        } as unknown as ImportPipeline;
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const onSessionClosed = jest.fn(async () => undefined);
        const coordinator = createNegentropyCoordinator({
            version: 1, transportFramingVersion: 1, frameSizeLimit: 0,
            maxRecordsPerWindow: 16, maxRoundsPerSession: 8, maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000, syncStore: store, importPipeline, syncStats: createMediatorSyncStats(),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => 'reset-session',
            createBaseMessage: type => ({ type, time: '', node: '', relays: [] }),
            sendToPeer, canStartBackgroundPrebuild: () => false, terminatePeerConnection() {}, onSessionClosed,
        });
        try {
            await coordinator.initializeAdapter();
            await coordinator.startSession(peerKey, { source: 'connect', modeReason: 'negentropy_supported', initiator: true });
            const open = sendToPeer.mock.calls[0]?.[1] as { windowId: string };
            mockLogger.warn.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: 'reset-session', windowId: open.windowId, round: 0,
                time: '', node: '', relays: [],
                data: [{ type: 'create', signature: {
                    hash: 'b'.repeat(64), signed: '2026-01-01T00:00:00.000Z', value: 'signature',
                } }],
            });
            if (phase === 'terminal') {
                await coordinator.handleMessage(peerKey, {
                    type: 'neg_close', sessionId: 'reset-session', windowId: open.windowId,
                    reason: 'complete', round: 0, time: '', node: '', relays: [],
                });
            }
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(onSessionClosed).toHaveBeenCalledWith(peerKey, 'gatekeeper_reset');
            expect(mockLogger.warn).not.toHaveBeenCalled();
        } finally {
            await coordinator.shutdown();
            await store.stop();
        }
    });

    it('logs a rejected session-close callback before shutdown completes', async () => {
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { createConnectionInfo },
            { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const store = new InMemoryOperationSyncStore();
        await store.start();
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: {
                write: () => undefined,
                destroy: () => undefined,
                remotePublicKey: Buffer.from(peerKey, 'hex'),
            } as never,
            peerName: 'test-peer',
        });
        const importPipeline: ImportPipeline = {
            get queued() {
                return 0;
            },
            get running() {
                return 0;
            },
            async enqueue() {
                return { knownIds: [], persistedIds: [], retryable: false };
            },
            async waitForIdle() {},
            async refreshIndex() {
                throw new Error('unexpected index refresh');
            },
            async shutdown() {},
        };
        const callbackError = new Error('session-close callback failed');
        const onSessionClosed = jest.fn(async () => {
            throw callbackError;
        });
        const coordinator = createNegentropyCoordinator({
            version: 1,
            transportFramingVersion: 1,
            frameSizeLimit: 0,
            maxRecordsPerWindow: 16,
            maxRoundsPerSession: 8,
            maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000,
            maxOpsPerPush: 300,
            maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000,
            syncStore: store,
            importPipeline,
            syncStats: createMediatorSyncStats(),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => 'test-session',
            createBaseMessage: type => ({
                type,
                time: new Date().toISOString(),
                node: 'test-node',
                relays: [],
            }),
            sendToPeer: () => true,
            canStartBackgroundPrebuild: () => true,
            terminatePeerConnection: () => undefined,
            onSessionClosed,
        });

        await coordinator.initializeAdapter();
        expect(await coordinator.startSession(peerKey, {
            source: 'connect',
            modeReason: 'negentropy_supported',
            initiator: true,
        })).toBe(true);

        coordinator.removePeer(peerKey, 'test_close');
        await coordinator.shutdown();

        expect(onSessionClosed).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
            { error: callbackError, peer: '2222-2222', reason: 'test_close' },
            'negentropy session-close callback failed',
        );
        await store.stop();
    });

    it('does not retain snapshots while a store mutation is pending', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { default: NegentropyAdapter },
            { createConnectionInfo },
            { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/negentropy/adapter.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.upsertMany(['a', 'b', 'c'].map((char, index) => ({
            id: char.repeat(64),
            signedTs: 1_750_000_000 + index,
            operation: {
                type: 'create',
                signature: {
                    hash: char.repeat(64),
                    signed: new Date((1_750_000_000 + index) * 1000).toISOString(),
                    value: `sig-${char}`,
                },
            },
        })));
        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            maxRecordsPerWindow: 2,
            deferInitialBuild: true,
        });
        const buildSnapshot = jest.spyOn(adapter, 'buildSnapshotForWindow');
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: {
                write: () => undefined,
                destroy: () => undefined,
                remotePublicKey: Buffer.from(peerKey, 'hex'),
            } as never,
            peerName: 'test-peer',
        });
        const importPipeline: ImportPipeline = {
            get queued() { return 0; },
            get running() { return 0; },
            async enqueue() { return { knownIds: [], persistedIds: [], retryable: false }; },
            async waitForIdle() {},
            async refreshIndex() { throw new Error('unexpected index refresh'); },
            async shutdown() {},
        };
        const coordinator = createNegentropyCoordinator({
            version: 1,
            transportFramingVersion: 1,
            frameSizeLimit: 0,
            maxRecordsPerWindow: 2,
            maxRoundsPerSession: 8,
            maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000,
            maxOpsPerPush: 300,
            maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000,
            syncStore: store,
            importPipeline,
            syncStats: createMediatorSyncStats(),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => `test-session-${buildSnapshot.mock.calls.length}`,
            createBaseMessage: type => ({
                type,
                time: new Date().toISOString(),
                node: 'test-node',
                relays: [],
            }),
            sendToPeer: () => true,
            canStartBackgroundPrebuild: () => false,
            terminatePeerConnection: () => undefined,
            onSessionClosed: () => undefined,
        });
        coordinator.setAdapter(adapter);
        const startAndClose = async (): Promise<void> => {
            await coordinator.startSession(peerKey, {
                source: 'connect',
                modeReason: 'negentropy_supported',
                initiator: true,
            });
            coordinator.removePeer(peerKey, 'test_close');
        };

        await startAndClose();
        expect(buildSnapshot).toHaveBeenCalledTimes(1);

        const finishStoreMutation = coordinator.beginStoreMutation();
        await startAndClose();
        await startAndClose();
        expect(buildSnapshot).toHaveBeenCalledTimes(3);

        finishStoreMutation();
        await startAndClose();
        await startAndClose();
        expect(buildSnapshot).toHaveBeenCalledTimes(4);

        await coordinator.shutdown();
        await store.stop();
        nowSpy.mockRestore();
    });
});
