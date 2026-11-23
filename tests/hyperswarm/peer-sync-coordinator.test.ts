import { jest } from '@jest/globals';

import { logger } from '@mdip/common/logger';
import type { OperationSyncStore } from '../../services/mediators/hyperswarm/src/db/types.ts';
import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
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
                negentropyVersion: 2,
            }),
            peerTransportFramingVersion: 1,
            initialPingSent: true,
            initialPingReceived: true,
            negentropySynced: true,
            syncStarted: true,
        } as ConnectionInfo;
        const pipeline = { available: true, queued: 0, running: 0 } as ImportPipeline;
        const count = jest.fn(async () => 0);
        const startSession = jest.fn(async () => true);
        const getActiveSessionCount = jest.fn(() => 0);
        const negentropy = {
            getActiveSessionCount,
            startSession,
        } as unknown as ReturnType<typeof createNegentropyCoordinator>;
        const ordered = {
            expireServerExpectation: jest.fn(),
            hasActiveForPeer: jest.fn(() => false),
            hasActiveOutbound: jest.fn(() => false),
        } as unknown as ReturnType<typeof createOrderedCatchupCoordinator>;
        const waitForInitialPing = jest.fn(async () => true);
        let current: ConnectionInfo | undefined = connection;
        const syncStats = createMediatorSyncStats();
        const coordinator = createPeerSyncCoordinator({
            negentropyVersion: 2,
            orderedCatchupVersion: 1,
            transportFramingVersion: 1,
            windowSize: 25_000,
            repairIntervalMs: 1_000,
            syncStats,
            getNodeKey: () => 'f'.repeat(64),
            getPeerKeys: () => current ? [peerKey] : [],
            getConnection: () => current,
            getSyncStore: () => ({ count }) as unknown as OperationSyncStore,
            getImportPipeline: () => pipeline,
            getNegentropyCoordinator: () => negentropy,
            getOrderedCatchupCoordinator: () => ordered,
            waitForInitialPing,
            onPeersAdvertised: jest.fn(),
        });

        return {
            connection,
            count,
            coordinator,
            getActiveSessionCount,
            negentropy,
            ordered,
            peerKey,
            pipeline,
            setCurrent(value: ConnectionInfo | undefined): void {
                current = value;
            },
            startSession,
            syncStats,
            waitForInitialPing,
        };
    }

    it.each([
        { capabilities: normalizePeerCapabilities(), framing: 1 },
        { capabilities: normalizePeerCapabilities({ negentropyVersion: 1 }), framing: 1 },
        { capabilities: normalizePeerCapabilities({ negentropyVersion: 2 }), framing: 0 },
    ])('rejects repair for an incompatible asynchronous handoff', async ({ capabilities, framing }) => {
        const harness = createHarness();
        harness.connection.capabilities = capabilities;
        harness.connection.peerTransportFramingVersion = framing;

        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(false);

        expect(harness.startSession).not.toHaveBeenCalled();
        await harness.coordinator.shutdown();
    });

    it('clears local scheduling state and keeps public work inert after shutdown', async () => {
        const harness = createHarness();
        harness.coordinator.reset();
        await harness.coordinator.shutdown();

        await expect(harness.coordinator.handleOrderedCatchupComplete({
            peerKey: harness.peerKey, sessionId: 'stopped', reason: 'complete', durationMs: 0,
        })).resolves.toBe(false);
        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(false);
        await expect(harness.coordinator.runPeriodicRepairs()).resolves.toBeUndefined();

        expect(harness.startSession).not.toHaveBeenCalled();
        expect(harness.coordinator.canStartBackgroundPrebuild()).toBe(false);
    });

    it('starts a receiver-requested repair even after the connection was synchronized', async () => {
        const harness = createHarness();

        await expect(harness.coordinator.requestRepair(
            harness.peerKey,
            harness.connection,
        )).resolves.toBe(true);

        expect(harness.connection.negentropySynced).toBe(false);
        expect(harness.startSession).toHaveBeenCalledWith(harness.peerKey, {
            source: 'periodic',
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

    it('handles a failed active-session preselection count without rejecting the scheduler', async () => {
        const harness = createHarness();
        const error = new Error('count failed');
        harness.getActiveSessionCount.mockReturnValue(1);
        harness.count.mockRejectedValueOnce(error);
        const child = logger.child as jest.MockedFunction<typeof logger.child>;
        const index = child.mock.calls.findIndex(([bindings]) => bindings.service === 'hyperswarm-mediator');
        const log = child.mock.results[index].value as ReturnType<typeof logger.child>;
        jest.mocked(log.error).mockClear();

        await expect(harness.coordinator.schedulePreferredSyncs()).resolves.toBeUndefined();

        expect(harness.count).toHaveBeenCalledTimes(1);
        expect(log.error).toHaveBeenCalledWith(
            { error },
            'periodic negentropy repair error',
        );
        expect(harness.startSession).not.toHaveBeenCalled();
        await harness.coordinator.shutdown();
    });

    it('does not schedule traffic before receiving a compatible remote ping', async () => {
        const harness = createHarness();
        harness.connection.initialPingReceived = false;
        harness.connection.negentropySynced = false;

        await harness.coordinator.schedulePreferredSyncs();

        expect(harness.count).not.toHaveBeenCalled();
        expect(harness.startSession).not.toHaveBeenCalled();
        await harness.coordinator.shutdown();
    });
});
