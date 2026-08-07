import type { Operation } from '@mdip/gatekeeper/types';
import { childLogger } from '@mdip/common/logger';

import type {
    OperationSyncStore,
    SyncOperationRecord,
    SyncStoreCursor,
} from './db/types.js';
import type { ImportPipeline } from './import-pipeline.js';
import type { BootstrapResult } from './bootstrap.js';
import type { ConnectionInfo } from './mediator-state.js';
import NegentropyAdapter, {
    type NegentropyWindowEngine,
    type NegentropyWindowSnapshot,
    type NegentropyWindowStats,
    type ReconciliationWindow,
} from './negentropy/adapter.js';
import {
    NEG_SYNC_ID_RE,
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    normalizeNegentropyIds,
    parseRemoteWindow,
    supportsPeerNegentropy,
    type ConnectSyncModeReason,
} from './negentropy/protocol.js';
import { decideInboundNegOpenConflict } from './negentropy/policy.js';
import { addAggregateSample } from './negentropy/observability.js';
import {
    collectNewIds,
    chunkIds,
    chunkOperationsForPush,
} from './negentropy/transfer.js';
import {
    normalizeInboundOpsPushBatch,
    orderSyncRecordsForPush,
} from './operation-order.js';
import {
    compareSyncCursor,
    getContinuationCursorDecision,
} from './negentropy/cursor.js';
import {
    buildInitialHistoryWindow,
    buildNextHistoryPage,
    buildRoundCapSplitWindow,
    cloneCursor,
    cloneWindowSnapshot,
    cloneWindowStats,
    makeWindowId,
    MDIP_EPOCH_SECONDS,
    windowLabel,
} from './negentropy/windows.js';
import { mapOperationToSyncKey } from './sync-mapping.js';
import type {
    HyperMessage,
    HyperMessageBase,
    NativeNegentropyFrame,
    NegCloseMessage,
    NegentropyRoundOutcome,
    NegMsgMessage,
    NegOpenMessage,
    OpsPushMessage,
    OpsReqMessage,
} from './protocol-messages.js';
import type { MediatorSyncStats } from './sync-stats.js';

const log = childLogger({ service: 'hyperswarm-mediator' });

type NegentropyMessage =
    | NegOpenMessage
    | NegMsgMessage
    | OpsReqMessage
    | OpsPushMessage
    | NegCloseMessage;

interface PeerSyncSession {
    sessionId: string;
    peerKey: string;
    initiator: boolean;
    windows: ReconciliationWindow[];
    windowIndex: number;
    windowId: string | null;
    currentWindowStats: NegentropyWindowStats | null;
    currentWindowSnapshot: NegentropyWindowSnapshot | null;
    currentWindowEngine: NegentropyWindowEngine | null;
    startedAt: number;
    lastActivity: number;
    pendingHaveIds: Set<string>;
    pendingNeedIds: Set<string>;
    unresolvedNeedIds: Set<string>;
    unresolvedOperations: Map<string, Operation>;
    rounds: number;
    maxRounds: number;
    reconciliationComplete: boolean;
    localClosed: boolean;
    receivedPushIds: Set<string>;
    receivedKnownPushIds: Set<string>;
    provenStoredPushIds: Set<string>;
    receivedPushMaxCursor: SyncStoreCursor | null;
    remoteWindowCappedByRecords: boolean;
    remoteWindowLastCursor: SyncStoreCursor | null;
}

