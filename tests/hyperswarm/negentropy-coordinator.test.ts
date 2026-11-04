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
