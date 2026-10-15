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
    type NegentropyReconcileResult,
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
    estimateOperationBytes,
    validateOperationPage,
} from './negentropy/transfer.js';
import {
    normalizeInboundOpsPushBatch,
    orderSyncRecordsForPush,
} from './operation-order.js';
import {
    validateHyperMessagePayload,
    validateOperationContentIds,
} from './protocol-validation.js';
import { MAX_NEGENTROPY_WINDOW_RECORDS } from './protocol-limits.js';
import {
    compareSyncCursor,
    getContinuationCursorDecision,
} from './negentropy/cursor.js';
import {
    buildInitialHistoryWindow,
    buildNextHistoryPage,
    buildRoundCapSplitWindow,
    cloneCursor,
    cloneWindow,
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
    OpsAckMessage,
    OpsOfferMessage,
    OpsPushMessage,
    OpsReqMessage,
} from './protocol-messages.js';
import type { MediatorSyncStats } from './sync-stats.js';
import type { BulkWorkScheduler } from './bulk-work-scheduler.js';
import type { OperationPageBudget } from './operation-page-budget.js';

const log = childLogger({ service: 'hyperswarm-mediator' });
const MAX_UNRESOLVED_OPERATIONS = 1_000;
const MAX_UNRESOLVED_BYTES = 2 * 1024 * 1024;

type NegentropyMessage =
    | NegOpenMessage
    | NegMsgMessage
    | OpsOfferMessage
    | OpsReqMessage
    | OpsPushMessage
    | OpsAckMessage
    | NegCloseMessage;

interface ActiveOffer {
    offerId: number;
    round: number;
    ids: Set<string>;
}

interface LocalRequest {
    requestId: number;
    round: number;
    expectedIds: Set<string>;
    deliveredIds: Set<string>;
    satisfiedIds: Set<string>;
    nextPage: number;
}

interface ReceivedRequest {
    requestId: number;
    round: number;
    remainingIds: string[];
    page: number;
    awaitingAck: boolean;
}

interface PeerSyncSession {
    sessionId: string;
    peerKey: string;
    initiator: boolean;
    windows: ReconciliationWindow[];
    windowIndex: number;
    windowId: string | null;
    advertisedWindow: ReconciliationWindow | null;
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
    sentPushMaxCursor: SyncStoreCursor | null;
    sentPushCount: number;
    remoteWindowCappedByRecords: boolean;
    remoteWindowLastCursor: SyncStoreCursor | null;
    nextOfferId: number;
    nextRequestId: number;
    nextRemoteOfferId: number;
    nextRemoteRequestId: number;
    activeOffer: ActiveOffer | null;
    localRequest: LocalRequest | null;
    receivedRequest: ReceivedRequest | null;
    seenOfferedIds: Set<string>;
    seenDirectRequestIds: Set<string>;
    seenNeedIds: Set<string>;
    roundHaveIds: string[];
    roundHaveOffset: number;
    roundNeedIds: string[];
    roundNeedOffset: number;
    pendingNextFrame: NativeNegentropyFrame | null;
    roundReadyToFinish: boolean;
    windowIncomplete: boolean;
    unresolvedBytes: Map<string, number>;
    unresolvedTotalBytes: number;
    slotGeneration: number;
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
    idleTimeoutMs: number;
    repairIntervalMs: number;
    syncStore: OperationSyncStore;
    importPipeline: ImportPipeline;
    syncStats: MediatorSyncStats;
    cipher: { hashJSON(value: unknown): string };
    bulkReads: BulkWorkScheduler;
    operationPages: OperationPageBudget;
    getConnection(peerKey: string): ConnectionInfo | undefined;
    createSessionId(peerKey: string): string;
    createBaseMessage<T extends NegentropyMessage['type']>(
        type: T,
    ): Omit<HyperMessageBase, 'type'> & { type: T };
    sendToPeer(peerKey: string, message: HyperMessage): boolean;
    sendBulkToPeer(peerKey: string, message: HyperMessage): Promise<boolean>;
    canStartBackgroundPrebuild(): boolean;
    onProtocolViolation(peerKey: string, reason: string, connection: ConnectionInfo): void;
    terminatePeerConnection(peerKey: string, reason: string): void;
    onSessionClosed(peerKey: string, reason: string): void | Promise<void>;
}

interface NegOpenSchedulingState {
    activeSessionId: string | null;
    globalActive: boolean;
    peerActive: boolean;
    transitionActive: boolean;
}

interface CachedWindowSnapshot {
    cacheKey: string;
    changeSeq: number;
    snapshot: NegentropyWindowSnapshot;
}

interface WindowSnapshotBuild {
    changeSeq: number;
    windowId: string;
    snapshot: NegentropyWindowSnapshot;
}

type WindowSnapshotRetention = 'none' | 'historical' | 'canonical_responder';

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

function makeWindowCacheKey(window: ReconciliationWindow): string {
    const after = window.after ? `${window.after.ts}:${window.after.id}` : 'none';
    return `${window.fromTs}:${window.maxRecords}:${after}`;
}

function cloneSnapshotForWindow(
    snapshot: NegentropyWindowSnapshot,
    window: ReconciliationWindow,
): NegentropyWindowSnapshot {
    const cloned = cloneWindowSnapshot(snapshot)!;
    cloned.window = cloneWindow(window);
    cloned.stats = {
        ...cloned.stats,
        windowName: window.name,
        fromTs: window.fromTs,
        toTs: window.toTs,
    };
    return cloned;
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
        advertisedWindow: null,
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
        sentPushMaxCursor: null,
        sentPushCount: 0,
        remoteWindowCappedByRecords: false,
        remoteWindowLastCursor: null,
        nextOfferId: 0,
        nextRequestId: 0,
        nextRemoteOfferId: 0,
        nextRemoteRequestId: 0,
        activeOffer: null,
        localRequest: null,
        receivedRequest: null,
        seenOfferedIds: new Set<string>(),
        seenDirectRequestIds: new Set<string>(),
        seenNeedIds: new Set<string>(),
        roundHaveIds: [],
        roundHaveOffset: 0,
        roundNeedIds: [],
        roundNeedOffset: 0,
        pendingNextFrame: null,
        roundReadyToFinish: false,
        windowIncomplete: false,
        unresolvedBytes: new Map<string, number>(),
        unresolvedTotalBytes: 0,
        slotGeneration: 0,
    };
}

