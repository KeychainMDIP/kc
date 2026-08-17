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
            adapterMaxAgeMs: 60_000,
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
});
