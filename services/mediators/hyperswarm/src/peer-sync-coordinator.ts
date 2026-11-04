import { childLogger } from '@mdip/common/logger';

import type { BootstrapResult } from './bootstrap.js';
import type { OperationSyncStore } from './db/types.js';
import type { ImportPipeline } from './import-pipeline.js';
import type { ConnectionInfo } from './mediator-state.js';
import type { createNegentropyCoordinator } from './negentropy-coordinator.js';
import {
    shouldSchedulePeriodicRepair,
    shouldStartConnectTimeNegentropy,
    shouldStartPostOrderedCatchupNegentropy,
} from './negentropy/policy.js';
import {
    buildOrderedCatchupCapabilities,
    chooseConnectSyncMode,
    normalizePeerCapabilities,
    supportsPeerNegentropy,
    type ConnectSyncModeReason,
    type PeerCapabilities,
    type SyncMode,
} from './negentropy/protocol.js';
import {
    getExpectedOrderedCatchupRequestDecision,
    getOrderedCatchupDecision,
} from './ordered-catchup.js';
import type {
    createOrderedCatchupCoordinator,
    OrderedCatchupOutcome,
} from './ordered-catchup-coordinator.js';
import type {
    HyperMessage,
    PingMessage,
} from './protocol-messages.js';
import type { MediatorSyncStats } from './sync-stats.js';

const log = childLogger({ service: 'hyperswarm-mediator' });

type NegentropyCoordinator = ReturnType<typeof createNegentropyCoordinator>;
type OrderedCatchupCoordinator = ReturnType<typeof createOrderedCatchupCoordinator>;
type SyncSource = 'connect' | 'periodic';

