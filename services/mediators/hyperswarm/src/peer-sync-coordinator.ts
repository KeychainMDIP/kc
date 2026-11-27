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
    normalizePeerCapabilities,
    type PeerCapabilities,
} from './negentropy/protocol.js';
import {
    getExpectedOrderedCatchupRequestDecision,
    getOrderedCatchupDecision,
    type OrderedCatchupDecision,
} from './ordered-catchup.js';
import type {
    createOrderedCatchupCoordinator,
    OrderedCatchupOutcome,
} from './ordered-catchup-coordinator.js';
import type {
    HyperMessage,
    NegCloseOutcome,
    PingMessage,
} from './protocol-messages.js';

const log = childLogger({ service: 'hyperswarm-mediator' });

type NegentropyCoordinator = ReturnType<typeof createNegentropyCoordinator>;
type OrderedCatchupCoordinator = ReturnType<typeof createOrderedCatchupCoordinator>;
type SyncSource = 'connect' | 'periodic';

interface PeerSyncCoordinatorOptions {
    windowSize: number;
    repairIntervalMs: number;
    getNodeKey(): string;
    getPeerKeys(): string[];
    getConnection(peerKey: string): ConnectionInfo | undefined;
    getSyncStore(): OperationSyncStore;
    getImportPipeline(): ImportPipeline;
    getNegentropyCoordinator(): NegentropyCoordinator;
    getOrderedCatchupCoordinator(): OrderedCatchupCoordinator;
    waitForInitialPing(peerKey: string, connection: ConnectionInfo): Promise<boolean>;
    onPeersAdvertised(dids: string[]): void;
    onIndexReset?(): void;
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

export function createPeerSyncCoordinator(options: PeerSyncCoordinatorOptions) {
    const activeWork = new Set<Promise<unknown>>();
    let outboundStartInProgress = false;
    let orderedCatchupPending = false;
    let accepting = true;
    let shutdownPromise: Promise<void> | null = null;
    let recoveryGeneration = 0;
    const recoveryRepairs = new Set<string>();
    let lastStartOpportunityPeerKey: string | null = null;

    function trackWork<T>(task: Promise<T>): Promise<T> {
        activeWork.add(task);
        task.then(
            () => activeWork.delete(task),
            () => activeWork.delete(task),
        );
        return task;
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
        initiatorOverride?: boolean,
    ): Promise<boolean> {
        if (!options.getImportPipeline().available) return false;
        const ordered = options.getOrderedCatchupCoordinator();
        ordered.expireServerExpectation(peerKey);
        if (ordered.hasActiveForPeer(peerKey)) {
            logNegentropySuppressed(peerKey, source);
            return false;
        }

        return options.getNegentropyCoordinator().startSession(peerKey, {
            source,
            initiator: initiatorOverride ?? options.getNodeKey().localeCompare(peerKey) < 0,
        });
    }

    async function startOrderedCatchupSession(
        peerKey: string,
    ): Promise<void> {
        const conn = options.getConnection(peerKey);
        if (!conn || !await options.waitForInitialPing(peerKey, conn) || !accepting
            || options.getConnection(peerKey) !== conn || conn.terminationStarted) {
            return;
        }

        const negentropy = options.getNegentropyCoordinator();
        const ordered = options.getOrderedCatchupCoordinator();
        const pipeline = options.getImportPipeline();
        if (conn.negentropySynced || !pipeline.available || ordered.hasActiveOutbound()) {
            return;
        }

        orderedCatchupPending = true;
        try {
            // Stop fallback reconciliation, then finish already admitted work before switching modes.
            negentropy.interruptForOrderedCatchup();
            await pipeline.waitForIdle();
            const localOperationCount = await options.getSyncStore().count();
            if (!accepting || options.getConnection(peerKey) !== conn || conn.terminationStarted
                || conn.negentropySynced || !pipeline.available || ordered.hasActiveOutbound()
            ) {
                return;
            }
            const decision = getOrderedCatchupDecision({
                localOperationCount,
                peerCapabilities: conn.capabilities,
                windowSize: options.windowSize,
            });
            if (decision.useOrderedCatchup) {
                conn.orderedCatchupRetryAfter = 0;
                conn.orderedCatchupAttempted = true;
                if (ordered.startClient(peerKey, decision.reason, decision.gap)) {
                    conn.syncStarted = true;
                }
            }
        }
        finally {
            orderedCatchupPending = false;
        }
    }

    function preferredOrderedPeer(localOperationCount: number): {
        peerKey: string;
        decision: OrderedCatchupDecision;
    } | undefined {
        let preferred: ReturnType<typeof preferredOrderedPeer>;
        const now = Date.now();
        for (const peerKey of options.getPeerKeys()) {
            const conn = options.getConnection(peerKey);
            if (!conn || !conn.initialPingSent || !conn.initialPingReceived
                || conn.terminationStarted || conn.negentropySynced
                || conn.negentropyRetryAfter > now || conn.orderedCatchupRetryAfter > now
                || conn.orderedCatchupAttempted && conn.orderedCatchupRetryAfter <= 0
                || options.getOrderedCatchupCoordinator().hasActiveForPeer(peerKey)) {
                continue;
            }
            const decision = getOrderedCatchupDecision({
                localOperationCount,
                peerCapabilities: conn.capabilities,
                windowSize: options.windowSize,
            });
            if (decision.useOrderedCatchup && (!preferred || decision.gap > preferred.decision.gap)) {
                preferred = { peerKey, decision };
            }
        }
        return preferred;
    }

    async function maybeStartPeerSync(
        peerKey: string,
        source: SyncSource = 'connect',
        orderedOnly = false,
    ): Promise<void> {
        if (!accepting || !options.getImportPipeline().available) {
            return;
        }
        const conn = options.getConnection(peerKey);
        if (!conn || !await options.waitForInitialPing(peerKey, conn) || !accepting
            || options.getConnection(peerKey) !== conn || conn.terminationStarted
            || !conn.initialPingReceived) {
            return;
        }
        if (conn.orderedCatchupRetryAfter > 0
            && conn.orderedCatchupRetryAfter <= Date.now()) {
            conn.orderedCatchupRetryAfter = 0;
            conn.orderedCatchupAttempted = false;
        }
        if (conn.negentropyRetryAfter > Date.now()) {
            return;
        }

        const alreadyStarted = conn.syncStarted;

        const ordered = options.getOrderedCatchupCoordinator();
        if (ordered.hasActiveOutbound()) {
            logNegentropySuppressed(peerKey, source);
            return;
        }

        if (outboundStartInProgress) {
            return;
        }
        const pipeline = options.getImportPipeline();
        if (!pipeline.available || !preferredOrderedPeer(0) && (orderedOnly
            || options.getNegentropyCoordinator().getActiveSessionCount() > 0
            || pipeline.queued > 0 || pipeline.running > 0)) {
            return;
        }

        outboundStartInProgress = true;
        try {
            const negentropy = options.getNegentropyCoordinator();
            const initiator = recoveryRepairs.has(peerKey) || options.getNodeKey().localeCompare(peerKey) < 0;
            const hasActiveSession = negentropy.hasActiveSession(peerKey)
                || ordered.hasActiveForPeer(peerKey);
            const activeNegentropySessions = negentropy.getActiveSessionCount();
            ordered.expireServerExpectation(peerKey);
            let orderedCatchupActive = ordered.hasActiveForPeer(peerKey);

            if (conn.negentropySynced) {
                return;
            }

            const store = options.getSyncStore();
            const localOperationCount = await store.count();
            if (!accepting || !options.getImportPipeline().available || options.getConnection(peerKey) !== conn) {
                return;
            }
            const preferred = preferredOrderedPeer(localOperationCount);
            if (preferred) {
                await startOrderedCatchupSession(preferred.peerKey);
                return;
            }
            if (orderedOnly) {
                return;
            }

            if (pipeline.queued > 0 || pipeline.running > 0 || source === 'connect' && alreadyStarted) {
                return;
            }
            conn.syncStarted = true;

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
                    windowSize: options.windowSize,
                });

                if (expected.expectRequest) {
                    ordered.expectServerRequest(peerKey, expected.reason, expected.gap);
                    orderedCatchupActive = ordered.hasActiveForPeer(peerKey);
                }
            }

