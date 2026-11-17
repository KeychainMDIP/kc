import { jest } from '@jest/globals';

import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ReconciliationWindow } from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';

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
    it('repairs skipped gossip through another peer after recovery even when this node normally responds', async () => {
        const [
            { createPeerSyncCoordinator }, { createConnectionInfo },
            { normalizePeerCapabilities }, { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/peer-sync-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/negentropy/protocol.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const peers = ['11'.repeat(32), '22'.repeat(32)];
        const connections = new Map(peers.map(peerKey => {
            const conn = createConnectionInfo({
                connection: { write() {}, destroy() {}, remotePublicKey: Buffer.from(peerKey, 'hex') } as never,
                peerName: peerKey,
            });
            conn.capabilities = normalizePeerCapabilities({ negentropy: true, negentropyVersion: 1 });
            conn.peerTransportFramingVersion = 1;
            conn.syncMode = 'negentropy';
            conn.syncStarted = true;
            conn.negentropySynced = true;
            conn.orderedCatchupAttempted = true;
            return [peerKey, conn];
        }));
        let activePeer: string | null = peers[0];
        const startSession = jest.fn(async (peerKey: string) => { activePeer = peerKey; return true; });
        const reset = jest.fn(() => { activePeer = null; });
        const coordinator = createPeerSyncCoordinator({
            negentropyVersion: 1, orderedCatchupVersion: 1, transportFramingVersion: 1,
            windowSize: 25_000, repairIntervalMs: 300_000, syncStats: createMediatorSyncStats(),
            getNodeKey: () => 'ff'.repeat(32), getPeerKeys: () => [...connections.keys()],
            getConnection: key => connections.get(key),
            getImportPipeline: () => ({ available: true, queued: 0, running: 0 } as ImportPipeline),
            getSyncStore: () => ({ count: async () => 99 } as never),
            getNegentropyCoordinator: () => ({
                getActiveSessionCount: () => activePeer ? 1 : 0, hasActiveSession: (key: string) => key === activePeer,
                startSession, reset, handleIndexRefreshed: async () => {},
                removePeer: (key: string) => { if (activePeer === key) activePeer = null; },
            } as never),
            getOrderedCatchupCoordinator: () => ({
                hasActiveOutbound: () => false, hasActiveForPeer: () => false,
                expireServerExpectation() {}, removePeer() {}, finishTransition() {},
            } as never),
            waitForInitialPing: async () => true, onPeersAdvertised() {},
        });
        const sync = {
            countBefore: 99, countAfter: 99, mode: 'changes' as const, pages: 1,
            exported: 0, mapped: 0, invalid: 0, inserted: 0, updated: 0, deleted: 0,
            snapshotComplete: true, durationMs: 0,
        };
        try {
            await coordinator.handleIndexRefreshed('recovery', { ...sync, processingRecoveryGeneration: 2 });
            expect(reset).toHaveBeenCalledWith('gatekeeper_processing_unavailable');
            expect(startSession).toHaveBeenCalledWith(peers[0], expect.objectContaining({ initiator: true }));
            expect(connections.get(peers[0])!.negentropySynced).toBe(false);
            await coordinator.handleIndexRefreshed('late-older-refresh', { ...sync, processingRecoveryGeneration: 1 });
            expect(reset).toHaveBeenCalledTimes(1);
            connections.delete(peers[0]);
            coordinator.handleDisconnected(peers[0], 'disconnect');
            await coordinator.schedulePreferredSyncs();
            expect(startSession).toHaveBeenLastCalledWith(peers[1], expect.objectContaining({ initiator: true }));
            expect(startSession).toHaveBeenCalledTimes(2);
            activePeer = null;
            connections.get(peers[1])!.negentropySynced = true;
            await coordinator.handleNegentropySessionClosed(peers[1], 'complete');
            await coordinator.runPeriodicRepairs();
            expect(startSession).toHaveBeenCalledTimes(2);
        } finally { await coordinator.shutdown(); }
    });

    it.each(['unavailable', 'storage', 'accepted'] as const)('handles the %s recovery mirror outcome using accepted inventory', async outcome => {
        const [
            { createNegentropyCoordinator }, { default: InMemoryOperationSyncStore },
            { createConnectionInfo }, { createMediatorSyncStats },
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
        const operation = { type: 'create' as const, signature: {
            hash: 'b'.repeat(64), signed: '2026-01-01T00:00:00.000Z', value: 'signature',
        } };
        const lookup = jest.spyOn(store, 'getByIds');
        const failure = outcome === 'unavailable'
            ? Object.assign(new Error('Gatekeeper processing is unavailable'), { code: 'gatekeeper_processing_unavailable' })
            : new Error('sync-store unavailable');
        const importPipeline = {
            available: true, recovering: false, queued: 0, running: 0, indexEpoch: 'epoch',
            enqueue: async () => ({ knownIds: [], persistedIds: [], retryable: false, indexRefreshRequired: true }),
            refreshIndex: async () => {
                if (outcome !== 'accepted') throw failure;
                await store.upsertMany([{ id: operation.signature.hash, ts: 1_767_225_600, syncOrder: 1, operation }]);
                return {
                    mode: 'changes', countBefore: 0, countAfter: 1, pages: 1, exported: 1, mapped: 1,
                    invalid: 0, inserted: 1, updated: 0, deleted: 0, snapshotComplete: true, durationMs: 0,
                };
            },
        } as unknown as ImportPipeline;
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const onIndexRefreshed = jest.fn(async () => {});
        const onSessionClosed = jest.fn(async () => {});
        const terminatePeerConnection = jest.fn();
        const coordinator = createNegentropyCoordinator({
            version: 1, transportFramingVersion: 1, frameSizeLimit: 0, maxRecordsPerWindow: 16,
            maxRoundsPerSession: 8, maxIdsPerRequest: 1_000, maxIdsPerLookup: 1_000,
            maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024, idleTimeoutMs: 120_000,
            syncStore: store, importPipeline, syncStats: createMediatorSyncStats(), getConnection: () => connection,
            createSessionId: () => 'session', createBaseMessage: type => ({ type, time: '', node: '', relays: [] }),
            sendToPeer, canStartBackgroundPrebuild: () => false, terminatePeerConnection, onSessionClosed, onIndexRefreshed,
        });
        try {
            await coordinator.initializeAdapter();
            await coordinator.startSession(peerKey, { source: 'connect', modeReason: 'negentropy_supported', initiator: true });
            const open = sendToPeer.mock.calls[0]?.[1] as { windowId: string };
            mockLogger.error.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: 'session', windowId: open.windowId, round: 0,
                time: '', node: '', relays: [], data: [operation],
            });
            if (outcome === 'accepted') {
                expect(onIndexRefreshed).toHaveBeenCalledWith('negentropy_processing_recovery', expect.objectContaining({ inserted: 1 }));
                expect(lookup).toHaveBeenCalledWith([operation.signature.hash]);
                expect(coordinator.hasActiveSession(peerKey)).toBe(true);
                expect(onSessionClosed).not.toHaveBeenCalled();
                expect(mockLogger.error).not.toHaveBeenCalled();
            }
            else {
                expect(onSessionClosed).toHaveBeenCalledWith(peerKey, 'gatekeeper_processing_unavailable');
                expect(onIndexRefreshed).not.toHaveBeenCalled();
                if (outcome === 'unavailable') expect(mockLogger.error).not.toHaveBeenCalled();
                else expect(mockLogger.error).toHaveBeenCalledWith(
                    expect.objectContaining({ err: failure }), 'Failed to mirror Gatekeeper processing recovery',
                );
            }
            expect(terminatePeerConnection).not.toHaveBeenCalled();
        } finally { await coordinator.shutdown(); }
    });

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

    it.each([
        { phase: 'remote', reason: 'gatekeeper_reset', indexEpochChanged: true },
        { phase: 'terminal', reason: 'gatekeeper_reset', indexEpochChanged: true },
        { phase: 'remote', reason: 'gatekeeper_processing_unavailable', indexEpochChanged: false },
        { phase: 'terminal', reason: 'gatekeeper_processing_unavailable', indexEpochChanged: false },
    ])('closes $phase imports interrupted by $reason without blaming the peer', async ({ phase, reason, indexEpochChanged }) => {
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
        let releaseImport!: () => void;
        const held = new Promise<void>(resolve => { releaseImport = resolve; });
        const enqueue = jest.fn<ImportPipeline['enqueue']>(async request => {
            if (request.kind !== phase) return { knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [], retryable: false };
            if (phase === 'remote') await held;
            return { knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [], retryable: true,
                indexEpochChanged, dependencyUnavailable: !indexEpochChanged };
        });
        let recovering = phase === 'remote';
        const importPipeline = {
            available: true, get recovering() { return recovering; }, queued: 0, running: 0, indexEpoch: 'old-epoch', enqueue,
        } as unknown as ImportPipeline;
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const onSessionClosed = jest.fn(async () => undefined);
        const terminatePeerConnection = jest.fn();
        const coordinator = createNegentropyCoordinator({
            version: 1, transportFramingVersion: 1, frameSizeLimit: 0,
            maxRecordsPerWindow: 16, maxRoundsPerSession: 8, maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000, syncStore: store, importPipeline, syncStats: createMediatorSyncStats(),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => 'reset-session',
            createBaseMessage: type => ({ type, time: '', node: '', relays: [] }),
            sendToPeer, canStartBackgroundPrebuild: () => false, terminatePeerConnection, onSessionClosed,
            onIndexRefreshed: async () => {},
        });
        try {
            await coordinator.initializeAdapter();
            await coordinator.startSession(peerKey, { source: 'connect', modeReason: 'negentropy_supported', initiator: true });
            const open = sendToPeer.mock.calls[0]?.[1] as { windowId: string };
            mockLogger.warn.mockClear();
            const push = coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: 'reset-session', windowId: open.windowId, round: 0,
                time: '', node: '', relays: [],
                data: [{ type: 'create', signature: {
                    hash: 'b'.repeat(64), signed: '2026-01-01T00:00:00.000Z', value: 'signature',
                } }],
            });
            if (phase === 'remote') {
                await new Promise<void>(resolve => setImmediate(resolve));
                const resumedAt = Date.now() + 121_000;
                coordinator.expire(resumedAt);
                recovering = false;
                coordinator.expire(resumedAt + 1);
                expect(coordinator.hasActiveSession(peerKey)).toBe(true);
                await coordinator.handleMessage(peerKey, {
                    type: 'neg_close', sessionId: 'reset-session', windowId: open.windowId,
                    reason: 'complete', round: 0, time: '', node: '', relays: [],
                });
                expect(coordinator.hasActiveSession(peerKey)).toBe(true);
                releaseImport();
            }
            await push;
            if (phase === 'terminal') {
                await coordinator.handleMessage(peerKey, {
                    type: 'neg_close', sessionId: 'reset-session', windowId: open.windowId,
                    reason: 'complete', round: 0, time: '', node: '', relays: [],
                });
            }
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(onSessionClosed).toHaveBeenCalledWith(peerKey, reason);
            expect(terminatePeerConnection).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
        } finally {
            releaseImport();
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
            available: true, recovering: false,
            get queued() {
                return 0;
            },
            get running() {
                return 0;
            },
            async enqueue() {
                return {
                    knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [], retryable: false,
                };
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
            onIndexRefreshed: async () => {},
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
        expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({
            peer: '2222-2222',
            sessionId: 'test-session',
            durationMs: expect.any(Number),
            reason: 'test_close',
        }), 'peer sync session closed');
        await store.stop();
    });

    it('closes only the session when snapshot contention occurs during a message', async () => {
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
        const store = new InMemoryOperationSyncStore();
        await store.start();
        let coordinator: ReturnType<typeof createNegentropyCoordinator>;
        const buildSnapshotForWindow = jest.fn(async (window: ReconciliationWindow) => {
            if (buildSnapshotForWindow.mock.calls.length > 1) {
                coordinator.beginStoreMutation()();
            }
            return {
                window,
                storage: {} as never,
                stats: {
                    loaded: 16, skipped: 0, durationMs: 0, frameSizeLimit: 0,
                    windowName: window.name, fromTs: window.fromTs, toTs: window.toTs,
                    rounds: 0, completed: false, cappedByRecords: true, cappedByRounds: false,
                    lastCursor: { ts: 1_750_000_000, id: 'a'.repeat(64) },
                },
            };
        });
        const adapter = {
            buildSnapshotForWindow,
            createEngineForSnapshot: () => ({
                initiate: async () => new Uint8Array(),
                reconcile: async () => ({ nextMsg: null, haveIds: [], needIds: [] }),
            }),
        };
        const connection = createConnectionInfo({
            connection: {
                write: () => undefined,
                destroy: () => undefined,
                remotePublicKey: Buffer.from(peerKey, 'hex'),
            } as never,
            peerName: 'test-peer',
        });
        const importPipeline = {
            available: true, recovering: false, queued: 0, running: 0, indexEpoch: 'epoch',
        } as unknown as ImportPipeline;
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const terminatePeerConnection = jest.fn();
        const onSessionClosed = jest.fn(async () => undefined);
        coordinator = createNegentropyCoordinator({
            version: 1, transportFramingVersion: 1, frameSizeLimit: 0,
            maxRecordsPerWindow: 16, maxRoundsPerSession: 8, maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000, syncStore: store, importPipeline,
            syncStats: createMediatorSyncStats(), getConnection: () => connection,
            createSessionId: () => 'test-session',
            createBaseMessage: type => ({ type, time: '', node: '', relays: [] }),
            sendToPeer, canStartBackgroundPrebuild: () => false, terminatePeerConnection,
            onSessionClosed, onIndexRefreshed: async () => {},
        });

        try {
            coordinator.setAdapter(adapter as never);
            await coordinator.startSession(peerKey, {
                source: 'connect', modeReason: 'negentropy_supported', initiator: true,
            });
            const open = sendToPeer.mock.calls[0]?.[1] as { windowId: string };

            await expect(coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: 'test-session', windowId: open.windowId,
                round: 0, frame: { encoding: 'base64', data: '' }, time: '', node: '', relays: [],
            })).resolves.toBeUndefined();

            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(sendToPeer).toHaveBeenLastCalledWith(peerKey, expect.objectContaining({
                type: 'neg_close', sessionId: 'test-session', reason: 'snapshot_busy',
            }));
            expect(onSessionClosed).toHaveBeenCalledWith(peerKey, 'snapshot_busy');
            expect(terminatePeerConnection).not.toHaveBeenCalled();
            expect(buildSnapshotForWindow).toHaveBeenCalledTimes(3);
        }
        finally {
            await coordinator.shutdown();
            await store.stop();
        }
    });

    it('rebuilds a snapshot dirtied by a completed store mutation before opening a session', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { default: NegentropyAdapter },
            { createConnectionInfo },
            { createMediatorSyncStats },
            { normalizePeerCapabilities },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/negentropy/adapter.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
            import('../../services/mediators/hyperswarm/src/negentropy/protocol.ts'),
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
            maxRecordsPerWindow: 16,
            deferInitialBuild: true,
        });
        const buildSnapshotForWindow = adapter.buildSnapshotForWindow.bind(adapter);
        let markFirstBuildCaptured!: () => void;
        const firstBuildCaptured = new Promise<void>(resolve => {
            markFirstBuildCaptured = resolve;
        });
        let releaseFirstBuild!: () => void;
        const firstBuildBlocked = new Promise<void>(resolve => {
            releaseFirstBuild = resolve;
        });
        const buildSnapshot = jest.spyOn(adapter, 'buildSnapshotForWindow').mockImplementation(async window => {
            const snapshot = await buildSnapshotForWindow(window);
            if (buildSnapshot.mock.calls.length === 1) {
                markFirstBuildCaptured();
                await firstBuildBlocked;
            }
            return snapshot;
        });
        const createEngine = jest.spyOn(adapter, 'createEngineForSnapshot');
        const onSessionClosed = jest.fn(() => undefined);
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: {
                write: () => undefined,
                destroy: () => undefined,
                remotePublicKey: Buffer.from(peerKey, 'hex'),
            } as never,
            peerName: 'test-peer',
        });
        connection.capabilities = normalizePeerCapabilities({
            negentropy: true,
            negentropyVersion: 1,
        });
        connection.peerTransportFramingVersion = 1;
        const importPipeline: ImportPipeline = {
            available: true, recovering: false,
            get queued() { return 0; },
            get running() { return 0; },
            async enqueue() {
                return {
                    knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [], retryable: false,
                };
            },
            async waitForIdle() {},
            async refreshIndex() { throw new Error('unexpected index refresh'); },
            async shutdown() {},
        };
        const sendToPeer = jest.fn(() => true);
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
            sendToPeer,
            canStartBackgroundPrebuild: () => false,
            terminatePeerConnection: () => undefined,
            onSessionClosed,
            onIndexRefreshed: async () => {},
        });
        coordinator.setAdapter(adapter);
        let starting: Promise<boolean> | null = null;
        let finishFirstMutation: () => void = () => undefined;
        let finishSecondMutation: () => void = () => undefined;
        let finishWakeRaceMutation: () => void = () => undefined;
        let finishShutdownMutation: () => void = () => undefined;
        try {
            starting = coordinator.startSession(peerKey, {
                source: 'connect',
                modeReason: 'negentropy_supported',
                initiator: true,
            });
            await firstBuildCaptured;
            finishFirstMutation = coordinator.beginStoreMutation();
            finishSecondMutation = coordinator.beginStoreMutation();
            await store.upsertMany([{
                id: 'd'.repeat(64),
                signedTs: 1_750_000_003,
                operation: {
                    type: 'create',
                    signature: {
                        hash: 'd'.repeat(64),
                        signed: new Date(1_750_000_003 * 1000).toISOString(),
                        value: 'sig-d',
                    },
                },
            }]);
            releaseFirstBuild();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(buildSnapshot).toHaveBeenCalledTimes(1);
            finishFirstMutation();
            finishFirstMutation();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(buildSnapshot).toHaveBeenCalledTimes(1);
            finishSecondMutation();
            finishWakeRaceMutation = coordinator.beginStoreMutation();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(buildSnapshot).toHaveBeenCalledTimes(1);
            finishWakeRaceMutation();
            expect(await starting).toBe(true);
            expect(buildSnapshot).toHaveBeenCalledTimes(2);
            expect(createEngine).toHaveBeenCalledTimes(1);
            expect(createEngine.mock.calls[0]?.[0].stats.loaded).toBe(4);

            coordinator.removePeer(peerKey, 'test_close');
            let markThirdBuildStarted!: () => void;
            const thirdBuildStarted = new Promise<void>(resolve => {
                markThirdBuildStarted = resolve;
            });
            let releaseThirdBuild!: () => void;
            const thirdBuildBlocked = new Promise<void>(resolve => {
                releaseThirdBuild = resolve;
            });
            let markFourthBuildStarted!: () => void;
            const fourthBuildStarted = new Promise<void>(resolve => {
                markFourthBuildStarted = resolve;
            });
            let releaseFourthBuild!: () => void;
            const fourthBuildBlocked = new Promise<void>(resolve => {
                releaseFourthBuild = resolve;
            });
            buildSnapshot.mockImplementation(async window => {
                const snapshot = await buildSnapshotForWindow(window);
                if (buildSnapshot.mock.calls.length === 3) {
                    markThirdBuildStarted();
                    await thirdBuildBlocked;
                }
                if (buildSnapshot.mock.calls.length === 4) {
                    markFourthBuildStarted();
                    await fourthBuildBlocked;
                }
                return snapshot;
            });

            const markDirty = coordinator.beginStoreMutation();
            markDirty();
            const contending = coordinator.startSession(peerKey, {
                source: 'periodic',
                modeReason: 'negentropy_supported',
                initiator: true,
            });
            await thirdBuildStarted;
            const finishThirdBuildMutation = coordinator.beginStoreMutation();
            finishThirdBuildMutation();
            releaseThirdBuild();
            await fourthBuildStarted;
            const finishFourthBuildMutation = coordinator.beginStoreMutation();
            finishFourthBuildMutation();
            releaseFourthBuild();

            expect(await contending).toBe(false);
            expect(buildSnapshot).toHaveBeenCalledTimes(4);
            expect(createEngine).toHaveBeenCalledTimes(1);
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'snapshot_busy');

            expect(await coordinator.startSession(peerKey, {
                source: 'periodic',
                modeReason: 'negentropy_supported',
                initiator: true,
            })).toBe(true);
            expect(buildSnapshot).toHaveBeenCalledTimes(5);
            expect(createEngine).toHaveBeenCalledTimes(2);

            coordinator.removePeer(peerKey, 'test_close');
            const buildFailure = new Error('snapshot read failed');
            buildSnapshot.mockRejectedValueOnce(buildFailure);
            const dirtyBeforeFailure = coordinator.beginStoreMutation();
            dirtyBeforeFailure();
            await expect(coordinator.handleMessage(peerKey, {
                type: 'neg_open',
                sessionId: 'remote-session',
                windowId: 'remote-window',
                window: {
                    name: 'history_paged',
                    fromTs: 0,
                    toTs: 1_800_000_000,
                    maxRecords: 16,
                    order: 0,
                },
                round: 0,
                frame: '' as never,
                time: '',
                node: '',
                relays: [],
            })).rejects.toBe(buildFailure);
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(sendToPeer).toHaveBeenLastCalledWith(peerKey, expect.objectContaining({
                type: 'neg_close',
                sessionId: 'remote-session',
                windowId: 'remote-window',
                reason: 'snapshot_build_failed',
            }));
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'snapshot_build_failed');

            finishShutdownMutation = coordinator.beginStoreMutation();
            const waitingForMutation = coordinator.startSession(peerKey, {
                source: 'periodic',
                modeReason: 'negentropy_supported',
                initiator: true,
            });
            await new Promise<void>(resolve => setImmediate(resolve));
            const shuttingDown = coordinator.shutdown();
            await expect(waitingForMutation).rejects.toThrow('mediator is shutting down');
            await shuttingDown;
        }
        finally {
            finishFirstMutation();
            finishSecondMutation();
            finishWakeRaceMutation();
            finishShutdownMutation();
            releaseFirstBuild();
            await starting?.catch(() => undefined);
            await coordinator.shutdown();
            await store.stop();
            nowSpy.mockRestore();
        }
    });
});