interface PeerSyncCoordinatorOptions {
    negentropyVersion: number;
    orderedCatchupVersion: number;
    transportFramingVersion: number;
    windowSize: number;
    repairIntervalMs: number;
    syncStats: MediatorSyncStats;
    getNodeKey(): string;
    getPeerKeys(): string[];
    getConnection(peerKey: string): ConnectionInfo | undefined;
    getSyncStore(): OperationSyncStore;
    getImportPipeline(): ImportPipeline;
    getNegentropyCoordinator(): NegentropyCoordinator;
    getOrderedCatchupCoordinator(): OrderedCatchupCoordinator;
    waitForInitialPing(peerKey: string, connection: ConnectionInfo): Promise<boolean>;
    onPeersAdvertised(dids: string[]): void;
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

export function createPeerSyncCoordinator(options: PeerSyncCoordinatorOptions) {
    const activeWork = new Set<Promise<unknown>>();
    let outboundStartInProgress = false;
    let accepting = true;
    let shutdownPromise: Promise<void> | null = null;

    function trackWork<T>(task: Promise<T>): Promise<T> {
        activeWork.add(task);
        task.then(
            () => activeWork.delete(task),
            () => activeWork.delete(task),
        );
        return task;
    }

    function choosePeerSyncMode(conn: ConnectionInfo): {
        mode: SyncMode | null;
        reason: ConnectSyncModeReason;
    } {
        return chooseConnectSyncMode(
            conn.capabilities,
            options.negentropyVersion,
            conn.peerTransportFramingVersion === options.transportFramingVersion,
        );
    }

    function supportsPeerNegentropyTransport(conn: ConnectionInfo): boolean {
        return supportsPeerNegentropy(conn.capabilities, options.negentropyVersion)
            && conn.peerTransportFramingVersion === options.transportFramingVersion;
    }

    function buildCompatibilityContext(peerKey: string, conn: ConnectionInfo): object {
        return {
            peer: shortName(peerKey),
            node: conn.nodeName || 'anon',
            capabilities: conn.capabilities,
            peerTransportFramingVersion: conn.peerTransportFramingVersion,
            requiredNegentropyVersion: options.negentropyVersion,
            requiredTransportFramingVersion: options.transportFramingVersion,
        };
    }

    function incrementNoModeReason(reason: ConnectSyncModeReason | null): void {
        options.syncStats.modeSelectionsNoMode += 1;
        if (reason === 'missing_capabilities') {
            options.syncStats.modeSelectionsNoModeMissingCapabilities += 1;
        }
        if (reason === 'negentropy_disabled') {
            options.syncStats.modeSelectionsNoModeNegentropyDisabled += 1;
        }
        if (reason === 'version_mismatch') {
            options.syncStats.modeSelectionsNoModeVersionMismatch += 1;
        }
        if (reason === 'transport_framing_unsupported') {
            options.syncStats.modeSelectionsNoModeTransportFramingUnsupported += 1;
        }
    }

    function logNegentropySuppressed(
        peerKey: string,
        source: SyncSource | 'ordered_catchup_complete',
    ): void {
        if (!options.getConnection(peerKey)) {
            return;
        }

        const state = options.getOrderedCatchupCoordinator().getPeerState(peerKey);
        log.debug({
            peer: shortName(peerKey),
            source,
            orderedCatchupClientSessionId: state.clientSessionId,
            orderedCatchupServerSessionId: state.serverSessionId,
            orderedCatchupServerPendingUntil: state.serverPendingUntil,
            orderedCatchupServerPendingReason: state.serverPendingReason,
            orderedCatchupServerPendingGap: state.serverPendingGap,
        }, 'outbound negentropy suppressed while ordered catch-up is active or expected');
    }

    async function startNegentropySession(
        peerKey: string,
        source: SyncSource | 'ordered_catchup_complete',
        modeReason: ConnectSyncModeReason | 'ordered_catchup_complete' | null = null,
        initiatorOverride?: boolean,
    ): Promise<boolean> {
        const ordered = options.getOrderedCatchupCoordinator();
        ordered.expireServerExpectation(peerKey);
        if (ordered.hasActiveForPeer(peerKey)) {
            logNegentropySuppressed(peerKey, source);
            return false;
        }

        return options.getNegentropyCoordinator().startSession(peerKey, {
            source,
            modeReason,
            initiator: initiatorOverride ?? options.getNodeKey().localeCompare(peerKey) < 0,
        });
    }

    async function startOrderedCatchupSession(
        peerKey: string,
        decisionReason: string,
        gap: number,
    ): Promise<void> {
        const conn = options.getConnection(peerKey);
        if (!conn || !await options.waitForInitialPing(peerKey, conn)) {
            return;
        }

        const negentropy = options.getNegentropyCoordinator();
        const ordered = options.getOrderedCatchupCoordinator();
        const pipeline = options.getImportPipeline();
        if (conn.negentropySynced
            || negentropy.hasActiveSession(peerKey)
            || negentropy.getActiveSessionCount() > 0
            || ordered.hasActiveOutbound()
            || pipeline.queued > 0
            || pipeline.running > 0) {
            return;
        }

        conn.orderedCatchupAttempted = true;
        if (ordered.startClient(peerKey, decisionReason, gap)) {
            conn.syncMode = 'negentropy';
            conn.syncStarted = true;
        }
    }

    async function maybeStartPeerSync(peerKey: string, source: SyncSource = 'connect'): Promise<void> {
        if (!accepting) {
            return;
        }
        const conn = options.getConnection(peerKey);
        if (!conn || !await options.waitForInitialPing(peerKey, conn) || !accepting) {
            return;
        }

        let mode: SyncMode | 'unknown' | null;
        let modeReason: ConnectSyncModeReason | null = null;

        if (source === 'connect') {
            const decision = choosePeerSyncMode(conn);
            mode = decision.mode;
            modeReason = decision.reason;
            conn.syncMode = mode ?? 'unknown';
            if (conn.syncStarted) {
                return;
            }
            options.syncStats.modeSelectionsTotal += 1;
        } else {
            mode = conn.syncMode;
        }

        if (!mode || mode === 'unknown') {
            if (source === 'connect') {
                incrementNoModeReason(modeReason);
                log.info(
                    {
                        ...buildCompatibilityContext(peerKey, conn),
                        modeReason,
                        source,
                    },
                    'peer sync mode unavailable',
                );
            }
            return;
        }

        const ordered = options.getOrderedCatchupCoordinator();
        if (ordered.hasActiveOutbound()) {
            logNegentropySuppressed(peerKey, source);
            return;
        }

        if (source === 'connect') {
            options.syncStats.modeSelectionsNegentropy += 1;
        }

        const pipeline = options.getImportPipeline();
        if (outboundStartInProgress || pipeline.queued > 0 || pipeline.running > 0) {
            return;
        }

        outboundStartInProgress = true;
        try {
            const negentropy = options.getNegentropyCoordinator();
            const initiator = options.getNodeKey().localeCompare(peerKey) < 0;
            const hasActiveSession = negentropy.hasActiveSession(peerKey)
                || ordered.hasActiveForPeer(peerKey);
            const activeNegentropySessions = negentropy.getActiveSessionCount();
            ordered.expireServerExpectation(peerKey);
            let orderedCatchupActive = ordered.hasActiveForPeer(peerKey);

            conn.syncStarted = true;
            if (conn.negentropySynced) {
                return;
            }

            const store = options.getSyncStore();
            const localOperationCount = await store.count();
            if (!accepting || options.getConnection(peerKey) !== conn) {
                return;
            }
            if (!conn.orderedCatchupAttempted) {
                const decision = getOrderedCatchupDecision({
                    localOperationCount,
                    peerCapabilities: conn.capabilities,
                    requiredVersion: options.orderedCatchupVersion,
                    windowSize: options.windowSize,
                });
                if (decision.useOrderedCatchup && !hasActiveSession && activeNegentropySessions === 0) {
                    await startOrderedCatchupSession(peerKey, decision.reason, decision.gap);
                    return;
                }
            }

            if (source === 'connect'
                && initiator
                && !orderedCatchupActive
                && !hasActiveSession
                && activeNegentropySessions === 0) {
                const localOrderedOperationCount = await store.countOrdered();
                if (!accepting || options.getConnection(peerKey) !== conn) {
                    return;
                }
                const expected = getExpectedOrderedCatchupRequestDecision({
                    localOperationCount,
                    localOrderedOperationCount,
                    peerCapabilities: conn.capabilities,
                    requiredVersion: options.orderedCatchupVersion,
                    windowSize: options.windowSize,
                });

                if (expected.expectRequest) {
                    ordered.expectServerRequest(peerKey, expected.reason, expected.gap);
                    orderedCatchupActive = ordered.hasActiveForPeer(peerKey);
                }
            }

            const currentPipeline = options.getImportPipeline();
            const shouldStart = source === 'connect'
                ? shouldStartConnectTimeNegentropy(mode, hasActiveSession, initiator, orderedCatchupActive)
                : shouldSchedulePeriodicRepair({
                    syncMode: mode,
                    hasActiveSession,
                    orderedCatchupActive,
                    importQueueLength: currentPipeline.queued,
                    importQueueRunning: currentPipeline.running,
                    activeNegentropySessions,
                    lastAttemptAtMs: conn.lastNegentropyAttemptAt,
                    nowMs: Date.now(),
                    repairIntervalMs: options.repairIntervalMs,
                    isInitiator: initiator,
                    syncCompleted: conn.negentropySynced,
                });

            if (!shouldStart) {
                if (orderedCatchupActive) {
                    logNegentropySuppressed(peerKey, source);
                }
                return;
            }

            if (activeNegentropySessions > 0
                || !accepting
                || options.getConnection(peerKey) !== conn) {
                return;
            }
            await startNegentropySession(peerKey, source, modeReason);
        }
        finally {
            outboundStartInProgress = false;
        }
    }

    async function schedulePreferredSyncs(): Promise<void> {
        const negentropy = options.getNegentropyCoordinator();
        if (negentropy.getActiveSessionCount() !== 0) {
            return;
        }
        for (const peerKey of options.getPeerKeys()) {
            await maybeStartPeerSync(peerKey, 'periodic');
            if (!accepting || negentropy.getActiveSessionCount() > 0) {
                return;
            }
        }
    }

    async function runPeriodicRepairs(): Promise<void> {
        for (const peerKey of options.getPeerKeys()) {
            try {
                await maybeStartPeerSync(peerKey, 'periodic');
            } catch (error) {
                log.error({ error, peer: shortName(peerKey) }, 'periodic negentropy repair error');
            }
            if (!accepting) {
                return;
            }
        }
        await schedulePreferredSyncs();
    }

    async function startPostOrderedCatchupNegentropy(peerKey: string, reason: string): Promise<boolean> {
        const conn = options.getConnection(peerKey);
        const negentropy = options.getNegentropyCoordinator();
        const pipeline = options.getImportPipeline();
        const shouldStart = shouldStartPostOrderedCatchupNegentropy({
            syncMode: conn?.syncMode ?? 'unknown',
            peerConnected: !!conn,
            peerSupportsNegentropyTransport: conn ? supportsPeerNegentropyTransport(conn) : false,
            hasActiveSession: negentropy.hasActiveSession(peerKey),
            importQueueLength: pipeline.queued,
            importQueueRunning: pipeline.running,
            activeNegentropySessions: negentropy.getActiveSessionCount(),
            syncCompleted: conn?.negentropySynced ?? false,
        });

        if (shouldStart) {
            return startNegentropySession(
                peerKey,
                'ordered_catchup_complete',
                'ordered_catchup_complete',
                true,
            );
        }

        log.debug(
            {
                peer: shortName(peerKey),
                reason,
                syncMode: conn?.syncMode ?? 'unknown',
                peerConnected: !!conn,
                peerSupportsNegentropyTransport: conn ? supportsPeerNegentropyTransport(conn) : false,
                hasActiveSession: negentropy.hasActiveSession(peerKey),
                importQueueLength: pipeline.queued,
                importQueueRunning: pipeline.running,
                activeNegentropySessions: negentropy.getActiveSessionCount(),
                syncCompleted: conn?.negentropySynced ?? false,
            },
            'post ordered catch-up negentropy handoff deferred',
        );
        return false;
    }

    async function handleOrderedCatchupComplete(outcome: OrderedCatchupOutcome): Promise<boolean> {
        if (!accepting) {
            return false;
        }
        const conn = options.getConnection(outcome.peerKey);
        if (conn) {
            conn.orderedCatchupAttempted = true;
        }
        options.getNegentropyCoordinator().markStoreChanged('ordered_catchup_complete');
        return startPostOrderedCatchupNegentropy(outcome.peerKey, outcome.reason);
    }

    async function handleNegentropySessionClosed(peerKey: string, reason: string): Promise<void> {
        options.getOrderedCatchupCoordinator().finishTransition(peerKey);
        if (accepting && reason !== 'ordered_catchup_active') {
            await schedulePreferredSyncs();
        }
    }

    async function handleMessage(peerKey: string, message: HyperMessage): Promise<void> {
        if (!accepting) {
            return;
        }
        if (message.type === 'ordered_catchup_req'
            || message.type === 'ordered_catchup_push'
            || message.type === 'ordered_catchup_done') {
            await options.getOrderedCatchupCoordinator().handleMessage(peerKey, message);
            return;
        }
        if (message.type !== 'neg_open'
            && message.type !== 'neg_msg'
            && message.type !== 'ops_req'
            && message.type !== 'ops_push'
            && message.type !== 'neg_close') {
            return;
        }

        if (message.type === 'neg_open') {
            const ordered = options.getOrderedCatchupCoordinator();
            const state = ordered.getPeerState(peerKey);
            await options.getNegentropyCoordinator().handleMessage(peerKey, message, {
                activeSessionId: ordered.getActiveSessionId(peerKey),
                globalActive: ordered.hasActiveOutbound(),
                peerActive: ordered.hasActiveForPeer(peerKey),
                transitionActive: state.transitionActive,
            });
            return;
        }
        await options.getNegentropyCoordinator().handleMessage(peerKey, message);
    }

    async function handlePing(
        peerKey: string,
        message: PingMessage,
        expectedConnection: ConnectionInfo,
    ): Promise<void> {
        const conn = options.getConnection(peerKey);
        if (conn !== expectedConnection) {
            return;
        }

        conn.capabilities = normalizePeerCapabilities(message.capabilities);
        log.info(
            {
                ...buildCompatibilityContext(peerKey, conn),
                rawCapabilities: message.capabilities ?? null,
            },
            'peer capabilities received',
        );
        if (Array.isArray(message.peers)) {
            options.onPeersAdvertised(message.peers);
        }

        if (options.getConnection(peerKey) === conn) {
            await maybeStartPeerSync(peerKey, 'connect');
            await schedulePreferredSyncs();
        }
    }

    function handleDisconnected(peerKey: string, reason: string): void {
        options.getOrderedCatchupCoordinator().removePeer(peerKey, reason);
        options.getNegentropyCoordinator().removePeer(peerKey, reason);
    }

    function handleQuarantined(
        peerKey: string,
        reason: string,
        expectedConnection: ConnectionInfo,
    ): void {
        if (options.getConnection(peerKey) !== expectedConnection) {
            return;
        }
        expectedConnection.syncMode = 'unknown';
        expectedConnection.syncStarted = false;
        expectedConnection.negentropySynced = false;
        handleDisconnected(peerKey, reason);
    }

    function resetConnection(conn: ConnectionInfo): void {
        conn.syncMode = 'unknown';
        conn.syncStarted = false;
        conn.lastNegentropyAttemptAt = 0;
        conn.negentropySynced = false;
        conn.orderedCatchupAttempted = false;
    }

    function resetAfterGatekeeperReset(sync: BootstrapResult): void {
        const negentropy = options.getNegentropyCoordinator();
        const activeSessions = negentropy.getActiveSessionCount();
        const peerKeys = options.getPeerKeys();
        options.getOrderedCatchupCoordinator().reset('gatekeeper_reset');
        for (const peerKey of peerKeys) {
            const conn = options.getConnection(peerKey);
            if (conn) {
                resetConnection(conn);
            }
        }
        log.warn(
            {
                resetReason: sync.resetReason,
                countBefore: sync.countBefore,
                countAfter: sync.countAfter,
                mode: sync.mode,
                pages: sync.pages,
                inserted: sync.inserted,
                updated: sync.updated,
                activeSessions,
                connectedPeers: peerKeys.length,
            },
            'gatekeeper reset detected; hyperswarm runtime sync state reset',
        );
    }

    async function restartAfterGatekeeperReset(): Promise<void> {
        if (!accepting) {
            return;
        }
        for (const peerKey of options.getPeerKeys()) {
            await maybeStartPeerSync(peerKey, 'connect');
            if (!accepting || options.getNegentropyCoordinator().getActiveSessionCount() > 0) {
                return;
            }
        }
        await schedulePreferredSyncs();
    }

    async function handleIndexRefreshed(source: string, sync: BootstrapResult): Promise<void> {
        if (sync.resetReason) {
            resetAfterGatekeeperReset(sync);
        }
        await options.getNegentropyCoordinator().handleIndexRefreshed(source, sync);
        if (!accepting) {
            return;
        }

        log.debug({ source, sync }, 'gatekeeper index sync complete');
        if (sync.resetReason) {
            await restartAfterGatekeeperReset();
        }
    }

    function tracked<T>(work: () => Promise<T>, fallback: T): Promise<T> {
        if (!accepting) {
            return Promise.resolve(fallback);
        }
        return trackWork(work());
    }

    function shutdown(): Promise<void> {
        if (!shutdownPromise) {
            accepting = false;
            outboundStartInProgress = false;
            shutdownPromise = Promise.allSettled([...activeWork]).then(() => undefined);
        }
        return shutdownPromise;
    }

    return {
        async buildCapabilities(): Promise<PeerCapabilities> {
            const [status, latestSignedTimestamp] = await Promise.all([
                options.getOrderedCatchupCoordinator().getLocalStatus(),
                options.getSyncStore().getLatestSignedTimestamp(),
            ]);
            return {
                negentropy: true,
                negentropyVersion: options.negentropyVersion,
                ...(latestSignedTimestamp === null ? {} : { latestSignedTimestamp }),
                ...buildOrderedCatchupCapabilities({
                    version: options.orderedCatchupVersion,
                    operationCount: status.operationCount,
                    orderedOperationCount: status.orderedOperationCount,
                }),
            };
        },
        maybeStartPeerSync(peerKey: string, source: SyncSource = 'connect'): Promise<void> {
            return tracked(() => maybeStartPeerSync(peerKey, source), undefined);
        },
        schedulePreferredSyncs(): Promise<void> {
            return tracked(schedulePreferredSyncs, undefined);
        },
        runPeriodicRepairs(): Promise<void> {
            return tracked(runPeriodicRepairs, undefined);
        },
        handleMessage(peerKey: string, message: HyperMessage): Promise<void> {
            return tracked(() => handleMessage(peerKey, message), undefined);
        },
        handlePing(peerKey: string, message: PingMessage, connection: ConnectionInfo): Promise<void> {
            return tracked(() => handlePing(peerKey, message, connection), undefined);
        },
        handleDisconnected,
        handleQuarantined,
        handleIndexRefreshed(source: string, sync: BootstrapResult): Promise<void> {
            return tracked(() => handleIndexRefreshed(source, sync), undefined);
        },
        handleOrderedCatchupComplete(outcome: OrderedCatchupOutcome): Promise<boolean> {
            return tracked(() => handleOrderedCatchupComplete(outcome), false);
        },
        handleOrderedCatchupFailure(): void {
            // Periodic scheduling retries failed handoffs.
        },
        handleNegentropySessionClosed(peerKey: string, reason: string): Promise<void> {
            return tracked(() => handleNegentropySessionClosed(peerKey, reason), undefined);
        },
        canStartBackgroundPrebuild(): boolean {
            return accepting && !options.getOrderedCatchupCoordinator().hasActiveOutbound();
        },
        reset(): void {
            outboundStartInProgress = false;
        },
        shutdown,
    };
}