interface NegentropyCoordinatorOptions {
    version: number;
    transportFramingVersion: number;
    frameSizeLimit: number;
    maxRecordsPerWindow: number;
    maxRoundsPerSession: number;
    maxIdsPerRequest: number;
    maxIdsPerLookup: number;
    maxOpsPerPush: number;
    maxBytesPerPush: number;
    adapterMaxAgeMs: number;
    idleTimeoutMs: number;
    syncStore: OperationSyncStore;
    importPipeline: ImportPipeline;
    syncStats: MediatorSyncStats;
    getConnection(peerKey: string): ConnectionInfo | undefined;
    createSessionId(peerKey: string): string;
    createBaseMessage<T extends NegentropyMessage['type']>(
        type: T,
    ): Omit<HyperMessageBase, 'type'> & { type: T };
    sendToPeer(peerKey: string, message: HyperMessage): boolean;
    waitForInitialPing(peerKey: string, connection: ConnectionInfo): Promise<boolean>;
    getOrderedCatchupState(peerKey: string): {
        activeSessionId: string | null;
        globalActive: boolean;
        peerActive: boolean;
        transitionActive: boolean;
    };
    hasActiveOutboundOrderedCatchup(): boolean;
    finishOrderedCatchupTransition(peerKey: string): void;
    terminatePeerConnection(peerKey: string, reason: string): void;
    onSessionClosed(peerKey: string, reason: string): void | Promise<void>;
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

function summarizeSyncIds(ids: Iterable<string>, maxSample = 10): {
    count: number;
    sample: string[];
    first: string | null;
    last: string | null;
} {
    const list = Array.from(ids);
    return {
        count: list.length,
        sample: list.slice(0, maxSample),
        first: list[0] ?? null,
        last: list[list.length - 1] ?? null,
    };
}

function createSessionState(
    peerKey: string,
    sessionId: string,
    initiator: boolean,
    maxRounds: number,
): PeerSyncSession {
    const now = Date.now();
    return {
        sessionId,
        peerKey,
        initiator,
        windows: [],
        windowIndex: 0,
        windowId: null,
        currentWindowStats: null,
        currentWindowSnapshot: null,
        currentWindowEngine: null,
        startedAt: now,
        lastActivity: now,
        pendingHaveIds: new Set<string>(),
        pendingNeedIds: new Set<string>(),
        unresolvedNeedIds: new Set<string>(),
        unresolvedOperations: new Map<string, Operation>(),
        rounds: 0,
        maxRounds,
        reconciliationComplete: false,
        localClosed: false,
        receivedPushIds: new Set<string>(),
        receivedKnownPushIds: new Set<string>(),
        provenStoredPushIds: new Set<string>(),
        receivedPushMaxCursor: null,
        remoteWindowCappedByRecords: false,
        remoteWindowLastCursor: null,
    };
}

export function createNegentropyCoordinator(options: NegentropyCoordinatorOptions) {
    const peerSessions = new Map<string, PeerSyncSession>();
    const activeWork = new Set<Promise<unknown>>();
    let negentropyAdapter: NegentropyAdapter | null = null;
    let adapterChangeSeq = 0;
    let adapterBuiltSeq = -1;
    let adapterBuiltAt = 0;
    let adapterBuiltWindowId: string | null = null;
    let adapterBuiltSnapshot: NegentropyWindowSnapshot | null = null;
    let rebuildPromise: Promise<void> | null = null;
    let backgroundPrebuildQueued = false;
    let backgroundPrebuildPromise: Promise<void> | null = null;
    let shutdownStarted = false;
    let shutdownPromise: Promise<void> | null = null;

    function trackWork<T>(task: Promise<T>): Promise<T> {
        activeWork.add(task);
        task.then(
            () => activeWork.delete(task),
            () => activeWork.delete(task),
        );
        return task;
    }

    function supportsPeerTransport(conn: ConnectionInfo): boolean {
        return supportsPeerNegentropy(conn.capabilities, options.version)
            && conn.peerTransportFramingVersion === options.transportFramingVersion;
    }

    function createPeerSession(peerKey: string, initiator: boolean, sessionId?: string): PeerSyncSession {
        const now = Date.now();
        const session = createSessionState(
            peerKey,
            sessionId ?? options.createSessionId(peerKey),
            initiator,
            options.maxRoundsPerSession,
        );
        peerSessions.set(peerKey, session);
        const conn = options.getConnection(peerKey);
        if (conn) {
            conn.syncMode = 'negentropy';
            conn.syncStarted = true;
            conn.lastNegentropyAttemptAt = now;
        }
        options.syncStats.negentropySessionsStarted += 1;
        return session;
    }

    function touchPeerSession(peerKey: string): void {
        const session = peerSessions.get(peerKey);
        if (session) {
            session.lastActivity = Date.now();
        }
    }

    function closePeerSession(peerKey: string, reason: string): void {
        const session = peerSessions.get(peerKey);
        if (!session) {
            return;
        }

        const retryOnNextPeriodic = reason === 'ordered_catchup_active';
        peerSessions.delete(peerKey);
        options.finishOrderedCatchupTransition(peerKey);
        addAggregateSample(options.syncStats.syncDurationMs, Date.now() - session.startedAt);
        const conn = options.getConnection(peerKey);
        if (conn) {
            conn.lastNegentropyAttemptAt = retryOnNextPeriodic ? 0 : Date.now();
            options.syncStats.negentropySessionsClosed += 1;
            if (reason === 'complete') {
                conn.negentropySynced = true;
                options.syncStats.negentropySessionsCompleted += 1;
            }
            else {
                conn.negentropySynced = false;
                options.syncStats.negentropySessionsFailed += 1;
            }
        }

        maybeStartBackgroundPrebuild('session_closed');
        const callback = Promise.resolve()
            .then(() => options.onSessionClosed(peerKey, reason))
            .catch(error => {
                log.error(
                    { error, peer: shortName(peerKey), reason },
                    'negentropy session-close callback failed',
                );
            });
        void trackWork(callback);

        log.debug({
            peer: shortName(peerKey),
            mode: 'negentropy',
            rounds: session.rounds,
            pendingHave: session.pendingHaveIds.size,
            pendingNeed: session.pendingNeedIds.size,
            unresolvedNeed: session.unresolvedNeedIds.size,
            reason,
        }, 'peer sync session closed');
    }

    function isNegentropyAdapterDirty(): boolean {
        return adapterBuiltSeq < adapterChangeSeq;
    }

    function markNegentropyAdapterDirty(): void {
        adapterChangeSeq += 1;
    }

    function invalidateNegentropyAdapterCache(): void {
        markNegentropyAdapterDirty();
        adapterBuiltSeq = -1;
        adapterBuiltAt = 0;
        adapterBuiltWindowId = null;
        adapterBuiltSnapshot = null;
        rebuildPromise = null;
        backgroundPrebuildQueued = false;
    }

    function currentSyncTimestampSeconds(): number {
        return Math.floor(Date.now() / 1000);
    }

    function getSessionWindow(session: PeerSyncSession): ReconciliationWindow | null {
        if (session.windowIndex < 0 || session.windowIndex >= session.windows.length) {
            return null;
        }
        return session.windows[session.windowIndex];
    }

    function initializeSessionWindowState(
        session: PeerSyncSession,
        window: ReconciliationWindow,
        windowId: string,
        windowStats: NegentropyWindowStats,
    ): void {
        session.windowId = windowId;
        session.pendingHaveIds = new Set<string>();
        session.pendingNeedIds = new Set<string>();
        session.reconciliationComplete = false;
        session.receivedPushIds = new Set<string>();
        session.receivedKnownPushIds = new Set<string>();
        session.provenStoredPushIds.clear();
        session.receivedPushMaxCursor = null;
        session.remoteWindowCappedByRecords = false;
        session.remoteWindowLastCursor = null;
        session.currentWindowSnapshot = null;
        session.currentWindowEngine = null;
        session.currentWindowStats = {
            ...windowStats,
            windowName: window.name,
            fromTs: window.fromTs,
            toTs: window.toTs,
            rounds: 0,
            completed: false,
            cappedByRounds: false,
        };
    }

    function finalizeCurrentWindowStats(
        session: PeerSyncSession,
        settings: { completed?: boolean; cappedByRounds?: boolean } = {},
    ): NegentropyWindowStats | null {
        if (!session.currentWindowStats) {
            return null;
        }

        const finished: NegentropyWindowStats = {
            ...session.currentWindowStats,
            completed: settings.completed ?? true,
            cappedByRounds: settings.cappedByRounds ?? false,
        };
        if (session.currentWindowStats.completed) {
            return session.currentWindowStats;
        }
        session.currentWindowStats = finished;
        return finished;
    }

    async function buildInitialHistoryWindowForSession(): Promise<ReconciliationWindow> {
        if (!negentropyAdapter) {
            throw new Error('negentropy adapter unavailable');
        }

        return buildInitialHistoryWindow(
            MDIP_EPOCH_SECONDS,
            currentSyncTimestampSeconds(),
            options.maxRecordsPerWindow,
        );
    }

    function maybeStartBackgroundPrebuild(reason: string): void {
        if (shutdownStarted || !negentropyAdapter || !isNegentropyAdapterDirty()) {
            return;
        }

        if (options.hasActiveOutboundOrderedCatchup() || peerSessions.size > 0) {
            return;
        }

        if (backgroundPrebuildPromise || rebuildPromise) {
            backgroundPrebuildQueued = true;
            return;
        }

        backgroundPrebuildQueued = false;
        const currentBackgroundPrebuild: Promise<void> = (async () => {
            const window = await buildInitialHistoryWindowForSession();
            if (!shutdownStarted) {
                await ensureWindowAdapterFresh(window, `background_${reason}`);
            }
        })()
            .catch(error => {
                log.error({ error, reason }, 'background negentropy prebuild failed');
            })
            .finally(() => {
                if (backgroundPrebuildPromise === currentBackgroundPrebuild) {
                    backgroundPrebuildPromise = null;
                }
                if (shutdownStarted) {
                    backgroundPrebuildQueued = false;
                    return;
                }
                if (!backgroundPrebuildQueued) {
                    return;
                }

                backgroundPrebuildQueued = false;
                if (isNegentropyAdapterDirty() && peerSessions.size === 0) {
                    maybeStartBackgroundPrebuild('queued_followup');
                }
            });
        backgroundPrebuildPromise = currentBackgroundPrebuild;
    }

    async function ensureWindowAdapterFresh(
        window: ReconciliationWindow,
        reason: string,
    ): Promise<NegentropyWindowSnapshot> {
        if (shutdownStarted) {
            throw new Error('mediator is shutting down');
        }
        if (!negentropyAdapter) {
            throw new Error('negentropy adapter unavailable');
        }

        const targetWindowId = makeWindowId(window);
        const now = Date.now();
        const recentlyBuilt = adapterBuiltAt > 0
            && (now - adapterBuiltAt) <= options.adapterMaxAgeMs;
        const sameWindow = adapterBuiltWindowId === targetWindowId;

        if (!isNegentropyAdapterDirty() && recentlyBuilt && sameWindow) {
            const cached = cloneWindowSnapshot(adapterBuiltSnapshot);
            if (cached) {
                return cached;
            }
        }

        if (rebuildPromise) {
            await rebuildPromise;
            if (shutdownStarted) {
                throw new Error('mediator is shutting down');
            }
            const recentAfterWait = adapterBuiltAt > 0
                && (Date.now() - adapterBuiltAt) <= options.adapterMaxAgeMs;
            const sameWindowAfterWait = adapterBuiltWindowId === targetWindowId;
            if (!isNegentropyAdapterDirty() && recentAfterWait && sameWindowAfterWait) {
                const cached = cloneWindowSnapshot(adapterBuiltSnapshot);
                if (cached) {
                    return cached;
                }
            }
        }

        const rebuildStartSeq = adapterChangeSeq;
        const rebuildStartedAt = Date.now();
        const currentRebuildPromise = (async () => {
            const snapshot = await negentropyAdapter!.buildSnapshotForWindow(window);
            adapterBuiltSeq = rebuildStartSeq;
            adapterBuiltAt = Date.now();
            adapterBuiltWindowId = targetWindowId;
            adapterBuiltSnapshot = cloneWindowSnapshot(snapshot);
            log.debug(
                {
                    reason,
                    durationMs: adapterBuiltAt - rebuildStartedAt,
                    adapterBuiltAt,
                    windowId: targetWindowId,
                    window: windowLabel(window),
                    dirtyAfterRebuild: isNegentropyAdapterDirty(),
                },
                'negentropy adapter rebuilt from sync-store',
            );
        })();

        rebuildPromise = currentRebuildPromise;
        try {
            await currentRebuildPromise;
        }
        finally {
            if (rebuildPromise === currentRebuildPromise) {
                rebuildPromise = null;
            }
        }

        const refreshed = cloneWindowSnapshot(adapterBuiltSnapshot);
        if (!refreshed) {
            throw new Error(`negentropy window snapshot unavailable after rebuild (${targetWindowId})`);
        }
        return refreshed;
    }

    async function startNextNegentropyWindow(peerKey: string, session: PeerSyncSession): Promise<void> {
        if (!negentropyAdapter) {
            throw new Error('negentropy adapter unavailable');
        }

        const window = getSessionWindow(session);
        if (!window) {
            throw new Error(`missing reconciliation window at index ${session.windowIndex}`);
        }

        const windowId = makeWindowId(window);
        const snapshot = await ensureWindowAdapterFresh(window, 'session_open_initiator');
        if (peerSessions.get(peerKey) !== session) {
            return;
        }
        initializeSessionWindowState(session, window, windowId, cloneWindowStats(snapshot.stats)!);
        session.currentWindowSnapshot = snapshot;
        session.currentWindowEngine = negentropyAdapter.createEngineForSnapshot(snapshot);
        const firstFrame = await session.currentWindowEngine.initiate();
        if (peerSessions.get(peerKey) !== session) {
            return;
        }
        const msg: NegOpenMessage = {
            ...options.createBaseMessage('neg_open'),
            sessionId: session.sessionId,
            windowId,
            window: {
                name: window.name,
                fromTs: window.fromTs,
                toTs: window.toTs,
                maxRecords: window.maxRecords,
                order: window.order,
                after: window.after
                    ? {
                        ts: window.after.ts,
                        id: window.after.id,
                    }
                    : undefined,
            },
            round: session.rounds,
            frame: encodeNegentropyFrame(firstFrame),
        };

        if (!options.sendToPeer(peerKey, msg)) {
            closePeerSession(peerKey, 'send_neg_open_failed');
            return;
        }

        log.debug(
            {
                peer: shortName(peerKey),
                sessionId: session.sessionId,
                windowId,
                window: windowLabel(window),
            },
            'negentropy window open sent'
        );
    }

    function buildWindowProgress(session: PeerSyncSession): NegMsgMessage['windowProgress'] | undefined {
        const stats = session.currentWindowStats;
        if (!stats) {
            return undefined;
        }

        return {
            cappedByRecords: stats.cappedByRecords,
            lastCursor: stats.lastCursor
                ? {
                    ts: stats.lastCursor.ts,
                    id: stats.lastCursor.id,
                }
                : undefined,
        };
    }

    function parseWindowProgress(raw: NegMsgMessage['windowProgress'] | NegCloseMessage['windowProgress']): {
        cappedByRecords: boolean;
        lastCursor: SyncStoreCursor | null;
    } | null {
        if (!raw || typeof raw !== 'object') {
            return null;
        }

        const cappedByRecords = raw.cappedByRecords === true;
        const lastCursor = raw.lastCursor;

        if (!lastCursor) {
            return {
                cappedByRecords,
                lastCursor: null,
            };
        }

        const ts = Number(lastCursor.ts);
        const id = String(lastCursor.id ?? '').toLowerCase();
        if (!Number.isInteger(ts) || !NEG_SYNC_ID_RE.test(id)) {
            return null;
        }

        return {
            cappedByRecords,
            lastCursor: {
                ts,
                id,
            },
        };
    }

    function trackRemoteWindowProgress(
        session: PeerSyncSession,
        raw: NegMsgMessage['windowProgress'] | NegCloseMessage['windowProgress'],
    ): void {
        const progress = parseWindowProgress(raw);
        if (!progress) {
            return;
        }

        session.remoteWindowCappedByRecords = progress.cappedByRecords;
        session.remoteWindowLastCursor = cloneCursor(progress.lastCursor);
    }

    function getNextWindowOrder(session: PeerSyncSession): number {
        let maxOrder = -1;
        for (const window of session.windows) {
            if (window.order > maxOrder) {
                maxOrder = window.order;
            }
        }

        return maxOrder + 1;
    }

    function getSessionContinuationDecision(session: PeerSyncSession): {
        windowAfter: SyncStoreCursor | null;
        localCappedByRecords: boolean;
        localLastCursor: SyncStoreCursor | null;
        remoteCappedByRecords: boolean;
        remoteLastCursor: SyncStoreCursor | null;
        receivedPushCount: number;
        receivedKnownPushCount: number;
        receivedPushMaxCursor: SyncStoreCursor | null;
        chosenCursor: SyncStoreCursor | null;
        blockedByAfter: boolean;
    } {
        const window = getSessionWindow(session);
        if (!window) {
            return {
                windowAfter: null,
                localCappedByRecords: false,
                localLastCursor: null,
                remoteCappedByRecords: false,
                remoteLastCursor: null,
                receivedPushCount: 0,
                receivedKnownPushCount: 0,
                receivedPushMaxCursor: null,
                chosenCursor: null,
                blockedByAfter: false,
            };
        }

        const localStats = session.currentWindowStats;
        const localCappedByRecords = localStats?.cappedByRecords === true;
        const localLastCursor = cloneCursor(localStats?.lastCursor);
        const remoteCappedByRecords = session.remoteWindowCappedByRecords;
        const remoteLastCursor = cloneCursor(session.remoteWindowLastCursor);
        const receivedPushCount = session.receivedPushIds.size;
        const receivedKnownPushCount = session.receivedKnownPushIds.size;
        const receivedPushMaxCursor = cloneCursor(session.receivedPushMaxCursor);
        const decision = getContinuationCursorDecision({
            windowName: window.name,
            windowAfter: cloneCursor(window.after),
            windowMaxRecords: window.maxRecords,
            localCappedByRecords,
            localLastCursor,
            remoteCappedByRecords,
            remoteLastCursor,
            receivedPushCount,
            receivedKnownPushCount,
            receivedPushMaxCursor,
        });

        return {
            windowAfter: cloneCursor(window.after),
            localCappedByRecords,
            localLastCursor,
            remoteCappedByRecords,
            remoteLastCursor,
            receivedPushCount,
            receivedKnownPushCount,
            receivedPushMaxCursor,
            chosenCursor: decision.chosenCursor,
            blockedByAfter: decision.blockedByAfter,
        };
    }

    async function maybeContinueCappedWindowPaging(peerKey: string, session: PeerSyncSession): Promise<boolean> {
        const currentWindow = getSessionWindow(session);
        if (!currentWindow) {
            return false;
        }

        const decision = getSessionContinuationDecision(session);
        const cursor = decision.chosenCursor;

        if (!cursor) {
            return false;
        }

        const nextWindow = buildNextHistoryPage(currentWindow, cursor, getNextWindowOrder(session));
        session.windows.splice(session.windowIndex + 1, 0, nextWindow);
        session.windowIndex += 1;
        await startNextNegentropyWindow(peerKey, session);
        return true;
    }

    async function maybeSplitWindowOnRoundCap(
        peerKey: string,
        session: PeerSyncSession,
        reason: 'local_max_rounds_reached' | 'remote_max_rounds_reached',
    ): Promise<boolean> {
        const currentWindow = getSessionWindow(session);
        if (!currentWindow) {
            return false;
        }

        const splitWindow = buildRoundCapSplitWindow(currentWindow);
        if (!splitWindow) {
            return false;
        }

        session.windows[session.windowIndex] = splitWindow;
        log.debug(
            {
                peer: shortName(peerKey),
                sessionId: session.sessionId,
                reason,
                previousWindow: windowLabel(currentWindow),
                previousMaxRecords: currentWindow.maxRecords,
                splitWindow: windowLabel(splitWindow),
                splitMaxRecords: splitWindow.maxRecords,
            },
            'negentropy window split after round cap'
        );
        await startNextNegentropyWindow(peerKey, session);
        return true;
    }

    function getExpectedWindowId(session: PeerSyncSession): string {
        if (!session.windowId) {
            throw new Error(`session ${session.sessionId} has no active window`);
        }
        return session.windowId;
    }

    function isCurrentSessionWindow(peerKey: string, session: PeerSyncSession, windowId: string, msgType: string): boolean {
        if (!session.windowId || windowId !== session.windowId) {
            log.warn(
                {
                    peer: shortName(peerKey),
                    sessionId: session.sessionId,
                    msgType,
                    expectedWindowId: session.windowId,
                    receivedWindowId: windowId,
                },
                'ignoring negentropy message for non-current window'
            );
            return false;
        }
        return true;
    }

    async function sendOpsReq(peerKey: string, session: PeerSyncSession, ids: string[]): Promise<void> {
        const normalized = Array.from(new Set(ids.map(id => id.toLowerCase()).filter(id => NEG_SYNC_ID_RE.test(id))));
        const batches = chunkIds(normalized, options.maxIdsPerRequest);

        for (const batch of batches) {
            const msg: OpsReqMessage = {
                ...options.createBaseMessage('ops_req'),
                sessionId: session.sessionId,
                windowId: getExpectedWindowId(session),
                round: session.rounds,
                ids: batch,
            };

            if (!options.sendToPeer(peerKey, msg)) {
                closePeerSession(peerKey, 'send_ops_req_failed');
                return;
            }
            options.syncStats.negentropyOpsReqSent += batch.length;
        }
    }

    async function sendOpsPushForIds(peerKey: string, session: PeerSyncSession, ids: string[]): Promise<void> {
        const normalized = Array.from(new Set(ids.map(id => id.toLowerCase()).filter(id => NEG_SYNC_ID_RE.test(id))));
        const idLookupBatches = chunkIds(normalized, options.maxIdsPerLookup);
        const rows: SyncOperationRecord[] = [];

        for (const idBatch of idLookupBatches) {
            const batchRows = await options.syncStore.getByIds(idBatch);
            if (peerSessions.get(peerKey) !== session) {
                return;
            }
            rows.push(...batchRows);
        }

        const operations = orderSyncRecordsForPush(rows).map(row => row.operation);
        if (operations.length === 0) {
            log.debug(
                {
                    peer: shortName(peerKey),
                    sessionId: session.sessionId,
                    windowId: session.windowId,
                    round: session.rounds,
                    requestedIds: summarizeSyncIds(normalized),
                },
                'negentropy ops_push lookup returned no operations'
            );
            return;
        }

        const opBatches = chunkOperationsForPush(operations, {
            maxOpsPerPush: options.maxOpsPerPush,
            maxBytesPerPush: options.maxBytesPerPush,
        });

        for (const opBatch of opBatches) {
            const msg: OpsPushMessage = {
                ...options.createBaseMessage('ops_push'),
                sessionId: session.sessionId,
                windowId: getExpectedWindowId(session),
                round: session.rounds,
                data: opBatch,
            };

            if (!options.sendToPeer(peerKey, msg)) {
                closePeerSession(peerKey, 'send_ops_push_failed');
                return;
            }
            options.syncStats.negentropyOpsPushSent += opBatch.length;
        }
    }

    function sendNegMsg(peerKey: string, session: PeerSyncSession, frame: string | Uint8Array): boolean {
        const msg: NegMsgMessage = {
            ...options.createBaseMessage('neg_msg'),
            sessionId: session.sessionId,
            windowId: getExpectedWindowId(session),
            round: session.rounds,
            frame: encodeNegentropyFrame(frame),
            windowProgress: buildWindowProgress(session),
        };

        return options.sendToPeer(peerKey, msg);
    }

    function sendNegClose(peerKey: string, session: PeerSyncSession, reason: string): boolean {
        session.localClosed = true;
        const windowId = session.windowId ?? 'none';
        const closeMsg: NegCloseMessage = {
            ...options.createBaseMessage('neg_close'),
            sessionId: session.sessionId,
            windowId,
            round: session.rounds,
            reason,
            windowProgress: buildWindowProgress(session),
        };

        return options.sendToPeer(peerKey, closeMsg);
    }

    async function reconcileNegentropyFrame(
        peerKey: string,
        session: PeerSyncSession,
        frame: NativeNegentropyFrame,
    ): Promise<NegentropyRoundOutcome | null> {
        if (!negentropyAdapter) {
            throw new Error('negentropy adapter unavailable');
        }

        const windowRounds = session.currentWindowStats?.rounds ?? 0;
        if (windowRounds >= session.maxRounds) {
            finalizeCurrentWindowStats(session, { completed: false, cappedByRounds: true });
            if (session.initiator) {
                const split = await maybeSplitWindowOnRoundCap(peerKey, session, 'local_max_rounds_reached');
                if (split) {
                    return null;
                }
            }
            sendNegClose(peerKey, session, 'max_rounds_reached');
            closePeerSession(peerKey, 'max_rounds_reached');
            return null;
        }

        const result = session.currentWindowEngine
            ? await session.currentWindowEngine.reconcile(frame)
            : await negentropyAdapter.reconcile(frame);
        if (peerSessions.get(peerKey) !== session) {
            return null;
        }
        session.rounds += 1;
        if (session.currentWindowStats) {
            session.currentWindowStats.rounds += 1;
        }
        touchPeerSession(peerKey);

        return {
            nextMsg: result.nextMsg,
            haveIds: normalizeNegentropyIds(result.haveIds),
            needIds: normalizeNegentropyIds(result.needIds),
        };
    }

    function trackReceivedWindowOperations(session: PeerSyncSession, operations: Operation[]): void {
        for (const operation of operations) {
            const mapped = mapOperationToSyncKey(operation);
            if (!mapped.ok) {
                continue;
            }

            if (session.receivedPushIds.has(mapped.value.idHex)) {
                continue;
            }

            session.receivedPushIds.add(mapped.value.idHex);
            const cursor: SyncStoreCursor = {
                ts: mapped.value.ts,
                id: mapped.value.idHex,
            };

            if (!session.receivedPushMaxCursor || compareSyncCursor(cursor, session.receivedPushMaxCursor) > 0) {
                session.receivedPushMaxCursor = cursor;
            }
        }
    }

    function filterUnprovenPushOperations(session: PeerSyncSession, operations: Operation[]): Operation[] {
        return operations.filter(operation => {
            const mapped = mapOperationToSyncKey(operation);
            return !mapped.ok || !session.provenStoredPushIds.has(mapped.value.idHex);
        });
    }

    function trackProvenStoredOpsPush(session: PeerSyncSession, operations: Operation[]): boolean {
        if (!session.initiator || session.pendingNeedIds.size === 0) {
            return false;
        }

        let progressed = false;
        for (const operation of operations) {
            const mapped = mapOperationToSyncKey(operation);
            if (!mapped.ok
                || !session.provenStoredPushIds.has(mapped.value.idHex)
                || !session.pendingNeedIds.delete(mapped.value.idHex)) {
                continue;
            }
            session.unresolvedNeedIds.delete(mapped.value.idHex);
            session.unresolvedOperations.delete(mapped.value.idHex);
            session.receivedKnownPushIds.add(mapped.value.idHex);
            progressed = true;
        }
        return progressed;
    }

    function carryReceivedUnresolvedNeeds(session: PeerSyncSession): boolean {
        for (const id of session.pendingNeedIds) {
            if (!session.receivedPushIds.has(id)) {
                return false;
            }
        }

        for (const id of session.pendingNeedIds) {
            session.unresolvedNeedIds.add(id);
        }
        session.pendingNeedIds.clear();
        return true;
    }

    async function refreshStoredUnresolvedNeeds(peerKey: string, session: PeerSyncSession): Promise<boolean> {
        if (peerSessions.get(peerKey) !== session || session.unresolvedNeedIds.size === 0) {
            return true;
        }

        try {
            for (const ids of chunkIds(Array.from(session.unresolvedNeedIds), options.maxIdsPerLookup)) {
                const rows = await options.syncStore.getByIds(ids);
                if (peerSessions.get(peerKey) !== session) {
                    return false;
                }
                for (const row of rows) {
                    session.unresolvedNeedIds.delete(row.id);
                    session.unresolvedOperations.delete(row.id);
                }
            }
            return true;
        }
        catch (error) {
            log.warn(
                { error, peer: shortName(peerKey), unresolved: session.unresolvedNeedIds.size },
                'failed to confirm unresolved negentropy operations'
            );
            return false;
        }
    }

    // Store pre-0.5 operations without previd and descendants of terminal modern forks
    // until restart so completed reconciliation does not retry permanently losing history.
    async function persistTerminalUnresolvedOperations(peerKey: string, session: PeerSyncSession): Promise<void> {
        if (peerSessions.get(peerKey) !== session || session.unresolvedNeedIds.size === 0) {
            return;
        }

        const operations = Array.from(session.unresolvedOperations.entries())
            .filter(([id]) => session.unresolvedNeedIds.has(id))
            .map(([, operation]) => operation);
        if (operations.length === 0) {
            return;
        }

        const imported = await options.importPipeline.enqueue({
            kind: 'terminal',
            name: peerKey,
            data: operations,
            cancelled: () => peerSessions.get(peerKey) !== session,
        });
        if (peerSessions.get(peerKey) !== session) {
            return;
        }
        if (imported.retryable) {
            log.warn(
                { peer: shortName(peerKey), operations: operations.length },
                'failed to persist terminal unresolved operations'
            );
            return;
        }
        for (const id of [...imported.knownIds, ...imported.persistedIds]) {
            session.provenStoredPushIds.add(id);
            session.pendingNeedIds.delete(id);
            session.unresolvedNeedIds.delete(id);
            session.unresolvedOperations.delete(id);
        }
    }

    async function maybeFinalizeInitiatorSession(peerKey: string, session: PeerSyncSession): Promise<void> {
        if (peerSessions.get(peerKey) !== session) {
            return;
        }

        if (!session.initiator) {
            return;
        }

        if (!session.reconciliationComplete) {
            return;
        }

        if (!carryReceivedUnresolvedNeeds(session)) {
            return;
        }

        const continued = await maybeContinueCappedWindowPaging(peerKey, session);
        if (continued || peerSessions.get(peerKey) !== session) {
            return;
        }

        const unresolvedRefreshed = await refreshStoredUnresolvedNeeds(peerKey, session);
        if (peerSessions.get(peerKey) !== session) {
            return;
        }

        if (unresolvedRefreshed) {
            await persistTerminalUnresolvedOperations(peerKey, session);
            if (peerSessions.get(peerKey) !== session) {
                return;
            }
        }

        if (session.unresolvedNeedIds.size > 0) {
            log.warn(
                {
                    peer: shortName(peerKey),
                    sessionId: session.sessionId,
                    unresolvedIds: summarizeSyncIds(session.unresolvedNeedIds),
                },
                'negentropy session completed with unresolved operations'
            );
            if (!sendNegClose(peerKey, session, 'unresolved_operations')) {
                closePeerSession(peerKey, 'send_neg_close_failed');
                return;
            }
            closePeerSession(peerKey, 'unresolved_operations');
            return;
        }

        if (!sendNegClose(peerKey, session, 'complete')) {
            closePeerSession(peerKey, 'send_neg_close_failed');
            return;
        }

        closePeerSession(peerKey, 'complete');
    }

    async function handleNegentropyRoundAsInitiator(
        peerKey: string,
        session: PeerSyncSession,
        frame: string | Uint8Array,
    ): Promise<void> {
        const outcome = await reconcileNegentropyFrame(peerKey, session, frame);
        if (!outcome) {
            return;
        }

        const newHaveIds = collectNewIds(outcome.haveIds, session.pendingHaveIds);
        const newNeedIds = collectNewIds(outcome.needIds, session.pendingNeedIds);
        options.syncStats.negentropyRounds += 1;
        options.syncStats.negentropyHaveIds += outcome.haveIds.length;
        options.syncStats.negentropyNeedIds += outcome.needIds.length;

        if (newHaveIds.length > 0) {
            await sendOpsPushForIds(peerKey, session, newHaveIds);
            if (peerSessions.get(peerKey) !== session) {
                return;
            }
        }

        if (newNeedIds.length > 0) {
            await sendOpsReq(peerKey, session, newNeedIds);
            if (peerSessions.get(peerKey) !== session) {
                return;
            }
        }

        log.debug(
            {
                peer: shortName(peerKey),
                sessionId: session.sessionId,
                round: session.rounds,
                have: outcome.haveIds.length,
                need: outcome.needIds.length,
                pendingNeed: session.pendingNeedIds.size,
            },
            'negentropy initiator round'
        );

        if (outcome.nextMsg !== null) {
            if (!sendNegMsg(peerKey, session, outcome.nextMsg)) {
                closePeerSession(peerKey, 'send_neg_msg_failed');
            }
            return;
        }

        session.reconciliationComplete = true;
        const completedWindow = finalizeCurrentWindowStats(session, { completed: true, cappedByRounds: false });
        if (completedWindow) {
            log.debug(
                {
                    peer: shortName(peerKey),
                    sessionId: session.sessionId,
                    windowId: session.windowId,
                    windowName: completedWindow.windowName,
                    loaded: completedWindow.loaded,
                    skipped: completedWindow.skipped,
                    rounds: completedWindow.rounds,
                    cappedByRecords: completedWindow.cappedByRecords,
                },
                'negentropy window complete (initiator)'
            );
        }
        await maybeFinalizeInitiatorSession(peerKey, session);
    }

    async function handleNegentropyRoundAsResponder(
        peerKey: string,
        session: PeerSyncSession,
        frame: string | Uint8Array,
    ): Promise<void> {
        const outcome = await reconcileNegentropyFrame(peerKey, session, frame);
        if (!outcome) {
            return;
        }
        options.syncStats.negentropyRounds += 1;
        options.syncStats.negentropyHaveIds += outcome.haveIds.length;
        options.syncStats.negentropyNeedIds += outcome.needIds.length;

        log.debug(
            {
                peer: shortName(peerKey),
                sessionId: session.sessionId,
                round: session.rounds,
                have: outcome.haveIds.length,
                need: outcome.needIds.length,
            },
            'negentropy responder round'
        );

        if (outcome.nextMsg !== null) {
            if (!sendNegMsg(peerKey, session, outcome.nextMsg)) {
                closePeerSession(peerKey, 'send_neg_msg_failed');
            }
            return;
        }

        session.reconciliationComplete = true;
        const completedWindow = finalizeCurrentWindowStats(session, { completed: true, cappedByRounds: false });
        if (completedWindow) {
            log.debug(
                {
                    peer: shortName(peerKey),
                    sessionId: session.sessionId,
                    windowId: session.windowId,
                    windowName: completedWindow.windowName,
                    loaded: completedWindow.loaded,
                    skipped: completedWindow.skipped,
                    rounds: completedWindow.rounds,
                    cappedByRecords: completedWindow.cappedByRecords,
                },
                'negentropy window complete (responder)'
            );
        }
    }

    async function handleNegOpenMessage(
        peerKey: string,
        conn: ConnectionInfo,
        msg: NegOpenMessage,
    ): Promise<void> {
        let session = peerSessions.get(peerKey);
        const orderedState = options.getOrderedCatchupState(peerKey);
        const remoteSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : '';
        const activeOrderedCatchupSessionId = orderedState.activeSessionId;
        const conflictDecision = decideInboundNegOpenConflict({
            activeSessionMode: session ? 'negentropy' : null,
            activeSessionId: session?.sessionId ?? null,
            activeOrderedCatchupSessionId,
            remoteSessionId,
        });
        const globalOrderedCatchupActive = orderedState.globalActive;
        const peerOrderedCatchupActive = orderedState.peerActive;

        if (conflictDecision.action === 'ignore' || globalOrderedCatchupActive || peerOrderedCatchupActive) {
            const remoteWindowId = typeof msg.windowId === 'string' ? msg.windowId : '';
            const rejectionSent = remoteSessionId.length > 0
                && remoteWindowId.length > 0
                && supportsPeerTransport(conn)
                && options.sendToPeer(peerKey, {
                    ...options.createBaseMessage('neg_close'),
                    sessionId: remoteSessionId,
                    windowId: remoteWindowId,
                    round: Number.isInteger(msg.round) ? msg.round : 0,
                    reason: 'ordered_catchup_active',
                });
            log.warn(
                {
                    peer: shortName(peerKey),
                    remoteSessionId,
                    activeSessionMode: session ? 'negentropy' : null,
                    activeSessionId: session?.sessionId ?? null,
                    activeOrderedCatchupSessionId,
                    globalOrderedCatchupActive,
                    peerOrderedCatchupActive,
                    postImportActive: orderedState.transitionActive,
                    rejectionSent,
                },
                'rejecting neg_open while ordered catch-up active'
            );
            return;
        }

        if (!negentropyAdapter) {
            log.warn('neg_open ignored because adapter is unavailable');
            return;
        }
        if (!supportsPeerTransport(conn)) {
            log.warn(
                {
                    peer: shortName(peerKey),
                    sessionId: msg.sessionId,
                    peerVersion: conn.capabilities.version,
                    requiredVersion: options.version,
                    peerTransportFramingVersion: conn.peerTransportFramingVersion,
                    requiredTransportFramingVersion: options.transportFramingVersion,
                },
                'ignoring neg_open from incompatible negentropy transport'
            );
            return;
        }

        const window = parseRemoteWindow(msg.window, options.maxRecordsPerWindow);
        if (!window) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_open with invalid window');
            return;
        }
        if (typeof msg.windowId !== 'string' || msg.windowId.length === 0) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_open with invalid windowId');
            return;
        }