export function createNegentropyCoordinator(options: NegentropyCoordinatorOptions) {
    const peerSessions = new Map<string, PeerSyncSession>();
    const activeWork = new Set<Promise<unknown>>();
    let negentropyAdapter: NegentropyAdapter | null = null;
    let adapterChangeSeq = 0;
    let adapterBuiltSeq = -1;
    let storeMutationsInFlight = 0;
    const adapterWindowSnapshots = new Map<number, CachedWindowSnapshot>();
    let rebuildPromise: Promise<WindowSnapshotBuild> | null = null;
    let backgroundPrebuildQueued = false;
    let backgroundPrebuildPromise: Promise<void> | null = null;
    let shutdownStarted = false;
    let shutdownPromise: Promise<void> | null = null;
    let slotGeneration = 0;
    let activeSlot: { peerKey: string; sessionId: string; generation: number } | null = null;

    function validateCurrentPayload(peerKey: string, message: NegentropyMessage): boolean {
        const result = validateHyperMessagePayload(message, {
            maxIdsPerRequest: options.maxIdsPerRequest,
            maxOpsPerPush: options.maxOpsPerPush,
            maxBytesPerPush: options.maxBytesPerPush,
            maxFrameBytes: options.frameSizeLimit,
            maxRecordsPerWindow: MAX_NEGENTROPY_WINDOW_RECORDS,
        });
        if (result.ok) {
            return true;
        }
        const connection = options.getConnection(peerKey);
        if (connection) {
            options.onProtocolViolation(peerKey, `invalid_${message.type}: ${result.reason}`, connection);
        }
        return false;
    }

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

    function claimSessionSlot(peerKey: string, sessionId: string): number | null {
        if (activeSlot) {
            return activeSlot.peerKey === peerKey && activeSlot.sessionId === sessionId
                ? activeSlot.generation
                : null;
        }
        slotGeneration += 1;
        activeSlot = { peerKey, sessionId, generation: slotGeneration };
        return slotGeneration;
    }

    function releaseSessionSlot(session: PeerSyncSession): void {
        if (!activeSlot
            || activeSlot.peerKey !== session.peerKey
            || activeSlot.sessionId !== session.sessionId
            || activeSlot.generation !== session.slotGeneration) {
            return;
        }
        activeSlot = null;
    }

    function releaseClaim(peerKey: string, sessionId: string, generation: number): void {
        if (activeSlot?.peerKey === peerKey
            && activeSlot.sessionId === sessionId
            && activeSlot.generation === generation) {
            activeSlot = null;
        }
    }

    function sendSyncBusy(
        peerKey: string,
        conn: ConnectionInfo,
        msg: NegOpenMessage,
        marker: 'slot' | 'retry',
        markerValue: number,
    ): void {
        if ((marker === 'slot' && conn.negentropyBusyGeneration === markerValue)
            || (marker === 'retry' && conn.negentropyBusyRetryAfter === markerValue)) {
            return;
        }
        if (options.sendToPeer(peerKey, {
            ...options.createBaseMessage('neg_close'),
            sessionId: msg.sessionId,
            windowId: msg.windowId,
            round: msg.round,
            reason: 'sync_busy',
        })) {
            if (marker === 'slot') {
                conn.negentropyBusyGeneration = markerValue;
            } else {
                conn.negentropyBusyRetryAfter = markerValue;
            }
        }
    }

    function createPeerSession(peerKey: string, initiator: boolean, sessionId?: string): PeerSyncSession {
        const now = Date.now();
        const resolvedSessionId = sessionId ?? options.createSessionId(peerKey);
        const generation = claimSessionSlot(peerKey, resolvedSessionId);
        if (generation === null) {
            throw new Error('negentropy session slot is busy');
        }
        const session = createSessionState(
            peerKey,
            resolvedSessionId,
            initiator,
            options.maxRoundsPerSession,
        );
        session.slotGeneration = generation;
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

        const retryOnNextPeriodic = session.initiator
            && (reason === 'ordered_catchup_active' || reason === 'sync_busy');
        peerSessions.delete(peerKey);
        releaseSessionSlot(session);
        addAggregateSample(options.syncStats.syncDurationMs, Date.now() - session.startedAt);
        const conn = options.getConnection(peerKey);
        if (conn) {
            conn.lastNegentropyAttemptAt = retryOnNextPeriodic ? 0 : Date.now();
            if (!session.initiator && reason !== 'complete' && !retryOnNextPeriodic) {
                conn.negentropyRetryAfter = Date.now() + options.repairIntervalMs;
            }
            if (reason === 'complete') {
                conn.negentropyRetryAfter = 0;
                conn.negentropyBusyRetryAfter = 0;
            }
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

        let callback: Promise<void>;
        try {
            callback = Promise.resolve(options.onSessionClosed(peerKey, reason));
        }
        catch (error) {
            callback = Promise.reject(error);
        }
        callback = callback
            .catch(error => {
                log.error(
                    { error, peer: shortName(peerKey), reason },
                    'negentropy session-close callback failed',
                );
            });
        void trackWork(callback);
        maybeStartBackgroundPrebuild('session_closed');

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
        return storeMutationsInFlight > 0 || adapterBuiltSeq < adapterChangeSeq;
    }

    function markNegentropyAdapterDirty(): void {
        adapterChangeSeq += 1;
        adapterWindowSnapshots.clear();
    }

    function invalidateNegentropyAdapterCache(): void {
        markNegentropyAdapterDirty();
        adapterBuiltSeq = -1;
        rebuildPromise = null;
        backgroundPrebuildQueued = false;
    }

    function pruneWindowSnapshotsFrom(order: number): void {
        for (const cachedOrder of adapterWindowSnapshots.keys()) {
            if (cachedOrder >= order) {
                adapterWindowSnapshots.delete(cachedOrder);
            }
        }
    }

    function getCachedWindowSnapshot(window: ReconciliationWindow): NegentropyWindowSnapshot | null {
        if (isNegentropyAdapterDirty()) {
            return null;
        }

        const cached = adapterWindowSnapshots.get(window.order);
        if (!cached
            || cached.changeSeq !== adapterChangeSeq
            || cached.cacheKey !== makeWindowCacheKey(window)
            || !cached.snapshot.stats.cappedByRecords
            || cached.snapshot.window.toTs > window.toTs) {
            return null;
        }

        return cloneSnapshotForWindow(cached.snapshot, window);
    }

    function retainHistoricalWindowSnapshot(
        window: ReconciliationWindow,
        snapshot: NegentropyWindowSnapshot,
        changeSeq: number,
    ): void {
        if (storeMutationsInFlight > 0 || changeSeq !== adapterChangeSeq) {
            return;
        }

        pruneWindowSnapshotsFrom(window.order);
        if (!snapshot.stats.cappedByRecords) {
            return;
        }

        adapterWindowSnapshots.set(window.order, {
            cacheKey: makeWindowCacheKey(window),
            changeSeq,
            snapshot: cloneWindowSnapshot(snapshot)!,
        });
    }

    function shouldRetainResponderWindow(window: ReconciliationWindow): boolean {
        if (window.name !== 'history_paged'
            || window.fromTs !== MDIP_EPOCH_SECONDS
            || window.maxRecords !== options.maxRecordsPerWindow) {
            return false;
        }
        if (window.order === 0) {
            return !window.after;
        }
        if (!window.after) {
            return false;
        }

        const previous = adapterWindowSnapshots.get(window.order - 1);
        const previousWindow = previous?.snapshot.window;
        const previousCursor = previous?.snapshot.stats.lastCursor;
        return previous?.changeSeq === adapterChangeSeq
            && previous.snapshot.stats.cappedByRecords
            && previousWindow?.name === window.name
            && previousWindow.fromTs === window.fromTs
            && previousWindow.maxRecords === window.maxRecords
            && previousWindow.order === window.order - 1
            && previousWindow.toTs <= window.toTs
            && !!previousCursor
            && compareSyncCursor(previousCursor, window.after) === 0;
    }

    function retainWindowSnapshot(
        window: ReconciliationWindow,
        snapshot: NegentropyWindowSnapshot,
        changeSeq: number,
        retention: WindowSnapshotRetention,
    ): void {
        if (retention === 'none'
            || (retention === 'canonical_responder' && !shouldRetainResponderWindow(window))) {
            return;
        }
        retainHistoricalWindowSnapshot(window, snapshot, changeSeq);
    }

    function currentSyncTimestampSeconds(): number {
        return Math.floor(Date.now() / 1000);
    }

    function beginStoreMutation(): () => void {
        storeMutationsInFlight += 1;
        markNegentropyAdapterDirty();
        let finished = false;
        return () => {
            if (finished) {
                return;
            }
            finished = true;
            storeMutationsInFlight -= 1;
            markNegentropyAdapterDirty();
        };
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
        advertisedWindow = window,
    ): void {
        session.windowId = windowId;
        session.advertisedWindow = cloneWindow(advertisedWindow);
        session.pendingHaveIds = new Set<string>();
        session.pendingNeedIds = new Set<string>();
        session.reconciliationComplete = false;
        session.localClosed = false;
        session.receivedPushIds = new Set<string>();
        session.receivedKnownPushIds = new Set<string>();
        session.provenStoredPushIds.clear();
        session.receivedPushMaxCursor = null;
        session.sentPushMaxCursor = null;
        session.sentPushCount = 0;
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
        session.activeOffer = null;
        session.localRequest = null;
        session.receivedRequest = null;
        session.seenOfferedIds.clear();
        session.seenDirectRequestIds.clear();
        session.seenNeedIds.clear();
        session.roundHaveIds = [];
        session.roundHaveOffset = 0;
        session.roundNeedIds = [];
        session.roundNeedOffset = 0;
        session.pendingNextFrame = null;
        session.roundReadyToFinish = false;
        session.windowIncomplete = false;
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

    async function buildInitialHistoryWindowForSession(
        peerLatestSignedTimestamp: number | null = null,
    ): Promise<ReconciliationWindow> {
        if (!negentropyAdapter) {
            throw new Error('negentropy adapter unavailable');
        }

        const localLatestSignedTimestamp = await options.syncStore.getLatestSignedTimestamp();
        const toTs = Math.max(
            currentSyncTimestampSeconds(),
            localLatestSignedTimestamp ?? 0,
            peerLatestSignedTimestamp ?? 0,
        );

        return buildInitialHistoryWindow(
            MDIP_EPOCH_SECONDS,
            toTs,
            options.maxRecordsPerWindow,
        );
    }

    function maybeStartBackgroundPrebuild(reason: string): void {
        if (shutdownStarted || !negentropyAdapter || !isNegentropyAdapterDirty()) {
            return;
        }

        if (!options.canStartBackgroundPrebuild() || peerSessions.size > 0) {
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
                await ensureWindowAdapterFresh(window, `background_${reason}`, 'historical');
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
        retention: WindowSnapshotRetention = 'none',
    ): Promise<NegentropyWindowSnapshot> {
        if (shutdownStarted) {
            throw new Error('mediator is shutting down');
        }
        if (!negentropyAdapter) {
            throw new Error('negentropy adapter unavailable');
        }

        const targetWindowId = makeWindowId(window);
        const cached = getCachedWindowSnapshot(window);
        if (cached) {
            return cached;
        }

        if (rebuildPromise) {
            const completedBuild = await rebuildPromise;
            if (shutdownStarted) {
                throw new Error('mediator is shutting down');
            }
            const cachedAfterWait = getCachedWindowSnapshot(window);
            if (cachedAfterWait) {
                return cachedAfterWait;
            }
            if (completedBuild.changeSeq === adapterChangeSeq
                && completedBuild.windowId === targetWindowId) {
                retainWindowSnapshot(
                    window,
                    completedBuild.snapshot,
                    completedBuild.changeSeq,
                    retention,
                );
                return cloneSnapshotForWindow(completedBuild.snapshot, window);
            }
        }

        const rebuildStartSeq = adapterChangeSeq;
        const rebuildStartedAt = Date.now();
        const currentRebuildPromise = (async () => {
            const snapshot = await negentropyAdapter!.buildSnapshotForWindow(window);
            adapterBuiltSeq = rebuildStartSeq;
            retainWindowSnapshot(window, snapshot, rebuildStartSeq, retention);
            const adapterBuiltAt = Date.now();
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
            return {
                changeSeq: rebuildStartSeq,
                windowId: targetWindowId,
                snapshot,
            };
        })();

        rebuildPromise = currentRebuildPromise;
        let completedBuild: WindowSnapshotBuild;
        try {
            completedBuild = await currentRebuildPromise;
        }
        finally {
            if (rebuildPromise === currentRebuildPromise) {
                rebuildPromise = null;
            }
        }

        return cloneSnapshotForWindow(completedBuild.snapshot, window);
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
        const previousWindowProgress = buildWindowProgress(session);
        const snapshot = await ensureWindowAdapterFresh(window, 'session_open_initiator', 'historical');
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
            previousWindowProgress,
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
        return (getSessionWindow(session)?.order ?? -1) + 1;
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
        session.windows = [nextWindow];
        session.windowIndex = 0;
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

    function isAuthorizedNextWindow(session: PeerSyncSession, windowId: string): boolean {
        const currentWindow = session.advertisedWindow;
        if (!currentWindow || session.windowIncomplete
            || session.activeOffer || session.localRequest || session.receivedRequest) {
            return false;
        }

        const splitWindow = buildRoundCapSplitWindow(currentWindow);
        const reachedRoundCap = session.currentWindowStats?.cappedByRounds === true
            || (session.currentWindowStats?.rounds ?? 0) >= session.maxRounds;
        if (!session.reconciliationComplete && reachedRoundCap
            && splitWindow && makeWindowId(splitWindow) === windowId) {
            return true;
        }

        const cursor = getSessionContinuationDecision(session).chosenCursor;
        if (cursor) {
            const continuation = buildNextHistoryPage(currentWindow, cursor, getNextWindowOrder(session));
            if (makeWindowId(continuation) === windowId) {
                return true;
            }
        }
        const completeServedPage = session.sentPushCount >= currentWindow.maxRecords;
        // Each peer can choose a different continuation when one side already had an offered
        // operation. In a capped window, accept the cursor this node demonstrably served even
        // when that asymmetric transfer contained fewer than a complete page.
        const asymmetricCappedPage = session.currentWindowStats?.cappedByRecords === true
            && session.remoteWindowCappedByRecords;
        if ((!completeServedPage && !asymmetricCappedPage)
            || !session.sentPushMaxCursor
            || (currentWindow.after && compareSyncCursor(session.sentPushMaxCursor, currentWindow.after) <= 0)) {
            return false;
        }
        const sentContinuation = buildNextHistoryPage(
            currentWindow,
            session.sentPushMaxCursor,
            getNextWindowOrder(session),
        );
        return makeWindowId(sentContinuation) === windowId;
    }

    function isCurrentSessionWindow(peerKey: string, session: PeerSyncSession, windowId: string, msgType: string): boolean {
        if (!session.windowId || windowId !== session.windowId) {
            reportProtocolViolation(peerKey, `${msgType} is for an unrecognized window`);
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

    function isExpectedRound(
        peerKey: string,
        received: number,
        expected: number,
        msgType: string,
    ): boolean {
        if (received < expected) {
            return false;
        }
        if (received > expected) {
            reportProtocolViolation(peerKey, `${msgType} is for a future round`);
            return false;
        }
        return true;
    }

    function reportProtocolViolation(peerKey: string, reason: string): void {
        const connection = options.getConnection(peerKey);
        if (connection) {
            options.onProtocolViolation(peerKey, reason, connection);
        }
    }

    function sendOpsRequest(
        peerKey: string,
        session: PeerSyncSession,
        ids: string[],
        settings: { offerId?: number; deferred?: boolean } = {},
    ): boolean {
        const requestId = session.nextRequestId;
        session.nextRequestId += 1;
        const msg: OpsReqMessage = {
            ...options.createBaseMessage('ops_req'),
            sessionId: session.sessionId,
            windowId: getExpectedWindowId(session),
            round: session.rounds,
            requestId,
            ...(settings.offerId === undefined ? {} : { offerId: settings.offerId }),
            ids,
            ...(settings.deferred ? { deferred: true } : {}),
        };
        if (!options.sendToPeer(peerKey, msg)) {
            closePeerSession(peerKey, 'send_ops_req_failed');
            return false;
        }
        options.syncStats.negentropyOpsReqSent += ids.length;
        if (ids.length > 0) {
            session.localRequest = {
                requestId,
                round: session.rounds,
                expectedIds: new Set(ids),
                deliveredIds: new Set<string>(),
                satisfiedIds: new Set<string>(),
                nextPage: 0,
            };
        }
        return true;
    }

    function sendOpsOffer(peerKey: string, session: PeerSyncSession, ids: string[]): boolean {
        const offerId = session.nextOfferId;
        session.nextOfferId += 1;
        session.activeOffer = { offerId, round: session.rounds, ids: new Set(ids) };
        const msg: OpsOfferMessage = {
            ...options.createBaseMessage('ops_offer'),
            sessionId: session.sessionId,
            windowId: getExpectedWindowId(session),
            round: session.rounds,
            offerId,
            ids,
        };
        if (!options.sendToPeer(peerKey, msg)) {
            closePeerSession(peerKey, 'send_ops_offer_failed');
            return false;
        }
        return true;
    }

    async function sendNextOpsPage(peerKey: string, session: PeerSyncSession): Promise<void> {
        return options.bulkReads.run(peerKey, async () => {
            const request = session.receivedRequest;
            if (!request || request.awaitingAck || peerSessions.get(peerKey) !== session) {
                return;
            }
            const outboundReservation = options.operationPages.reserve(options.maxBytesPerPush);
            if (!outboundReservation) {
                sendNegClose(peerKey, session, 'ops_push_output_capacity');
                closePeerSession(peerKey, 'ops_push_output_capacity');
                return;
            }
            try {
                const requestedIds = new Set(request.remainingIds);
                const availableIds = new Set<string>();
                let rows: SyncOperationRecord[] = [];
                for (const ids of chunkIds(request.remainingIds, options.maxIdsPerLookup)) {
                    const fetched = await options.syncStore.getByIds(ids);
                    if (peerSessions.get(peerKey) !== session || session.receivedRequest !== request) {
                        return;
                    }
                    const content = validateOperationContentIds(fetched.map(row => row.operation), options.cipher);
                    if (!content.ok) {
                        throw new Error(content.reason);
                    }
                    for (const row of fetched) {
                        const mapped = mapOperationToSyncKey(row.operation);
                        const rowId = row.id.toLowerCase();
                        if (!mapped.ok || mapped.value.idHex !== rowId || !requestedIds.has(rowId)
                    || availableIds.has(rowId)) {
                            throw new Error(`invalid requested operation record ${row.id}`);
                        }
                        availableIds.add(rowId);
                    }
                    const orderedRows = orderSyncRecordsForPush([...rows, ...fetched]);
                    const pages = chunkOperationsForPush(
                        orderedRows.map(row => row.operation),
                        {
                            maxOpsPerPush: options.maxOpsPerPush,
                            maxBytesPerPush: options.maxBytesPerPush,
                        },
                    );
                    const firstPageIds = new Set((pages[0] ?? []).map(operation => {
                        const mapped = mapOperationToSyncKey(operation);
                        if (!mapped.ok) {
                            throw new Error(mapped.reason);
                        }
                        return mapped.value.idHex;
                    }));
                    rows = orderedRows
                        .filter(row => firstPageIds.has(row.id.toLowerCase()));
                }
                const data = orderSyncRecordsForPush(rows).map(row => row.operation);
                const deliveredIds = new Set<string>();
                for (const operation of data) {
                    const mapped = mapOperationToSyncKey(operation);
                    if (mapped.ok) {
                        deliveredIds.add(mapped.value.idHex);
                    }
                }
                for (const row of rows) {
                    const cursor = { ts: row.ts, id: row.id.toLowerCase() };
                    if (!session.sentPushMaxCursor || compareSyncCursor(cursor, session.sentPushMaxCursor) > 0) {
                        session.sentPushMaxCursor = cursor;
                    }
                }
                request.remainingIds = request.remainingIds.filter(id => availableIds.has(id) && !deliveredIds.has(id));
                const hasMore = request.remainingIds.length > 0;
                const msg: OpsPushMessage = {
                    ...options.createBaseMessage('ops_push'),
                    sessionId: session.sessionId,
                    windowId: getExpectedWindowId(session),
                    round: request.round,
                    requestId: request.requestId,
                    page: request.page,
                    hasMore,
                    data,
                };
                if (!await options.sendBulkToPeer(peerKey, msg)) {
                    if (peerSessions.get(peerKey) === session) {
                        closePeerSession(peerKey, 'send_ops_push_failed');
                    }
                    return;
                }
                if (peerSessions.get(peerKey) !== session || session.receivedRequest !== request) {
                    return;
                }
                session.sentPushCount += data.length;
                request.awaitingAck = true;
                touchPeerSession(peerKey);
                options.syncStats.negentropyOpsPushSent += data.length;
            }
            finally {
                outboundReservation.release();
            }
        });
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
            if (session.windowIncomplete) {
                if (!sendNegClose(peerKey, session, 'incomplete')) {
                    closePeerSession(peerKey, 'send_neg_close_failed');
                    return null;
                }
                closePeerSession(peerKey, 'incomplete');
                return null;
            }
            finalizeCurrentWindowStats(session, { completed: false, cappedByRounds: true });
            if (session.initiator) {
                const split = await maybeSplitWindowOnRoundCap(peerKey, session, 'local_max_rounds_reached');
                if (split) {
                    return null;
                }
            }
            if (!sendNegClose(peerKey, session, 'max_rounds_reached')) {
                closePeerSession(peerKey, 'send_neg_close_failed');
                return null;
            }
            if (!session.initiator) {
                touchPeerSession(peerKey);
                return null;
            }
            closePeerSession(peerKey, 'max_rounds_reached');
            return null;
        }

        const connection = options.getConnection(peerKey);
        let result: NegentropyReconcileResult;
        try {
            result = session.currentWindowEngine
                ? await session.currentWindowEngine.reconcile(frame)
                : await negentropyAdapter.reconcile(frame);
        }
        catch {
            if (connection
                && options.getConnection(peerKey) === connection
                && peerSessions.get(peerKey) === session) {
                options.onProtocolViolation(peerKey, 'invalid_negentropy_frame', connection);
            }
            return null;
        }
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

    function clearUnresolvedOperation(session: PeerSyncSession, id: string): void {
        session.unresolvedNeedIds.delete(id);
        session.unresolvedOperations.delete(id);
        const bytes = session.unresolvedBytes.get(id);
        if (bytes !== undefined) {
            session.unresolvedBytes.delete(id);
            session.unresolvedTotalBytes -= bytes;
        }
    }

    function retainUnresolvedOperation(
        session: PeerSyncSession,
        id: string,
        operation?: Operation,
    ): boolean {
        const newId = !session.unresolvedNeedIds.has(id);
        const previousBytes = session.unresolvedBytes.get(id) ?? 0;
        const bytes = operation ? estimateOperationBytes(operation) : previousBytes;
        const nextTotalBytes = session.unresolvedTotalBytes - previousBytes + bytes;
        if ((newId && session.unresolvedNeedIds.size >= MAX_UNRESOLVED_OPERATIONS)
            || nextTotalBytes > MAX_UNRESOLVED_BYTES) {
            return false;
        }
        session.unresolvedNeedIds.add(id);
        if (operation) {
            session.unresolvedOperations.set(id, operation);
            session.unresolvedBytes.set(id, bytes);
            session.unresolvedTotalBytes = nextTotalBytes;
        }
        return true;
    }

    function filterUnprovenPushOperations(session: PeerSyncSession, operations: Operation[]): Operation[] {
        return operations.filter(operation => {
            const mapped = mapOperationToSyncKey(operation);
            return !mapped.ok || !session.provenStoredPushIds.has(mapped.value.idHex);
        });
    }

    function carryReceivedUnresolvedNeeds(session: PeerSyncSession): boolean {
        for (const id of session.pendingNeedIds) {
            if (!session.receivedPushIds.has(id)) {
                return false;
            }
        }

        for (const id of session.pendingNeedIds) {
            if (!retainUnresolvedOperation(session, id)) {
                return false;
            }
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
                    clearUnresolvedOperation(session, row.id);
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
            clearUnresolvedOperation(session, id);
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
            if (!sendNegClose(peerKey, session, 'unresolved_limit_exceeded')) {
                closePeerSession(peerKey, 'send_neg_close_failed');
                return;
            }
            closePeerSession(peerKey, 'unresolved_limit_exceeded');
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

    async function driveInitiatorTransfers(peerKey: string, session: PeerSyncSession): Promise<void> {
        if (peerSessions.get(peerKey) !== session || !session.initiator
            || session.activeOffer || session.localRequest || session.receivedRequest) {
            return;
        }

        if (session.roundHaveOffset < session.roundHaveIds.length) {
            const ids = session.roundHaveIds.slice(
                session.roundHaveOffset,
                session.roundHaveOffset + options.maxIdsPerRequest,
            );
            session.roundHaveOffset += ids.length;
            sendOpsOffer(peerKey, session, ids);
            return;
        }

        while (session.roundNeedOffset < session.roundNeedIds.length) {
            const ids = session.roundNeedIds.slice(
                session.roundNeedOffset,
                session.roundNeedOffset + options.maxIdsPerRequest,
            );
            session.roundNeedOffset += ids.length;
            const filtered = options.importPipeline.filterRetryDelayedIds(ids);
            const deferred = [...filtered.pendingIds, ...filtered.capacityDeferredIds];
            if (deferred.length > 0) {
                session.windowIncomplete = true;
                for (const id of deferred) {
                    session.pendingNeedIds.delete(id);
                }
            }
            if (filtered.eligibleIds.length === 0) {
                continue;
            }
            sendOpsRequest(peerKey, session, filtered.eligibleIds);
            return;
        }

        if (session.pendingNextFrame !== null) {
            const frame = session.pendingNextFrame;
            session.pendingNextFrame = null;
            if (!sendNegMsg(peerKey, session, frame)) {
                closePeerSession(peerKey, 'send_neg_msg_failed');
            }
            return;
        }

        if (!session.roundReadyToFinish) {
            return;
        }
        session.roundReadyToFinish = false;
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
        if (session.windowIncomplete) {
            if (!sendNegClose(peerKey, session, 'incomplete')) {
                closePeerSession(peerKey, 'send_neg_close_failed');
                return;
            }
            closePeerSession(peerKey, 'incomplete');
            return;
        }
        await maybeFinalizeInitiatorSession(peerKey, session);
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
        const newNeedIds = collectNewIds(outcome.needIds, session.seenNeedIds);
        for (const id of newNeedIds) {
            session.pendingNeedIds.add(id);
        }
        const windowMaxRecords = getSessionWindow(session)?.maxRecords ?? options.maxRecordsPerWindow;
        if (session.pendingHaveIds.size > windowMaxRecords || session.seenNeedIds.size > windowMaxRecords) {
            closePeerSession(peerKey, 'negentropy_outcome_exceeds_window');
            return;
        }
        options.syncStats.negentropyRounds += 1;
        options.syncStats.negentropyHaveIds += outcome.haveIds.length;
        options.syncStats.negentropyNeedIds += outcome.needIds.length;

        session.roundHaveIds = newHaveIds;
        session.roundHaveOffset = 0;
        session.roundNeedIds = newNeedIds;
        session.roundNeedOffset = 0;
        session.pendingNextFrame = outcome.nextMsg;
        session.roundReadyToFinish = outcome.nextMsg === null;

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

        await driveInitiatorTransfers(peerKey, session);
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
        schedulingState?: NegOpenSchedulingState,
    ): Promise<void> {
        let session = peerSessions.get(peerKey);
        const remoteSessionId = msg.sessionId;
        if (!session && activeSlot && activeSlot.peerKey !== peerKey) {
            sendSyncBusy(peerKey, conn, msg, 'slot', activeSlot.generation);
            return;
        }
        if (session && session.sessionId !== msg.sessionId) {
            sendSyncBusy(peerKey, conn, msg, 'slot', session.slotGeneration);
            return;
        }
        const now = Date.now();
        if (!session && conn.negentropyRetryAfter > now) {
            sendSyncBusy(peerKey, conn, msg, 'retry', conn.negentropyRetryAfter);
            return;
        }
        if (conn.negentropyRetryAfter > 0 && conn.negentropyRetryAfter <= now) {
            conn.negentropyRetryAfter = 0;
            conn.negentropyBusyRetryAfter = 0;
        }
        const activeOrderedCatchupSessionId = schedulingState?.activeSessionId ?? null;
        const conflictDecision = decideInboundNegOpenConflict({
            activeSessionMode: session ? 'negentropy' : null,
            activeSessionId: session?.sessionId ?? null,
            activeOrderedCatchupSessionId,
            remoteSessionId,
        });
        const globalOrderedCatchupActive = schedulingState?.globalActive ?? false;
        const peerOrderedCatchupActive = schedulingState?.peerActive ?? false;

        if (conflictDecision.action === 'ignore' || globalOrderedCatchupActive || peerOrderedCatchupActive) {
            const remoteWindowId = msg.windowId;
            const rejectionSent = remoteSessionId.length > 0
                && remoteWindowId.length > 0
                && supportsPeerTransport(conn)
                && options.sendToPeer(peerKey, {
                    ...options.createBaseMessage('neg_close'),
                    sessionId: remoteSessionId,
                    windowId: remoteWindowId,
                    round: msg.round,
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
                    postImportActive: schedulingState?.transitionActive ?? false,
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
        if (!validateCurrentPayload(peerKey, msg)) {
            return;
        }
        if (session?.sessionId === msg.sessionId) {
            if (!isExpectedRound(peerKey, msg.round, session.rounds, 'neg_open')) {
                return;
            }
            if (session.initiator) {
                reportProtocolViolation(peerKey, 'neg_open conflicts with the local initiator role');
                return;
            }
            if (session.windowId === msg.windowId) {
                reportProtocolViolation(peerKey, 'neg_open reopens the active window');
                return;
            }
        }
        else if (!isExpectedRound(peerKey, msg.round, 0, 'neg_open')) {
            return;
        }

        const window = parseRemoteWindow(msg.window, options.maxRecordsPerWindow);
        if (!window) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_open with invalid window');
            return;
        }
        const advertisedWindowId = makeWindowId({
            name: msg.window.name,
            fromTs: msg.window.fromTs,
            toTs: msg.window.toTs,
            maxRecords: msg.window.maxRecords,
            order: msg.window.order,
            after: msg.window.after,
        });
        if (advertisedWindowId !== msg.windowId) {
            reportProtocolViolation(peerKey, 'neg_open windowId does not match its window');
            return;
        }
        if (session?.sessionId === msg.sessionId) {
            const previousRemoteCappedByRecords = session.remoteWindowCappedByRecords;
            const previousRemoteLastCursor = cloneCursor(session.remoteWindowLastCursor);
            trackRemoteWindowProgress(session, msg.previousWindowProgress);
            if (!isAuthorizedNextWindow(session, msg.windowId)) {
                session.remoteWindowCappedByRecords = previousRemoteCappedByRecords;
                session.remoteWindowLastCursor = previousRemoteLastCursor;
                reportProtocolViolation(peerKey, 'neg_open is not an authorized continuation');
                return;
            }
        }
        if (conflictDecision.action === 'replace' && session) {
            closePeerSession(peerKey, 'replaced_by_remote_open');
            session = undefined;
        }

        if (!session || session.sessionId !== msg.sessionId) {
            const generation = claimSessionSlot(peerKey, msg.sessionId);
            if (generation === null) {
                const slot = activeSlot;
                if (slot) {
                    sendSyncBusy(peerKey, conn, msg, 'slot', slot.generation);
                }
                return;
            }
            try {
                session = createPeerSession(peerKey, false, msg.sessionId);
            }
            catch (error) {
                releaseClaim(peerKey, msg.sessionId, generation);
                throw error;
            }
        }

        session.initiator = false;
        session.maxRounds = options.maxRoundsPerSession;
        session.windows = [window];
        session.windowIndex = 0;
        try {
            const snapshot = await ensureWindowAdapterFresh(
                window,
                'session_open_responder',
                'canonical_responder',
            );
            if (peerSessions.get(peerKey) !== session) {
                return;
            }
            initializeSessionWindowState(
                session,
                window,
                msg.windowId,
                cloneWindowStats(snapshot.stats)!,
                msg.window,
            );
            session.currentWindowSnapshot = snapshot;
            session.currentWindowEngine = negentropyAdapter.createEngineForSnapshot(snapshot);
            touchPeerSession(peerKey);
            await handleNegentropyRoundAsResponder(peerKey, session, decodeNegentropyFrame(msg.frame));
        }
        catch (error) {
            if (peerSessions.get(peerKey) === session) {
                closePeerSession(peerKey, 'neg_open_failed');
            }
            throw error;
        }
    }

    async function handleNegMsgMessage(peerKey: string, msg: NegMsgMessage): Promise<void> {
        const session = peerSessions.get(peerKey);
        if (!session || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_msg for unknown session');
            return;
        }
        const expectedRound = session.initiator ? session.rounds + 1 : session.rounds;
        if (!isExpectedRound(peerKey, msg.round, expectedRound, 'neg_msg')) {
            return;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'neg_msg')) {
            return;
        }
        if (!validateCurrentPayload(peerKey, msg)) {
            return;
        }
        if (session.activeOffer || session.localRequest || session.receivedRequest) {
            reportProtocolViolation(peerKey, 'neg_msg arrived before the current transfer round drained');
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

    function getCurrentTransferSession(
        peerKey: string,
        msg: OpsOfferMessage | OpsReqMessage | OpsPushMessage | OpsAckMessage,
    ): PeerSyncSession | null {
        const session = peerSessions.get(peerKey);
        if (!session || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, `ignoring ${msg.type} for unknown session`);
            return null;
        }
        if (msg.round < session.rounds) {
            return null;
        }
        if (msg.round > session.rounds) {
            reportProtocolViolation(peerKey, `${msg.type} is for a future round`);
            return null;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, msg.type)) {
            return null;
        }
        return session;
    }

    async function findKnownIds(peerKey: string, session: PeerSyncSession, ids: string[]): Promise<Set<string> | null> {
        return options.bulkReads.run(peerKey, async () => {
            const known = new Set<string>();
            for (const batch of chunkIds(ids, options.maxIdsPerLookup)) {
                for (const row of await options.syncStore.getByIds(batch)) {
                    known.add(row.id);
                }
                if (peerSessions.get(peerKey) !== session) {
                    return null;
                }
            }
            return known;
        });
    }

    async function handleOpsOfferMessage(peerKey: string, msg: OpsOfferMessage): Promise<void> {
        const session = getCurrentTransferSession(peerKey, msg);
        if (!session || !validateCurrentPayload(peerKey, msg)) {
            return;
        }
        if (session.initiator || session.localRequest || msg.offerId !== session.nextRemoteOfferId
            || msg.ids.length !== new Set(msg.ids.map(id => id.toLowerCase())).size) {
            reportProtocolViolation(peerKey, 'invalid or overlapping ops_offer');
            return;
        }
        const maxRecords = getSessionWindow(session)?.maxRecords ?? options.maxRecordsPerWindow;
        const ids = msg.ids.map(id => id.toLowerCase());
        if (ids.some(id => session.seenOfferedIds.has(id))
            || session.seenOfferedIds.size + ids.length > maxRecords) {
            reportProtocolViolation(peerKey, 'ops_offer repeats IDs or exceeds the active window');
            return;
        }
        session.nextRemoteOfferId += 1;
        ids.forEach(id => session.seenOfferedIds.add(id));
        let known: Set<string> | null;
        try {
            known = await findKnownIds(peerKey, session, ids);
        }
        catch (error) {
            log.warn({ error, peer: shortName(peerKey) }, 'failed to check offered operation IDs');
            if (peerSessions.get(peerKey) === session) {
                sendNegClose(peerKey, session, 'ops_offer_lookup_failed');
                closePeerSession(peerKey, 'ops_offer_lookup_failed');
            }
            return;
        }
        if (!known) {
            return;
        }
        const missing = ids.filter(id => !known.has(id));
        const filtered = options.importPipeline.filterRetryDelayedIds(missing);
        const deferred = filtered.pendingIds.length > 0 || filtered.capacityDeferredIds.length > 0;
        if (deferred) {
            session.windowIncomplete = true;
        }
        if (!sendOpsRequest(peerKey, session, filtered.eligibleIds, { offerId: msg.offerId, deferred })) {
            return;
        }
        touchPeerSession(peerKey);
    }

    async function handleOpsReqMessage(peerKey: string, msg: OpsReqMessage): Promise<void> {
        const session = getCurrentTransferSession(peerKey, msg);
        if (!session || !validateCurrentPayload(peerKey, msg)) {
            return;
        }
        if (msg.requestId !== session.nextRemoteRequestId
            || msg.ids.length !== new Set(msg.ids.map(id => id.toLowerCase())).size
            || session.receivedRequest) {
            reportProtocolViolation(peerKey, 'invalid or overlapping ops_req');
            return;
        }
        const ids = msg.ids.map(id => id.toLowerCase());
        if (msg.offerId !== undefined) {
            const offer = session.activeOffer;
            if (!session.initiator || !offer || offer.offerId !== msg.offerId || offer.round !== msg.round
                || ids.some(id => !offer.ids.has(id))
                || (msg.deferred === true && ids.length === offer.ids.size)) {
                reportProtocolViolation(peerKey, 'ops_req does not match the active offer');
                return;
            }
            if (msg.deferred) {
                session.windowIncomplete = true;
            }
            session.activeOffer = null;
        } else {
            const maxRecords = getSessionWindow(session)?.maxRecords ?? options.maxRecordsPerWindow;
            if (session.initiator || ids.length === 0 || ids.some(id => session.seenDirectRequestIds.has(id))
                || session.seenDirectRequestIds.size + ids.length > maxRecords) {
                reportProtocolViolation(peerKey, 'unauthorized or repeated direct ops_req');
                return;
            }
            ids.forEach(id => session.seenDirectRequestIds.add(id));
        }
        session.nextRemoteRequestId += 1;
        options.syncStats.negentropyOpsReqReceived += ids.length;
        if (ids.length === 0) {
            await driveInitiatorTransfers(peerKey, session);
            return;
        }
        session.receivedRequest = {
            requestId: msg.requestId,
            round: msg.round,
            remainingIds: ids,
            page: 0,
            awaitingAck: false,
        };
        try {
            await sendNextOpsPage(peerKey, session);
        }
        catch (error) {
            log.warn({ error, peer: shortName(peerKey) }, 'failed to build requested operation page');
            if (peerSessions.get(peerKey) === session) {
                sendNegClose(peerKey, session, 'ops_push_lookup_failed');
                closePeerSession(peerKey, 'ops_push_lookup_failed');
            }
        }
    }

    async function handleOpsPushMessage(peerKey: string, msg: OpsPushMessage): Promise<void> {
        const session = getCurrentTransferSession(peerKey, msg);
        if (!session) {
            return;
        }
        const request = session.localRequest;
        if (!request || request.requestId !== msg.requestId || request.round !== msg.round
            || request.nextPage !== msg.page) {
            reportProtocolViolation(peerKey, 'ops_push does not match the active request');
            return;
        }
        if (!validateCurrentPayload(peerKey, msg)) {
            return;
        }
        const content = validateOperationContentIds(msg.data, options.cipher);
        if (!content.ok) {
            reportProtocolViolation(peerKey, `invalid_ops_push: ${content.reason}`);
            return;
        }
        const batch = normalizeInboundOpsPushBatch(msg.data);
        if (batch.length !== msg.data.length) {
            reportProtocolViolation(peerKey, 'ops_push contains duplicate operations');
            return;
        }
        const page = validateOperationPage(msg.data, {
            maxOpsPerPush: options.maxOpsPerPush,
            maxBytesPerPush: options.maxBytesPerPush,
        });
        if (!page.ok) {
            reportProtocolViolation(peerKey, `invalid_ops_push: ${page.reason}`);
            return;
        }
        const reservation = options.operationPages.reserve(page.value.bytes);
        if (!reservation) {
            sendNegClose(peerKey, session, 'ops_push_import_capacity');
            closePeerSession(peerKey, 'ops_push_import_capacity');
            return;
        }
        try {
            const pageIds: string[] = [];
            for (const operation of batch) {
                const mapped = mapOperationToSyncKey(operation);
                if (!mapped.ok || !request.expectedIds.has(mapped.value.idHex)
                || request.deliveredIds.has(mapped.value.idHex)) {
                    reportProtocolViolation(peerKey, 'ops_push contains an unsolicited or duplicate operation');
                    return;
                }
                pageIds.push(mapped.value.idHex);
            }
            const delivered = new Set([...request.deliveredIds, ...pageIds]);
            if (msg.hasMore && delivered.size === request.expectedIds.size) {
                reportProtocolViolation(peerKey, 'a non-final ops_push delivered every requested operation');
                return;
            }
            if (!msg.hasMore) {
                if (delivered.size !== request.expectedIds.size) {
                    if (!sendNegClose(peerKey, session, 'missing_requested_operations')) {
                        closePeerSession(peerKey, 'send_neg_close_failed');
                        return;
                    }
                    closePeerSession(peerKey, 'missing_requested_operations');
                    return;
                }
            }

            let imported = {
                knownIds: [] as string[],
                persistedIds: [] as string[],
                pendingIds: [] as string[],
                capacityDeferredIds: [] as string[],
                retryable: false,
            };
            if (batch.length > 0) {
                options.syncStats.negentropyOpsPushReceived += batch.length;
                trackReceivedWindowOperations(session, batch);
                const unprovenBatch = filterUnprovenPushOperations(session, batch);
                if (unprovenBatch.length > 0) {
                    imported = await options.importPipeline.enqueue({
                        kind: 'remote',
                        name: peerKey,
                        data: unprovenBatch,
                        cancelled: () => peerSessions.get(peerKey) !== session,
                    });
                } else {
                    imported.knownIds = pageIds;
                }
            }
            if (peerSessions.get(peerKey) !== session) {
                return;
            }
            if (imported.retryable) {
                sendNegClose(peerKey, session, 'ops_push_import_retryable');
                closePeerSession(peerKey, 'ops_push_import_retryable');
                return;
            }

            const settledIds = new Set([
                ...imported.knownIds,
                ...imported.persistedIds,
                ...imported.capacityDeferredIds,
            ]);
            for (const [index, id] of pageIds.entries()) {
                request.deliveredIds.add(id);
                if (!settledIds.has(id) && !session.provenStoredPushIds.has(id)
                && !retainUnresolvedOperation(session, id, batch[index])) {
                    if (!sendNegClose(peerKey, session, 'unresolved_limit_exceeded')) {
                        closePeerSession(peerKey, 'send_neg_close_failed');
                        return;
                    }
                    closePeerSession(peerKey, 'unresolved_limit_exceeded');
                    return;
                }
            }
            for (const id of imported.knownIds) {
                session.receivedKnownPushIds.add(id);
            }
            for (const id of [...imported.knownIds, ...imported.persistedIds]) {
                request.satisfiedIds.add(id);
                session.provenStoredPushIds.add(id);
                session.pendingNeedIds.delete(id);
                clearUnresolvedOperation(session, id);
            }
            for (const id of imported.capacityDeferredIds) {
                session.windowIncomplete = true;
                session.pendingNeedIds.delete(id);
                clearUnresolvedOperation(session, id);
            }

            const ack: OpsAckMessage = {
                ...options.createBaseMessage('ops_ack'),
                sessionId: session.sessionId,
                windowId: getExpectedWindowId(session),
                round: msg.round,
                requestId: msg.requestId,
                page: msg.page,
                ...(imported.capacityDeferredIds.length > 0 ? { deferred: true } : {}),
            };
            if (!options.sendToPeer(peerKey, ack)) {
                closePeerSession(peerKey, 'send_ops_ack_failed');
                return;
            }
            request.nextPage += 1;
            touchPeerSession(peerKey);
            if (!msg.hasMore) {
                session.localRequest = null;
                await driveInitiatorTransfers(peerKey, session);
            }
        }
        finally {
            reservation.release();
        }
    }

    async function handleOpsAckMessage(peerKey: string, msg: OpsAckMessage): Promise<void> {
        const session = getCurrentTransferSession(peerKey, msg);
        if (!session || !validateCurrentPayload(peerKey, msg)) {
            return;
        }
        const request = session.receivedRequest;
        if (!request || !request.awaitingAck || request.requestId !== msg.requestId
            || request.round !== msg.round || request.page !== msg.page) {
            reportProtocolViolation(peerKey, 'ops_ack does not match the outstanding page');
            return;
        }
        request.awaitingAck = false;
        if (msg.deferred) {
            session.windowIncomplete = true;
        }
        request.page += 1;
        if (request.remainingIds.length > 0) {
            try {
                await sendNextOpsPage(peerKey, session);
            }
            catch (error) {
                log.warn({ error, peer: shortName(peerKey) }, 'failed to build requested operation page');
                if (peerSessions.get(peerKey) === session) {
                    sendNegClose(peerKey, session, 'ops_push_lookup_failed');
                    closePeerSession(peerKey, 'ops_push_lookup_failed');
                }
            }
            return;
        }
        session.receivedRequest = null;
        touchPeerSession(peerKey);
        await driveInitiatorTransfers(peerKey, session);
    }

    async function handleNegCloseMessage(peerKey: string, msg: NegCloseMessage): Promise<void> {
        const session = peerSessions.get(peerKey);
        if (!session || session.sessionId !== msg.sessionId) {
            return;
        }
        if (!isExpectedRound(peerKey, msg.round, session.rounds, 'neg_close')
            || !isCurrentSessionWindow(peerKey, session, msg.windowId, 'neg_close')
            || !validateCurrentPayload(peerKey, msg)) {
            return;
        }
        trackRemoteWindowProgress(session, msg.windowProgress);
        if (msg.reason === 'complete' && session.windowIncomplete) {
            if (!sendNegClose(peerKey, session, 'incomplete')) {
                closePeerSession(peerKey, 'send_neg_close_failed');
                return;
            }
            closePeerSession(peerKey, 'incomplete');
            return;
        }
        if (msg.reason === 'complete' && ((session.initiator && !session.reconciliationComplete)
            || session.activeOffer
            || session.localRequest
            || session.receivedRequest)) {
            reportProtocolViolation(peerKey, 'premature negentropy completion');
            return;
        }
        if (session.initiator && msg.reason === 'max_rounds_reached'
            && (session.activeOffer || session.localRequest || session.receivedRequest)) {
            reportProtocolViolation(peerKey, 'premature negentropy round-cap close');
            return;
        }
        if (session.initiator && msg.reason === 'max_rounds_reached') {
            if (session.windowIncomplete) {
                if (!sendNegClose(peerKey, session, 'incomplete')) {
                    closePeerSession(peerKey, 'send_neg_close_failed');
                    return;
                }
                closePeerSession(peerKey, 'incomplete');
                return;
            }
            finalizeCurrentWindowStats(session, { completed: false, cappedByRounds: true });
            const split = await maybeSplitWindowOnRoundCap(peerKey, session, 'remote_max_rounds_reached');
            if (split) {
                return;
            }
        }
        if (msg.reason === 'complete') {
            if (!session.initiator && !session.reconciliationComplete) {
                session.reconciliationComplete = true;
                finalizeCurrentWindowStats(session, { completed: true, cappedByRounds: false });
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
                    'rejecting remote negentropy completion with unresolved operations'
                );
                options.terminatePeerConnection(peerKey, 'unresolved_operations');
                return;
            }
        }
        closePeerSession(peerKey, msg.reason || 'remote_closed');
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
        if (!conn) {
            return false;
        }
        if (conn.negentropySynced || peerSessions.has(peerKey) || peerSessions.size > 0 || activeSlot) {
            return false;
        }

        const session = createPeerSession(peerKey, settings.initiator);
        try {
            const peerLatestSignedTimestamp = conn.capabilities.latestSignedTimestamp;
            const initialWindow = await buildInitialHistoryWindowForSession(peerLatestSignedTimestamp);
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
                    peerLatestSignedTimestamp,
                    sessionToTs: initialWindow.toTs,
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

    async function dispatchMessage(
        peerKey: string,
        message: NegentropyMessage,
        schedulingState?: NegOpenSchedulingState,
    ): Promise<void> {
        if (shutdownStarted) {
            return;
        }
        if (message.type === 'neg_open') {
            const conn = options.getConnection(peerKey);
            if (conn) {
                await handleNegOpenMessage(peerKey, conn, message, schedulingState);
            }
            return;
        }
        if (message.type === 'neg_msg') {
            await handleNegMsgMessage(peerKey, message);
            return;
        }
        if (message.type === 'ops_offer') {
            await handleOpsOfferMessage(peerKey, message);
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
        if (message.type === 'ops_ack') {
            await handleOpsAckMessage(peerKey, message);
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
        adapterWindowSnapshots.clear();
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
            reset();
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
        for (const peerKey of peerSessions.keys()) {
            options.bulkReads.cancel(peerKey);
        }
        peerSessions.clear();
        activeSlot = null;
        invalidateNegentropyAdapterCache();
    }

    async function shutdown(): Promise<void> {
        if (shutdownPromise) {
            return shutdownPromise;
        }
        shutdownStarted = true;
        backgroundPrebuildQueued = false;
        for (const peerKey of peerSessions.keys()) {
            options.bulkReads.cancel(peerKey);
        }
        peerSessions.clear();
        activeSlot = null;
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
            invalidateNegentropyAdapterCache();
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
        handleMessage(
            peerKey: string,
            message: NegentropyMessage,
            schedulingState?: NegOpenSchedulingState,
        ): Promise<void> {
            return trackWork(dispatchMessage(peerKey, message, schedulingState));
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
        getExpectedInboundRound(peerKey: string, type: string): number {
            const session = peerSessions.get(peerKey);
            if (!session) {
                return 0;
            }
            return type === 'neg_msg' && session.initiator
                ? session.rounds + 1
                : session.rounds;
        },
        beginStoreMutation,
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
            options.bulkReads.cancel(peerKey);
            closePeerSession(peerKey, reason);
        },
        reset,
        shutdown,
    };
}