            const currentPipeline = options.getImportPipeline();
            const shouldStart = source === 'connect'
                ? shouldStartConnectTimeNegentropy(hasActiveSession, initiator, orderedCatchupActive)
                : shouldSchedulePeriodicRepair({
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
            await startNegentropySession(peerKey, source, initiator);
        }
        finally {
            outboundStartInProgress = false;
        }
    }

    async function schedulePreferredSyncs(orderedOnly = false): Promise<void> {
        const negentropy = options.getNegentropyCoordinator();
        if (orderedCatchupPending || outboundStartInProgress) {
            return;
        }
        const hadActiveNegentropy = negentropy.getActiveSessionCount() > 0;
        if (hadActiveNegentropy) {
            let peerKey: string | undefined;
            outboundStartInProgress = true;
            try {
                const localOperationCount = await options.getSyncStore().count();
                if (!accepting || !options.getImportPipeline().available
                    || negentropy.getActiveSessionCount() === 0
                    || options.getOrderedCatchupCoordinator().hasActiveOutbound()) {
                    return;
                }
                const preferred = preferredOrderedPeer(localOperationCount);
                if (!preferred) {
                    return;
                }
                peerKey = preferred.peerKey;
                await startOrderedCatchupSession(peerKey);
            }
            catch (error) {
                log.error({
                    error,
                    ...(peerKey ? { peer: shortName(peerKey) } : {}),
                }, 'periodic negentropy repair error');
            }
            finally {
                outboundStartInProgress = false;
            }
            return;
        }
        const peerKeys = [...options.getPeerKeys()].sort();
        if (peerKeys.length === 0) {
            return;
        }
        const previousPeerKey = lastStartOpportunityPeerKey;
        const startIndex = previousPeerKey === null
            ? 0
            : Math.max(0, peerKeys.findIndex(key => key > previousPeerKey));
        const orderedPeerKeys = [
            ...peerKeys.slice(startIndex),
            ...peerKeys.slice(0, startIndex),
        ];
        for (const peerKey of orderedPeerKeys) {
            if (!hadActiveNegentropy) {
                lastStartOpportunityPeerKey = peerKey;
            }
            try {
                await maybeStartPeerSync(peerKey, 'periodic', orderedOnly);
            }
            catch (error) {
                log.error({ error, peer: shortName(peerKey) }, 'periodic negentropy repair error');
            }
            if (!accepting || !hadActiveNegentropy && negentropy.getActiveSessionCount() > 0
                || options.getOrderedCatchupCoordinator().hasActiveOutbound()) {
                return;
            }
        }
    }