        if (conflictDecision.action === 'replace' && session) {
            closePeerSession(peerKey, 'replaced_by_remote_open');
            session = undefined;
        }

        if (!session || session.sessionId !== msg.sessionId) {
            session = createPeerSession(peerKey, false, msg.sessionId);
        }

        session.initiator = false;
        session.maxRounds = options.maxRoundsPerSession;
        const existingIndex = session.windows.findIndex(existingWindow => makeWindowId(existingWindow) === msg.windowId);
        if (existingIndex >= 0) {
            session.windows[existingIndex] = window;
            session.windowIndex = existingIndex;
        } else {
            session.windows.push(window);
            session.windowIndex = session.windows.length - 1;
        }
        const snapshot = await ensureWindowAdapterFresh(window, 'session_open_responder');
        if (peerSessions.get(peerKey) !== session) {
            return;
        }
        initializeSessionWindowState(session, window, msg.windowId, cloneWindowStats(snapshot.stats)!);
        session.currentWindowSnapshot = snapshot;
        session.currentWindowEngine = negentropyAdapter.createEngineForSnapshot(snapshot);
        touchPeerSession(peerKey);
        await handleNegentropyRoundAsResponder(peerKey, session, decodeNegentropyFrame(msg.frame));
    }

    async function handleNegMsgMessage(peerKey: string, msg: NegMsgMessage): Promise<void> {
        const session = peerSessions.get(peerKey);
        if (!session || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_msg for unknown session');
            return;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'neg_msg')) {
            return;
        }

        trackRemoteWindowProgress(session, msg.windowProgress);
        touchPeerSession(peerKey);
        if (session.initiator) {
            await handleNegentropyRoundAsInitiator(peerKey, session, decodeNegentropyFrame(msg.frame));
        } else {
            await handleNegentropyRoundAsResponder(peerKey, session, decodeNegentropyFrame(msg.frame));
        }
    }

    async function handleOpsReqMessage(peerKey: string, msg: OpsReqMessage): Promise<void> {
        const session = peerSessions.get(peerKey);
        if (!session || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ops_req for unknown session');
            return;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'ops_req')) {
            return;
        }

        const requestedIds = Array.isArray(msg.ids)
            ? Array.from(new Set(msg.ids.map(id => String(id).toLowerCase()).filter(id => NEG_SYNC_ID_RE.test(id))))
            : [];
        options.syncStats.negentropyOpsReqReceived += requestedIds.length;
        await sendOpsPushForIds(peerKey, session, requestedIds);
        if (peerSessions.get(peerKey) === session) {
            touchPeerSession(peerKey);
        }
    }

    async function handleOpsPushMessage(peerKey: string, msg: OpsPushMessage): Promise<void> {
        const session = peerSessions.get(peerKey);
        if (!session || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ops_push for unknown session');
            return;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'ops_push')) {
            return;
        }

        const batch = normalizeInboundOpsPushBatch(msg.data);
        if (batch.length > 0) {
            options.syncStats.negentropyOpsPushReceived += batch.length;
            trackReceivedWindowOperations(session, batch);
            const cachedProgress = trackProvenStoredOpsPush(session, batch);
            const unprovenBatch = filterUnprovenPushOperations(session, batch);
            if (unprovenBatch.length === 0) {
                if (cachedProgress && peerSessions.get(peerKey) === session) {
                    touchPeerSession(peerKey);
                }
                await maybeFinalizeInitiatorSession(peerKey, session);
                return;
            }

            const imported = await options.importPipeline.enqueue({
                kind: 'remote',
                name: peerKey,
                data: unprovenBatch,
            });

            if (peerSessions.get(peerKey) !== session) {
                return;
            }
            for (const operation of unprovenBatch) {
                const mapped = mapOperationToSyncKey(operation);
                if (mapped.ok && !session.provenStoredPushIds.has(mapped.value.idHex)) {
                    session.unresolvedNeedIds.add(mapped.value.idHex);
                }
            }
            for (const id of imported.knownIds) {
                session.provenStoredPushIds.add(id);
                session.unresolvedNeedIds.delete(id);
                session.unresolvedOperations.delete(id);
                if (session.initiator && session.pendingNeedIds.delete(id)) {
                    session.receivedKnownPushIds.add(id);
                }
            }
            for (const id of imported.persistedIds) {
                session.provenStoredPushIds.add(id);
                session.pendingNeedIds.delete(id);
                session.unresolvedNeedIds.delete(id);
                session.unresolvedOperations.delete(id);
            }
            if (imported.retryable) {
                for (const operation of unprovenBatch) {
                    const mapped = mapOperationToSyncKey(operation);
                    if (mapped.ok && !session.provenStoredPushIds.has(mapped.value.idHex)) {
                        session.receivedPushIds.delete(mapped.value.idHex);
                        session.unresolvedOperations.delete(mapped.value.idHex);
                    }
                }
            }
            else {
                for (const operation of unprovenBatch) {
                    const mapped = mapOperationToSyncKey(operation);
                    if (mapped.ok
                        && session.unresolvedNeedIds.has(mapped.value.idHex)) {
                        session.unresolvedOperations.set(mapped.value.idHex, operation);
                    }
                }
            }
            await maybeFinalizeInitiatorSession(peerKey, session);
        }

        if (peerSessions.get(peerKey) === session) {
            touchPeerSession(peerKey);
        }
    }

    async function handleNegCloseMessage(peerKey: string, msg: NegCloseMessage): Promise<void> {
        const session = peerSessions.get(peerKey);
        if (session && session.sessionId === msg.sessionId && (!session.windowId || msg.windowId === session.windowId)) {
            trackRemoteWindowProgress(session, msg.windowProgress);
            if (session.initiator && msg.reason === 'max_rounds_reached') {
                finalizeCurrentWindowStats(session, { completed: false, cappedByRounds: true });
                const split = await maybeSplitWindowOnRoundCap(peerKey, session, 'remote_max_rounds_reached');
                if (split) {
                    return;
                }
            }
            if (msg.reason === 'complete') {
                const unresolvedRefreshed = await refreshStoredUnresolvedNeeds(peerKey, session);
                if (peerSessions.get(peerKey) !== session) {
                    return;
                }
                if (unresolvedRefreshed) {
                    await persistTerminalUnresolvedOperations(peerKey, session);
                    if (peerSessions.get(peerKey) !== session) {
                        return;
                    }
                }
                if (session.unresolvedNeedIds.size > 0) {
                    log.warn(
                        {
                            peer: shortName(peerKey),
                            sessionId: session.sessionId,
                            unresolvedIds: summarizeSyncIds(session.unresolvedNeedIds),
                        },
                        'rejecting remote negentropy completion with unresolved operations'
                    );
                    options.terminatePeerConnection(peerKey, 'unresolved_operations');
                    return;
                }
            }
            closePeerSession(peerKey, msg.reason || 'remote_closed');
        }
    }

    async function startSession(
        peerKey: string,
        settings: {
            source: 'connect' | 'periodic' | 'ordered_catchup_complete';
            modeReason: ConnectSyncModeReason | 'ordered_catchup_complete' | null;
            initiator: boolean;
        },
    ): Promise<boolean> {
        if (shutdownStarted) {
            return false;
        }
        const conn = options.getConnection(peerKey);
        if (!conn || !await options.waitForInitialPing(peerKey, conn)) {
            return false;
        }

        const orderedState = options.getOrderedCatchupState(peerKey);
        if (orderedState.peerActive) {
            return false;
        }
        if (conn.negentropySynced || peerSessions.has(peerKey) || peerSessions.size > 0) {
            return false;
        }

        const session = createPeerSession(peerKey, settings.initiator);
        try {
            const initialWindow = await buildInitialHistoryWindowForSession();
            if (peerSessions.get(peerKey) !== session) {
                return false;
            }
            session.windows = [initialWindow];
            session.windowIndex = 0;
            log.info(
                {
                    peer: shortName(peerKey),
                    mode: 'negentropy',
                    modeReason: settings.modeReason,
                    initiator: settings.initiator,
                    sessionId: session.sessionId,
                    source: settings.source,
                    plannedWindows: session.windows.length,
                },
                'peer sync mode selected',
            );
            await startNextNegentropyWindow(peerKey, session);
            return peerSessions.get(peerKey) === session;
        }
        catch (error) {
            if (peerSessions.get(peerKey) === session) {
                closePeerSession(peerKey, 'start_negentropy_failed');
            }
            throw error;
        }
    }

    async function dispatchMessage(peerKey: string, message: NegentropyMessage): Promise<void> {
        if (shutdownStarted) {
            return;
        }
        if (message.type === 'neg_open') {
            const conn = options.getConnection(peerKey);
            if (conn) {
                await handleNegOpenMessage(peerKey, conn, message);
            }
            return;
        }
        if (message.type === 'neg_msg') {
            await handleNegMsgMessage(peerKey, message);
            return;
        }
        if (message.type === 'ops_req') {
            await handleOpsReqMessage(peerKey, message);
            return;
        }
        if (message.type === 'ops_push') {
            await handleOpsPushMessage(peerKey, message);
            return;
        }
        await handleNegCloseMessage(peerKey, message);
    }

    async function initializeAdapter(): Promise<void> {
        negentropyAdapter = await NegentropyAdapter.create({
            syncStore: options.syncStore,
            frameSizeLimit: options.frameSizeLimit,
            maxRecordsPerWindow: options.maxRecordsPerWindow,
            maxRoundsPerSession: options.maxRoundsPerSession,
            deferInitialBuild: true,
        });
        adapterChangeSeq = 0;
        adapterBuiltSeq = -1;
        adapterBuiltAt = 0;
        adapterBuiltWindowId = null;
        adapterBuiltSnapshot = null;
        rebuildPromise = null;
        backgroundPrebuildQueued = false;
        log.info(
            {
                stats: negentropyAdapter.getStats(),
                maxRecordsPerWindow: options.maxRecordsPerWindow,
                maxRoundsPerSession: options.maxRoundsPerSession,
                frameSizeLimit: options.frameSizeLimit,
            },
            'negentropy adapter initialized',
        );
    }

    async function processIndexRefresh(source: string, sync: BootstrapResult): Promise<void> {
        if (sync.resetReason) {
            peerSessions.clear();
            invalidateNegentropyAdapterCache();
        }
        else if (sync.inserted > 0 || sync.updated > 0 || sync.deleted > 0) {
            markNegentropyAdapterDirty();
            if (sync.inserted > 0 || sync.updated > 0) {
                for (const [peerKey, session] of peerSessions) {
                    if (session.unresolvedNeedIds.size > 0) {
                        await refreshStoredUnresolvedNeeds(peerKey, session);
                    }
                }
            }
        }

        if (sync.resetReason || sync.inserted > 0 || sync.updated > 0 || sync.deleted > 0) {
            maybeStartBackgroundPrebuild(`gatekeeper_index_${source}`);
        }
    }

    function reset(): void {
        peerSessions.clear();
        invalidateNegentropyAdapterCache();
    }

    async function shutdown(): Promise<void> {
        if (shutdownPromise) {
            return shutdownPromise;
        }
        shutdownStarted = true;
        backgroundPrebuildQueued = false;
        peerSessions.clear();
        shutdownPromise = (async () => {
            while (activeWork.size > 0 || backgroundPrebuildPromise || rebuildPromise) {
                const work = [
                    ...activeWork,
                    backgroundPrebuildPromise,
                    rebuildPromise,
                ].filter((promise): promise is Promise<unknown> => promise !== null);
                await Promise.allSettled(work);
            }
        })();
        return shutdownPromise;
    }

    return {
        initializeAdapter,
        replaceStore(store: OperationSyncStore, pipeline: ImportPipeline): void {
            options.syncStore = store;
            options.importPipeline = pipeline;
        },
        setAdapter(adapter: NegentropyAdapter | null): void {
            negentropyAdapter = adapter;
            invalidateNegentropyAdapterCache();
        },
        startSession(
            peerKey: string,
            settings: Parameters<typeof startSession>[1],
        ): Promise<boolean> {
            return trackWork(startSession(peerKey, settings));
        },
        handleMessage(peerKey: string, message: NegentropyMessage): Promise<void> {
            return trackWork(dispatchMessage(peerKey, message));
        },
        hasActiveSession(peerKey: string): boolean {
            return peerSessions.has(peerKey);
        },
        getActiveSessionCount(): number {
            return peerSessions.size;
        },
        getActiveSessionId(peerKey: string): string | null {
            return peerSessions.get(peerKey)?.sessionId ?? null;
        },
        markStoreChanged(reason: string): void {
            markNegentropyAdapterDirty();
            maybeStartBackgroundPrebuild(reason);
        },
        handleIndexRefreshed(source: string, sync: BootstrapResult): Promise<void> {
            if (shutdownStarted) {
                return Promise.resolve();
            }
            return trackWork(processIndexRefresh(source, sync));
        },
        expire(now = Date.now()): void {
            for (const [peerKey, session] of peerSessions) {
                if (now - session.lastActivity > options.idleTimeoutMs) {
                    sendNegClose(peerKey, session, 'idle_timeout');
                    closePeerSession(peerKey, 'idle_timeout');
                }
            }
        },
        removePeer(peerKey: string, reason: string): void {
            closePeerSession(peerKey, reason);
        },
        reset,
        shutdown,
    };
}
