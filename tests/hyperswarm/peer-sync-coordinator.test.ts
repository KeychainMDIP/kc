import { jest } from '@jest/globals';

import type { OperationSyncStore } from '../../services/mediators/hyperswarm/src/db/types.ts';
import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import { createConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import { createNegentropyCoordinator } from '../../services/mediators/hyperswarm/src/negentropy-coordinator.ts';
import { normalizePeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import { createOrderedCatchupCoordinator } from '../../services/mediators/hyperswarm/src/ordered-catchup-coordinator.ts';
import { createPeerSyncCoordinator } from '../../services/mediators/hyperswarm/src/peer-sync-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';

describe('peer sync coordinator targeted repair', () => {
    function createHarness() {
        const peerKey = 'b'.repeat(64);
        const connection = {
            capabilities: normalizePeerCapabilities({
                negentropy: true,
                negentropyVersion: 2,
            }),
            peerTransportFramingVersion: 1,
            negentropySynced: true,
            syncMode: 'negentropy',
            syncStarted: true,
        } as ConnectionInfo;
        const pipeline = { queued: 0, running: 0 } as ImportPipeline;
        const startSession = jest.fn(async () => true);
        const negentropy = {
            getActiveSessionCount: jest.fn(() => 0),
            startSession,
        } as unknown as ReturnType<typeof createNegentropyCoordinator>;
        const ordered = {
            expireServerExpectation: jest.fn(),
            hasActiveForPeer: jest.fn(() => false),
            hasActiveOutbound: jest.fn(() => false),
        } as unknown as ReturnType<typeof createOrderedCatchupCoordinator>;
        const waitForInitialPing = jest.fn(async () => true);
        let current: ConnectionInfo | undefined = connection;
        const coordinator = createPeerSyncCoordinator({
            negentropyVersion: 2,
            orderedCatchupVersion: 1,
            transportFramingVersion: 1,
            windowSize: 25_000,
            repairIntervalMs: 1_000,
            syncStats: createMediatorSyncStats(),
            getNodeKey: () => 'f'.repeat(64),
            getPeerKeys: () => current ? [peerKey] : [],
            getConnection: () => current,
            getSyncStore: () => ({}) as OperationSyncStore,
            getImportPipeline: () => pipeline,
            getNegentropyCoordinator: () => negentropy,
            getOrderedCatchupCoordinator: () => ordered,
            waitForInitialPing,
            onPeersAdvertised: jest.fn(),
        });

        return {
            connection,
            coordinator,
            negentropy,
            ordered,
            peerKey,
            pipeline,
            setCurrent(value: ConnectionInfo | undefined): void {
                current = value;
            },
            startSession,
            waitForInitialPing,
        };
    }

    it('starts a receiver-requested repair even after the connection was synchronized', async () => {
        const harness = createHarness();

        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(true);

        expect(harness.connection.negentropySynced).toBe(false);
        expect(harness.startSession).toHaveBeenCalledWith(harness.peerKey, {
            source: 'periodic',
            modeReason: null,
            initiator: true,
        });
    });

    it('defers repair while imports are active and rejects a replaced connection', async () => {
        const harness = createHarness();
        Object.defineProperty(harness.pipeline, 'running', { value: 1, configurable: true });

        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(false);
        expect(harness.startSession).not.toHaveBeenCalled();

        Object.defineProperty(harness.pipeline, 'running', { value: 0, configurable: true });
        harness.setCurrent({} as ConnectionInfo);
        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(false);
        expect(harness.startSession).not.toHaveBeenCalled();
    });

    it('respects an active Negentropy retry delay', async () => {
        const harness = createHarness();
        harness.connection.negentropyRetryAfter = Date.now() + 1_000;

        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(false);

        expect(harness.startSession).not.toHaveBeenCalled();
    });

    it('holds the shared start guard until asynchronous repair startup completes', async () => {
        const harness = createHarness();
        let finishStart!: () => void;
        harness.startSession.mockImplementationOnce(() => new Promise(resolve => {
            finishStart = () => resolve(true);
        }));

        const first = harness.coordinator.requestRepair(harness.peerKey, harness.connection);
        await Promise.resolve();
        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(false);
        expect(harness.startSession).toHaveBeenCalledTimes(1);

        finishStart();
        await expect(first).resolves.toBe(true);
    });

    it('rejects repair after shutdown or a connection change while awaiting its ping', async () => {
        const stopped = createHarness();
        await stopped.coordinator.shutdown();
        await expect(stopped.coordinator.requestRepair(
            stopped.peerKey,
            stopped.connection,
        )).resolves.toBe(false);

        const replaced = createHarness();
        let finishPing!: () => void;
        replaced.waitForInitialPing.mockImplementationOnce(() => new Promise(resolve => {
            finishPing = () => resolve(true);
        }));
        const repair = replaced.coordinator.requestRepair(
            replaced.peerKey,
            replaced.connection,
        );
        await Promise.resolve();
        replaced.setCurrent({} as ConnectionInfo);
        finishPing();

        await expect(repair).resolves.toBe(false);
        expect(replaced.startSession).not.toHaveBeenCalled();
    });

    it('keeps round-robin opportunities while an active fallback checks a nearly caught-up ordered source', async () => {
        const keys = ['1', '2', '3'].map(char => char.repeat(64));
        const peers = new Map(keys.map(key => {
            const connection = createConnectionInfo({ connection: {} as ConnectionInfo['connection'], peerName: key });
            connection.syncMode = 'negentropy';
            connection.syncStarted = true;
            connection.peerTransportFramingVersion = 1;
            connection.capabilities = normalizePeerCapabilities({
                negentropy: true,
                negentropyVersion: 2,
                ...(key === keys[2] && {
                    orderedCatchup: true, orderedCatchupVersion: 1, orderedCatchupReady: true,
                    operationCount: 100_000, orderedOperationCount: 100_000,
                }),
            });
            return [key, connection] as const;
        }));
        let active: string | null = null;
        const startSession = jest.fn(async (key: string) => { active = key; return true; });
        const interrupt = jest.fn();
        const negentropy = {
            getActiveSessionCount: () => active ? 1 : 0,
            hasActiveSession: (key: string) => active === key,
            startSession,
            interruptForOrderedCatchup: interrupt,
        } as unknown as ReturnType<typeof createNegentropyCoordinator>;
        const ordered = {
            expireServerExpectation: jest.fn(),
            hasActiveForPeer: () => false,
            hasActiveOutbound: () => false,
        } as unknown as ReturnType<typeof createOrderedCatchupCoordinator>;
        const coordinator = createPeerSyncCoordinator({
            negentropyVersion: 2, orderedCatchupVersion: 1, transportFramingVersion: 1,
            windowSize: 25_000, repairIntervalMs: 1_000, syncStats: createMediatorSyncStats(),
            getNodeKey: () => '0'.repeat(64), getPeerKeys: () => keys,
            getConnection: key => peers.get(key),
            getSyncStore: () => ({ count: async () => 99_000 }) as OperationSyncStore,
            getImportPipeline: () => ({ queued: 0, running: 0 }) as ImportPipeline,
            getNegentropyCoordinator: () => negentropy,
            getOrderedCatchupCoordinator: () => ordered,
            waitForInitialPing: async () => true, onPeersAdvertised: jest.fn(),
        });

        await coordinator.schedulePreferredSyncs();
        await coordinator.schedulePreferredSyncs();
        active = null;
        await coordinator.schedulePreferredSyncs();

        expect(startSession.mock.calls.map(([key]) => key)).toEqual([keys[0], keys[1]]);
        expect(interrupt).not.toHaveBeenCalled();
        await coordinator.shutdown();
    });
});