    async function runPeriodicRepairs(): Promise<void> {
        await schedulePreferredSyncs();
    }

    async function requestRepair(
        peerKey: string,
        expectedConnection: ConnectionInfo,
    ): Promise<boolean> {
        const conn = options.getConnection(peerKey);
        if (conn !== expectedConnection
            || !await options.waitForInitialPing(peerKey, conn)
            || !accepting
            || options.getConnection(peerKey) !== conn
            || conn.terminationStarted
            || !conn.initialPingSent
            || !conn.initialPingReceived
            || conn.negentropyRetryAfter > Date.now()) {
            return false;
        }

        const negentropy = options.getNegentropyCoordinator();
        const ordered = options.getOrderedCatchupCoordinator();
        const pipeline = options.getImportPipeline();
        ordered.expireServerExpectation(peerKey);
        if (outboundStartInProgress
            || negentropy.getActiveSessionCount() > 0
            || ordered.hasActiveOutbound()
            || ordered.hasActiveForPeer(peerKey)
            || pipeline.queued > 0
            || pipeline.running > 0) {
            return false;
        }

        outboundStartInProgress = true;
        try {
            conn.negentropySynced = false;
            conn.syncStarted = true;
            return await startNegentropySession(peerKey, 'periodic', true);
        }
        finally {
            outboundStartInProgress = false;
        }
    }

    async function startPostOrderedCatchupNegentropy(peerKey: string, reason: string): Promise<boolean> {
        const conn = options.getConnection(peerKey);
        const negentropy = options.getNegentropyCoordinator();
        const pipeline = options.getImportPipeline();
        const peerReady = !!conn
            && !conn.terminationStarted
            && conn.initialPingSent
            && conn.initialPingReceived;
        const shouldStart = shouldStartPostOrderedCatchupNegentropy({
            peerReady,
            hasActiveSession: negentropy.hasActiveSession(peerKey),
            importQueueLength: pipeline.queued,
            importQueueRunning: pipeline.running,
            activeNegentropySessions: negentropy.getActiveSessionCount(),
            syncCompleted: conn?.negentropySynced ?? false,
        });

        if (shouldStart) {
            return startNegentropySession(peerKey, 'ordered_catchup_complete', true);
        }

        log.debug(
            {
                peer: shortName(peerKey),
                reason,
                peerReady,
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

    async function handleOrderedCatchupFailure(outcome: OrderedCatchupOutcome): Promise<void> {
        if (!accepting) {
            return;
        }
        const conn = options.getConnection(outcome.peerKey);
        if (!conn) {
            return;
        }
        if (outcome.reason === 'gatekeeper_processing_unavailable') {
            conn.orderedCatchupAttempted = false;
            conn.syncStarted = false;
            return;
        }
        if (outcome.reason !== 'ordered_catchup_import_capacity') return;
        conn.orderedCatchupRetryAfter = Date.now() + options.repairIntervalMs;
        await options.getImportPipeline().waitForIdle();
        if (accepting) {
            await schedulePreferredSyncs();
        }
    }

    async function handleNegentropySessionClosed(peerKey: string, outcome: NegCloseOutcome): Promise<void> {
        options.getOrderedCatchupCoordinator().finishTransition(peerKey);
        if (outcome === 'complete') recoveryRepairs.delete(peerKey);
        const recoveryPending = recoveryRepairs.has(peerKey);
        if (recoveryPending) {
            const conn = options.getConnection(peerKey);
            if (conn) {
                conn.negentropySynced = false;
                if (outcome === 'busy') conn.lastNegentropyAttemptAt = 0;
            }
        }
        if (accepting && (outcome !== 'busy' || recoveryPending)) {
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
            && message.type !== 'ops_offer'
            && message.type !== 'ops_req'
            && message.type !== 'ops_push'
            && message.type !== 'ops_ack'
            && message.type !== 'neg_close') {
            return;
        }

        if (message.type === 'neg_open') {
            await schedulePreferredSyncs(true);
            const ordered = options.getOrderedCatchupCoordinator();
            await options.getNegentropyCoordinator().handleMessage(peerKey, message, {
                activeSessionId: ordered.getActiveSessionId(peerKey),
                globalActive: orderedCatchupPending || ordered.hasActiveOutbound(),
                peerActive: ordered.hasActiveForPeer(peerKey),
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

        conn.capabilities = normalizePeerCapabilities(message);
        log.info(
            {
                peer: shortName(peerKey),
                node: conn.nodeName || 'anon',
                capabilities: conn.capabilities,
                wireVersion: conn.wireVersion,
                rawCapabilities: {
                    latestTs: message.latestTs ?? null,
                    ordered: message.ordered ?? null,
                },
            },
            'peer capabilities received',
        );
        if (Array.isArray(message.peerDids)) {
            options.onPeersAdvertised(message.peerDids);
        }

        if (options.getConnection(peerKey) === conn) {
            await maybeStartPeerSync(peerKey, 'connect');
            await schedulePreferredSyncs();
        }
    }

    function handleDisconnected(peerKey: string, reason: string): void {
        recoveryRepairs.delete(peerKey);
        options.getOrderedCatchupCoordinator().removePeer(peerKey, reason);
        options.getNegentropyCoordinator().removePeer(peerKey, reason);
    }

    function resetConnection(conn: ConnectionInfo): void {
        conn.syncStarted = false;
        conn.lastNegentropyAttemptAt = 0;
        conn.negentropyRetryAfter = 0;
        conn.negentropyBusyGeneration = -1;
        conn.negentropyBusyRetryAfter = 0;
        conn.negentropySynced = false;
        conn.orderedCatchupAttempted = false;
        conn.orderedCatchupRetryAfter = 0;
    }

    function resetAfterGatekeeperReset(sync: BootstrapResult): void {
        options.onIndexReset?.();
        recoveryRepairs.clear();
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
        const recovered = (sync.processingRecoveryGeneration ?? 0) > recoveryGeneration;
        if (recovered) recoveryGeneration = sync.processingRecoveryGeneration!;
        if (sync.resetReason) {
            resetAfterGatekeeperReset(sync);
        }
        else if (recovered) {
            // Gossip skipped during the local pause can fall outside an older reconciliation snapshot.
            for (const peerKey of options.getPeerKeys()) {
                const conn = options.getConnection(peerKey);
                if (conn) {
                    recoveryRepairs.add(peerKey);
                    conn.negentropySynced = false;
                    conn.lastNegentropyAttemptAt = 0;
                }
            }
            options.getNegentropyCoordinator().reset('gatekeeper_processing_unavailable');
        }
        await options.getNegentropyCoordinator().handleIndexRefreshed(source, sync);
        if (!accepting) {
            return;
        }

        log.debug({ source, sync }, 'gatekeeper index sync complete');
        if (sync.resetReason) {
            await restartAfterGatekeeperReset();
        }
        else if (recovered) {
            await schedulePreferredSyncs();
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
            recoveryRepairs.clear();
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
                ...(latestSignedTimestamp === null ? {} : { latestTs: latestSignedTimestamp }),
                ordered: buildOrderedCatchupCapabilities({
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
        requestRepair(peerKey: string, connection: ConnectionInfo): Promise<boolean> {
            return tracked(() => requestRepair(peerKey, connection), false);
        },
        handleMessage(peerKey: string, message: HyperMessage): Promise<void> {
            return tracked(() => handleMessage(peerKey, message), undefined);
        },
        handlePing(peerKey: string, message: PingMessage, connection: ConnectionInfo): Promise<void> {
            return tracked(() => handlePing(peerKey, message, connection), undefined);
        },
        handleDisconnected,
        handleIndexRefreshed(source: string, sync: BootstrapResult): Promise<void> {
            return tracked(() => handleIndexRefreshed(source, sync), undefined);
        },
        handleOrderedCatchupComplete(outcome: OrderedCatchupOutcome): Promise<boolean> {
            return tracked(() => handleOrderedCatchupComplete(outcome), false);
        },
        handleOrderedCatchupFailure(outcome: OrderedCatchupOutcome): Promise<void> {
            return tracked(() => handleOrderedCatchupFailure(outcome), undefined);
        },
        handleNegentropySessionClosed(peerKey: string, outcome: NegCloseOutcome): Promise<void> {
            return tracked(() => handleNegentropySessionClosed(peerKey, outcome), undefined);
        },
        canStartBackgroundPrebuild(): boolean {
            return accepting && !orderedCatchupPending && !options.getOrderedCatchupCoordinator().hasActiveOutbound();
        },
        reset(): void {
            outboundStartInProgress = false;
            orderedCatchupPending = false;
            recoveryGeneration = 0;
            recoveryRepairs.clear();
            lastStartOpportunityPeerKey = null;
        },
        shutdown,
    };
}
