import Hyperswarm, { HyperswarmConnection } from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import asyncLib from 'async';
import { EventEmitter } from 'events';

import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import KuboClient from '@mdip/ipfs/kubo';
import { Operation } from '@mdip/gatekeeper/types';
import CipherNode from '@mdip/cipher/node';
import { childLogger } from '@mdip/common/logger';
import config from './config.js';
import type { OperationSyncStore } from './db/types.js';
import SqliteOperationSyncStore from './db/sqlite.js';
import NegentropyAdapter, {
    type NegentropyWindowStats,
    type ReconciliationWindow,
} from './negentropy/adapter.js';
import {
    NEG_SYNC_ID_RE,
    chooseConnectSyncMode,
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    extractOperationHashes,
    normalizeNegentropyIds,
    normalizePeerCapabilities,
    type ConnectSyncModeReason,
    type NegentropyFrame,
    type NegotiatedPeerCapabilities,
    type PeerCapabilities,
    type SyncMode,
} from './negentropy/protocol.js';
import {
    shouldAcceptLegacySync,
    shouldSchedulePeriodicRepair,
    shouldStartConnectTimeNegentropy,
} from './negentropy/policy.js';
import {
    addAggregateSample,
    averageAggregate,
    collectQueueDelaySamples,
    createAggregateMetric,
    messageBytes,
    safeRate,
    type AggregateMetric,
} from './negentropy/observability.js';
import {
    chunkIds,
    chunkOperationsForPush,
} from './negentropy/transfer.js';
import { bootstrapSyncStoreIfEmpty } from './bootstrap.js';
import {
    filterOperationsByAcceptedHashes,
    filterIndexRejectedOperations,
    mapAcceptedOperationsToSyncRecords,
} from './sync-persistence.js';
import { exit } from 'process';
import path from 'path';
import { pathToFileURL } from 'url';

const log = childLogger({ service: 'hyperswarm-mediator' });

interface HyperMessageBase {
    type: string;
    time: string;
    node: string;
    relays: string[];
}

interface PingMessage extends HyperMessageBase {
    type: 'ping';
    peers: string[];
    capabilities?: PeerCapabilities;
}

interface BatchMessage extends HyperMessageBase {
    type: 'batch' | 'queue';
    data: Operation[];
}

interface SyncMessage extends HyperMessageBase {
    type: 'sync';
}

interface NegOpenMessage extends HyperMessageBase {
    type: 'neg_open';
    sessionId: string;
    windowId: string;
    window: {
        name: string;
        fromTs: number;
        toTs: number;
        maxRecords: number;
        order: number;
    };
    fullRepair: boolean;
    round: number;
    frame: NegentropyFrame;
}

interface NegMsgMessage extends HyperMessageBase {
    type: 'neg_msg';
    sessionId: string;
    windowId: string;
    round: number;
    frame: NegentropyFrame;
}

interface NegCloseMessage extends HyperMessageBase {
    type: 'neg_close';
    sessionId: string;
    windowId: string;
    round: number;
    reason?: string;
}

interface OpsReqMessage extends HyperMessageBase {
    type: 'ops_req';
    sessionId: string;
    windowId: string;
    round: number;
    ids: string[];
}

interface OpsPushMessage extends HyperMessageBase {
    type: 'ops_push';
    sessionId: string;
    windowId: string;
    round: number;
    data: Operation[];
}

type HyperMessage =
    | BatchMessage
    | SyncMessage
    | PingMessage
    | NegOpenMessage
    | NegMsgMessage
    | NegCloseMessage
    | OpsReqMessage
    | OpsPushMessage;

interface ImportQueueTask {
    name: string;
    msg: BatchMessage;
}

interface ExportQueueTask {
    name: string;
    msg: SyncMessage;
    conn: HyperswarmConnection;
}

interface NodeInfo {
    name: string;
    ipfs: any;
}

interface ConnectionInfo {
    connection: HyperswarmConnection;
    key: string;
    peerName: string;
    nodeName: string;
    did: string;
    lastSeen: number;
    capabilities: NegotiatedPeerCapabilities;
    syncMode: SyncMode | 'unknown';
    syncStarted: boolean;
    lastNegentropyRepairAt: number;
}

interface PeerSyncSession {
    sessionId: string;
    peerKey: string;
    mode: SyncMode;
    initiator: boolean;
    fullRepair: boolean;
    windows: ReconciliationWindow[];
    windowIndex: number;
    windowId: string | null;
    currentWindowStats: NegentropyWindowStats | null;
    completedWindows: NegentropyWindowStats[];
    startedAt: number;
    lastActivity: number;
    pendingHaveIds: string[];
    pendingNeedIds: string[];
    rounds: number;
    maxRounds: number;
    reconciliationComplete: boolean;
    localClosed: boolean;
}

interface MediatorSyncStats {
    modeSelectionsTotal: number;
    modeSelectionsLegacy: number;
    modeSelectionsNegentropy: number;
    modeSelectionsLegacyMissingCapabilities: number;
    modeSelectionsLegacyNegentropyDisabled: number;
    modeSelectionsLegacyVersionMismatch: number;
    modeSelectionsNoModeLegacyDisabled: number;
    queueOpsRelayed: number;
    queueOpsImported: number;
    queueDelayMs: AggregateMetric;
    negentropySessionsStarted: number;
    negentropySessionsClosed: number;
    negentropySessionsCompleted: number;
    negentropySessionsFailed: number;
    negentropyRounds: number;
    negentropyHaveIds: number;
    negentropyNeedIds: number;
    negentropyOpsReqSent: number;
    negentropyOpsReqReceived: number;
    negentropyOpsPushSent: number;
    negentropyOpsPushReceived: number;
    opsApplied: number;
    opsRejected: number;
    bytesSent: number;
    bytesReceived: number;
    syncDurationMs: AggregateMetric;
}

export interface MediatorMainOptions {
    syncStore?: OperationSyncStore;
    startLoops?: boolean;
}

const gatekeeper = new GatekeeperClient();
const keymaster = new KeymasterClient();
const ipfs = new KuboClient();
const cipher = new CipherNode();
let syncStore: OperationSyncStore = new SqliteOperationSyncStore();
let negentropyAdapter: NegentropyAdapter | null = null;
let adapterChangeSeq = 0;
let adapterBuiltSeq = -1;
let adapterBuiltAt = 0;
let adapterBuiltWindowId: string | null = null;
let adapterBuiltWindowStats: NegentropyWindowStats | null = null;
let rebuildPromise: Promise<void> | null = null;
let backgroundPrebuildQueued = false;

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const BATCH_SIZE = 100;
const NEGENTROPY_VERSION = 1;
const NEG_SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const NEG_MAX_IDS_PER_OPS_REQ = 1_000;
const NEG_MAX_IDS_PER_LOOKUP = 1_000;
const NEG_MAX_OPS_PER_PUSH = 256;
const NEG_MAX_BYTES_PER_PUSH = 512 * 1024;
const NEG_REPAIR_INTERVAL_MS = config.negentropyRepairIntervalSeconds * 1000;
const NEG_ADAPTER_MAX_AGE_MS = 60 * 1000;

const connectionInfo: Record<string, ConnectionInfo> = {};
const knownNodes: Record<string, NodeInfo> = {};
const knownPeers: Record<string, string> = {};
const addedPeers: Record<string, number> = {};
const badPeers: Record<string, number> = {};
const peerSessions = new Map<string, PeerSyncSession>();
const syncStats: MediatorSyncStats = {
    modeSelectionsTotal: 0,
    modeSelectionsLegacy: 0,
    modeSelectionsNegentropy: 0,
    modeSelectionsLegacyMissingCapabilities: 0,
    modeSelectionsLegacyNegentropyDisabled: 0,
    modeSelectionsLegacyVersionMismatch: 0,
    modeSelectionsNoModeLegacyDisabled: 0,
    queueOpsRelayed: 0,
    queueOpsImported: 0,
    queueDelayMs: createAggregateMetric(),
    negentropySessionsStarted: 0,
    negentropySessionsClosed: 0,
    negentropySessionsCompleted: 0,
    negentropySessionsFailed: 0,
    negentropyRounds: 0,
    negentropyHaveIds: 0,
    negentropyNeedIds: 0,
    negentropyOpsReqSent: 0,
    negentropyOpsReqReceived: 0,
    negentropyOpsPushSent: 0,
    negentropyOpsPushReceived: 0,
    opsApplied: 0,
    opsRejected: 0,
    bytesSent: 0,
    bytesReceived: 0,
    syncDurationMs: createAggregateMetric(),
};

let swarm: Hyperswarm | null = null;
let nodeKey = '';
let nodeInfo: NodeInfo;

goodbye(() => {
    if (swarm) {
        swarm.destroy();
    }

    void syncStore.stop().catch(error => {
        log.error({ error }, 'syncStore stop error');
    });
});

async function createSwarm(): Promise<void> {
    if (swarm) {
        swarm.destroy();
    }

    swarm = new Hyperswarm();
    nodeKey = b4a.toString(swarm.keyPair.publicKey, 'hex');

    swarm.on('connection', conn => addConnection(conn));

    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();

    const shortTopic = shortName(b4a.toString(topic, 'hex'));
    log.info(`new hyperswarm peer id: ${shortName(nodeKey)} (${config.nodeName}) joined topic: ${shortTopic} using protocol: ${config.protocol}`);
}

let syncQueue = asyncLib.queue<HyperswarmConnection, asyncLib.ErrorCallback>(
    async function (conn, callback) {
        try {
            // Wait until the importQueue is empty
            while (importQueue.length() > 0) {
                log.debug(`* sync waiting 10s for importQueue to empty. Current length: ${importQueue.length()}`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            const msg: HyperMessage = {
                type: 'sync',
                time: new Date().toISOString(),
                node: nodeInfo.name,
                relays: [],
            };

            const json = JSON.stringify(msg);
            syncStats.bytesSent += messageBytes(json);
            conn.write(json);
        }
        catch (error) {
            log.error({ error }, 'sync error');
        }
        callback();
    }, 1); // concurrency is 1

function addConnection(conn: HyperswarmConnection): void {
    const peerKey = b4a.toString(conn.remotePublicKey, 'hex');
    const peerName = shortName(peerKey);

    conn.once('close', () => closeConnection(peerKey));
    conn.on('data', data => receiveMsg(peerKey, data));

    log.info(`received connection from: ${peerName}`);

    connectionInfo[peerKey] = {
        connection: conn,
        key: peerKey,
        peerName: peerName,
        nodeName: 'anon',
        did: '',
        lastSeen: new Date().getTime(),
        capabilities: {
            advertised: false,
            negentropy: false,
            version: null,
        },
        syncMode: 'unknown',
        syncStarted: false,
        lastNegentropyRepairAt: 0,
    };

    const peerNames = Object.values(connectionInfo).map(info => info.peerName);
    log.debug(`--- ${peerNames.length} nodes connected, detected nodes: ${peerNames.join(', ')}`);

    void sendPingToPeer(peerKey);
}

function closeConnection(peerKey: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }
    log.info(`* connection closed with: ${conn.peerName} (${conn.nodeName}) *`);

    delete connectionInfo[peerKey];
    closePeerSession(peerKey, 'connection_closed');
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

function createBaseMessage<T extends HyperMessage['type']>(type: T): Omit<HyperMessageBase, 'type'> & { type: T } {
    return {
        type,
        time: new Date().toISOString(),
        node: nodeInfo?.name || config.nodeName,
        relays: [],
    };
}

function buildPingMessage(): PingMessage {
    return {
        ...createBaseMessage('ping'),
        peers: Object.keys(knownNodes),
        capabilities: {
            negentropy: true,
            negentropyVersion: NEGENTROPY_VERSION,
        },
    };
}

function sendToPeer(peerKey: string, msg: HyperMessage): boolean {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return false;
    }

    const json = JSON.stringify(msg);
    syncStats.bytesSent += messageBytes(json);
    conn.connection.write(json);
    return true;
}

async function sendPingToPeer(peerKey: string): Promise<void> {
    const ping = buildPingMessage();
    if (sendToPeer(peerKey, ping)) {
        log.debug(`* sent ping to: ${shortName(peerKey)}`);
    }
}

function createSessionId(peerKey: string): string {
    const nonce = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
    return `${Date.now().toString(36)}-${shortName(nodeKey)}-${shortName(peerKey)}-${nonce}`;
}

function createPeerSession(peerKey: string, mode: SyncMode, initiator: boolean, sessionId?: string): PeerSyncSession {
    const now = Date.now();
    const session: PeerSyncSession = {
        sessionId: sessionId ?? createSessionId(peerKey),
        peerKey,
        mode,
        initiator,
        fullRepair: false,
        windows: [],
        windowIndex: 0,
        windowId: null,
        currentWindowStats: null,
        completedWindows: [],
        startedAt: now,
        lastActivity: now,
        pendingHaveIds: [],
        pendingNeedIds: [],
        rounds: 0,
        maxRounds: config.negentropyMaxRoundsPerSession,
        reconciliationComplete: false,
        localClosed: false,
    };
    peerSessions.set(peerKey, session);
    connectionInfo[peerKey].syncMode = mode;
    connectionInfo[peerKey].syncStarted = true;
    if (mode === 'negentropy') {
        syncStats.negentropySessionsStarted += 1;
        connectionInfo[peerKey].lastNegentropyRepairAt = now;
    }
    return session;
}

function touchPeerSession(peerKey: string): void {
    const session = peerSessions.get(peerKey);
    if (!session) {
        return;
    }
    session.lastActivity = Date.now();
}

function closePeerSession(peerKey: string, reason: string): void {
    const session = peerSessions.get(peerKey);
    if (!session) {
        return;
    }

    peerSessions.delete(peerKey);
    addAggregateSample(syncStats.syncDurationMs, Date.now() - session.startedAt);
    const conn = connectionInfo[peerKey];
    if (conn && session.mode === 'negentropy') {
        conn.lastNegentropyRepairAt = Date.now();
        syncStats.negentropySessionsClosed += 1;
        if (reason === 'complete' || reason === 'remote_closed') {
            syncStats.negentropySessionsCompleted += 1;
        } else {
            syncStats.negentropySessionsFailed += 1;
        }
    }

    maybeStartBackgroundPrebuild('session_closed');

    log.debug({
        peer: shortName(peerKey),
        mode: session.mode,
        rounds: session.rounds,
        pendingHave: session.pendingHaveIds.length,
        pendingNeed: session.pendingNeedIds.length,
        reason,
    }, 'peer sync session closed');
}

function expireIdlePeerSessions(): void {
    const now = Date.now();
    for (const [peerKey, session] of peerSessions.entries()) {
        if (now - session.lastActivity > NEG_SESSION_IDLE_TIMEOUT_MS) {
            sendNegClose(peerKey, session, 'idle_timeout');
            closePeerSession(peerKey, 'idle_timeout');
        }
    }
}

function choosePeerSyncMode(peerKey: string): { mode: SyncMode | null; reason: ConnectSyncModeReason } | null {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return null;
    }

    return chooseConnectSyncMode(
        conn.capabilities,
        NEGENTROPY_VERSION,
        config.legacySyncEnabled,
    );
}

function getActiveNegentropySessions(): number {
    let count = 0;
    for (const session of peerSessions.values()) {
        if (session.mode === 'negentropy') {
            count += 1;
        }
    }
    return count;
}

async function maybeStartPeerSync(peerKey: string, source: 'connect' | 'periodic' = 'connect'): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    if (source === 'connect' && conn.syncStarted) {
        return;
    }

    let mode: SyncMode | 'unknown' | null;
    let modeReason: ConnectSyncModeReason | null = null;

    if (source === 'connect') {
        const decision = choosePeerSyncMode(peerKey);
        if (!decision) {
            return;
        }
        mode = decision.mode;
        modeReason = decision.reason;
    } else {
        mode = conn.syncMode;
    }

    if (!mode || mode === 'unknown') {
        if (source === 'connect' && modeReason === 'legacy_disabled') {
            syncStats.modeSelectionsNoModeLegacyDisabled += 1;
        }
        return;
    }

    if (source === 'connect' && mode === 'negentropy' && importQueue.length() > 0) {
        setTimeout(() => void maybeStartPeerSync(peerKey, source), 1_000);
        return;
    }

    if (source === 'connect') {
        syncStats.modeSelectionsTotal += 1;
        if (mode === 'legacy') {
            syncStats.modeSelectionsLegacy += 1;
            if (modeReason === 'missing_capabilities') {
                syncStats.modeSelectionsLegacyMissingCapabilities += 1;
            }
            if (modeReason === 'negentropy_disabled') {
                syncStats.modeSelectionsLegacyNegentropyDisabled += 1;
            }
            if (modeReason === 'version_mismatch') {
                syncStats.modeSelectionsLegacyVersionMismatch += 1;
            }
        } else {
            syncStats.modeSelectionsNegentropy += 1;
        }
    }

    if (mode === 'legacy') {
        if (!config.legacySyncEnabled) {
            return;
        }

        if (source !== 'connect') {
            return;
        }

        createPeerSession(peerKey, 'legacy', true, `legacy-${Date.now().toString(36)}`);
        syncQueue.push(conn.connection);
        log.info({ peer: shortName(peerKey), mode, modeReason }, 'peer sync mode selected');
        return;
    }

    const initiator = nodeKey.localeCompare(peerKey) < 0;
    const hasActiveSession = peerSessions.has(peerKey);
    const activeNegentropySessions = getActiveNegentropySessions();

    const shouldStart = source === 'connect'
        ? shouldStartConnectTimeNegentropy(mode, hasActiveSession, initiator)
        : shouldSchedulePeriodicRepair({
            syncMode: mode,
            hasActiveSession,
            importQueueLength: importQueue.length(),
            activeNegentropySessions,
            lastRepairAtMs: conn.lastNegentropyRepairAt,
            nowMs: Date.now(),
            repairIntervalMs: NEG_REPAIR_INTERVAL_MS,
            isInitiator: initiator,
        });

    conn.syncMode = 'negentropy';
    conn.syncStarted = true;

    if (!shouldStart) {
        return;
    }

    if (activeNegentropySessions > 0) {
        return;
    }

    const session = createPeerSession(peerKey, 'negentropy', initiator);
    session.fullRepair = source === 'periodic';
    session.windows = await planRuntimeWindows();
    session.windowIndex = 0;
    session.completedWindows = [];
    log.info(
        {
            peer: shortName(peerKey),
            mode,
            modeReason,
            initiator,
            sessionId: session.sessionId,
            source,
            fullRepair: session.fullRepair,
            plannedWindows: session.windows.length,
        },
        'peer sync mode selected'
    );
    await startNextNegentropyWindow(peerKey, session);
}

async function runPeriodicNegentropyRepair(): Promise<void> {
    for (const peerKey in connectionInfo) {
        try {
            await maybeStartPeerSync(peerKey, 'periodic');
        } catch (error) {
            log.error({ error, peer: shortName(peerKey) }, 'periodic negentropy repair error');
        }
    }
}

function buildSyncStatsSnapshot(): object {
    return {
        modeSelections: {
            total: syncStats.modeSelectionsTotal,
            legacy: syncStats.modeSelectionsLegacy,
            negentropy: syncStats.modeSelectionsNegentropy,
            fallbackCount: syncStats.modeSelectionsLegacy,
            fallbackRate: safeRate(syncStats.modeSelectionsLegacy, syncStats.modeSelectionsTotal),
            legacyReasons: {
                missingCapabilities: syncStats.modeSelectionsLegacyMissingCapabilities,
                negentropyDisabled: syncStats.modeSelectionsLegacyNegentropyDisabled,
                versionMismatch: syncStats.modeSelectionsLegacyVersionMismatch,
            },
            noMode: {
                legacyDisabled: syncStats.modeSelectionsNoModeLegacyDisabled,
            },
        },
        queue: {
            relayed: syncStats.queueOpsRelayed,
            imported: syncStats.queueOpsImported,
            delayMs: {
                avg: averageAggregate(syncStats.queueDelayMs),
                max: syncStats.queueDelayMs.max,
                samples: syncStats.queueDelayMs.count,
            },
        },
        negentropy: {
            sessionsStarted: syncStats.negentropySessionsStarted,
            sessionsClosed: syncStats.negentropySessionsClosed,
            sessionsCompleted: syncStats.negentropySessionsCompleted,
            sessionsFailed: syncStats.negentropySessionsFailed,
            rounds: syncStats.negentropyRounds,
            haveIds: syncStats.negentropyHaveIds,
            needIds: syncStats.negentropyNeedIds,
            opsRequested: syncStats.negentropyOpsReqSent,
            opsRequestedReceived: syncStats.negentropyOpsReqReceived,
            opsPushed: syncStats.negentropyOpsPushSent,
            opsPushedReceived: syncStats.negentropyOpsPushReceived,
        },
        gatekeeper: {
            opsApplied: syncStats.opsApplied,
            opsRejected: syncStats.opsRejected,
        },
        transport: {
            bytesSent: syncStats.bytesSent,
            bytesReceived: syncStats.bytesReceived,
        },
        syncDurationMs: {
            avg: averageAggregate(syncStats.syncDurationMs),
            max: syncStats.syncDurationMs.max,
            sessions: syncStats.syncDurationMs.count,
        },
    };
}

function isNegentropyAdapterDirty(): boolean {
    return adapterBuiltSeq < adapterChangeSeq;
}

function markNegentropyAdapterDirty(): void {
    adapterChangeSeq += 1;
}

function cloneWindowStats(stats: NegentropyWindowStats | null): NegentropyWindowStats | null {
    return stats
        ? {
            ...stats,
        }
        : null;
}

function buildFullHistoryWindow(): ReconciliationWindow {
    return {
        name: 'full_history',
        fromTs: Number.MIN_SAFE_INTEGER,
        toTs: Number.MAX_SAFE_INTEGER,
        maxRecords: Number.MAX_SAFE_INTEGER,
        order: 0,
    };
}

function makeWindowId(window: ReconciliationWindow): string {
    return `${window.order}:${window.name}:${window.fromTs}:${window.toTs}:${window.maxRecords}`;
}

function windowLabel(window: ReconciliationWindow): string {
    return `${window.name}[${window.fromTs},${window.toTs}]`;
}

function getSessionWindow(session: PeerSyncSession): ReconciliationWindow | null {
    if (session.windowIndex < 0 || session.windowIndex >= session.windows.length) {
        return null;
    }
    return session.windows[session.windowIndex];
}

function parseRemoteWindow(raw: NegOpenMessage['window']): ReconciliationWindow | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const fromTs = Number(raw.fromTs);
    const toTs = Number(raw.toTs);
    const order = Number(raw.order);
    const maxRecords = Number.isInteger(Number(raw.maxRecords)) && Number(raw.maxRecords) > 0
        ? Number(raw.maxRecords)
        : config.negentropyMaxRecordsPerWindow;

    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
        return null;
    }

    if (!Number.isInteger(order) || order < 0) {
        return null;
    }

    return {
        name: String(raw.name || `window_${order}`),
        fromTs,
        toTs,
        order,
        maxRecords,
    };
}

function initializeSessionWindowState(
    session: PeerSyncSession,
    window: ReconciliationWindow,
    windowId: string,
    windowStats: NegentropyWindowStats,
): void {
    session.windowId = windowId;
    session.pendingHaveIds = [];
    session.pendingNeedIds = [];
    session.reconciliationComplete = false;
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
    options: { completed?: boolean; cappedByRounds?: boolean } = {},
): NegentropyWindowStats | null {
    if (!session.currentWindowStats) {
        return null;
    }

    const finished: NegentropyWindowStats = {
        ...session.currentWindowStats,
        completed: options.completed ?? true,
        cappedByRounds: options.cappedByRounds ?? false,
    };
    if (session.currentWindowStats.completed) {
        return session.currentWindowStats;
    }
    session.currentWindowStats = finished;
    session.completedWindows.push({ ...finished });
    return finished;
}

function shouldAdvanceToOlderWindow(session: PeerSyncSession): boolean {
    const hasMoreWindows = session.windowIndex + 1 < session.windows.length;
    if (!hasMoreWindows) {
        return false;
    }

    if (session.fullRepair) {
        return true;
    }

    return session.currentWindowStats?.cappedByRecords === true;
}

async function planRuntimeWindows(): Promise<ReconciliationWindow[]> {
    if (!negentropyAdapter) {
        // eslint-disable-next-line sonarjs/no-duplicate-string
        throw new Error('negentropy adapter unavailable');
    }

    const windows = await negentropyAdapter.planWindows(Date.now());
    if (windows.length > 0) {
        return windows;
    }

    return [buildFullHistoryWindow()];
}

function maybeStartBackgroundPrebuild(reason: string): void {
    if (!negentropyAdapter) {
        return;
    }

    if (!isNegentropyAdapterDirty()) {
        return;
    }

    if (getActiveNegentropySessions() > 0) {
        return;
    }

    if (rebuildPromise) {
        backgroundPrebuildQueued = true;
        return;
    }

    backgroundPrebuildQueued = false;
    void (async () => {
        const windows = await planRuntimeWindows();
        const recentWindow = windows[0];
        await ensureWindowAdapterFresh(recentWindow, `background_${reason}`);
    })()
        .catch(error => {
            log.error({ error, reason }, 'background negentropy prebuild failed');
        })
        .finally(() => {
            if (!backgroundPrebuildQueued) {
                return;
            }

            backgroundPrebuildQueued = false;
            if (isNegentropyAdapterDirty() && getActiveNegentropySessions() === 0) {
                maybeStartBackgroundPrebuild('queued_followup');
            }
        });
}

async function ensureWindowAdapterFresh(window: ReconciliationWindow, reason: string): Promise<NegentropyWindowStats> {
    if (!negentropyAdapter) {
        throw new Error('negentropy adapter unavailable');
    }

    const targetWindowId = makeWindowId(window);
    const now = Date.now();
    const recentlyBuilt = adapterBuiltAt > 0 && (now - adapterBuiltAt) <= NEG_ADAPTER_MAX_AGE_MS;
    const sameWindow = adapterBuiltWindowId === targetWindowId;

    if (!isNegentropyAdapterDirty() && recentlyBuilt && sameWindow) {
        const cached = cloneWindowStats(adapterBuiltWindowStats ?? negentropyAdapter.getLastWindowStats());
        if (cached) {
            return cached;
        }
    }

    if (rebuildPromise) {
        await rebuildPromise;
        const recentAfterWait = adapterBuiltAt > 0 && (Date.now() - adapterBuiltAt) <= NEG_ADAPTER_MAX_AGE_MS;
        const sameWindowAfterWait = adapterBuiltWindowId === targetWindowId;
        if (!isNegentropyAdapterDirty() && recentAfterWait && sameWindowAfterWait) {
            const cached = cloneWindowStats(adapterBuiltWindowStats ?? negentropyAdapter.getLastWindowStats());
            if (cached) {
                return cached;
            }
        }
    }

    const rebuildStartSeq = adapterChangeSeq;
    const rebuildStartedAt = Date.now();
    const currentRebuildPromise = (async () => {
        const windowStats = await negentropyAdapter!.rebuildForWindow(window);
        adapterBuiltSeq = rebuildStartSeq;
        adapterBuiltAt = Date.now();
        adapterBuiltWindowId = targetWindowId;
        adapterBuiltWindowStats = cloneWindowStats(windowStats);
        log.debug(
            {
                reason,
                durationMs: adapterBuiltAt - rebuildStartedAt,
                adapterBuiltAt,
                windowId: targetWindowId,
                window: windowLabel(window),
                dirtyAfterRebuild: isNegentropyAdapterDirty(),
            },
            'negentropy adapter rebuilt from sync-store'
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

    const refreshed = cloneWindowStats(adapterBuiltWindowStats ?? negentropyAdapter.getLastWindowStats());
    if (!refreshed) {
        throw new Error(`negentropy window stats unavailable after rebuild (${targetWindowId})`);
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
    const windowStats = await ensureWindowAdapterFresh(window, 'session_open_initiator');
    initializeSessionWindowState(session, window, windowId, windowStats);
    const firstFrame = await negentropyAdapter.initiate();
    const msg: NegOpenMessage = {
        ...createBaseMessage('neg_open'),
        sessionId: session.sessionId,
        windowId,
        window: {
            name: window.name,
            fromTs: window.fromTs,
            toTs: window.toTs,
            maxRecords: window.maxRecords,
            order: window.order,
        },
        fullRepair: session.fullRepair,
        round: session.rounds,
        frame: encodeNegentropyFrame(firstFrame),
    };

    if (!sendToPeer(peerKey, msg)) {
        closePeerSession(peerKey, 'send_neg_open_failed');
        return;
    }

    log.debug(
        {
            peer: shortName(peerKey),
            sessionId: session.sessionId,
            windowId,
            window: windowLabel(window),
            fullRepair: session.fullRepair,
        },
        'negentropy window open sent'
    );
}

async function maybeAdvanceToOlderWindow(peerKey: string, session: PeerSyncSession): Promise<boolean> {
    if (!shouldAdvanceToOlderWindow(session)) {
        return false;
    }

    session.windowIndex += 1;
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
    const batches = chunkIds(normalized, NEG_MAX_IDS_PER_OPS_REQ);

    for (const batch of batches) {
        const msg: OpsReqMessage = {
            ...createBaseMessage('ops_req'),
            sessionId: session.sessionId,
            windowId: getExpectedWindowId(session),
            round: session.rounds,
            ids: batch,
        };

        if (!sendToPeer(peerKey, msg)) {
            closePeerSession(peerKey, 'send_ops_req_failed');
            return;
        }
        syncStats.negentropyOpsReqSent += batch.length;
    }
}

async function sendOpsPushForIds(peerKey: string, session: PeerSyncSession, ids: string[]): Promise<void> {
    const normalized = Array.from(new Set(ids.map(id => id.toLowerCase()).filter(id => NEG_SYNC_ID_RE.test(id))));
    const idLookupBatches = chunkIds(normalized, NEG_MAX_IDS_PER_LOOKUP);

    for (const idBatch of idLookupBatches) {
        const rows = await syncStore.getByIds(idBatch);
        const operations = rows.map(row => row.operation);
        if (operations.length === 0) {
            continue;
        }

        const opBatches = chunkOperationsForPush(operations, {
            maxOpsPerPush: NEG_MAX_OPS_PER_PUSH,
            maxBytesPerPush: NEG_MAX_BYTES_PER_PUSH,
        });

        for (const opBatch of opBatches) {
            const msg: OpsPushMessage = {
                ...createBaseMessage('ops_push'),
                sessionId: session.sessionId,
                windowId: getExpectedWindowId(session),
                round: session.rounds,
                data: opBatch,
            };

            if (!sendToPeer(peerKey, msg)) {
                closePeerSession(peerKey, 'send_ops_push_failed');
                return;
            }
            syncStats.negentropyOpsPushSent += opBatch.length;
        }
    }
}

function sendNegMsg(peerKey: string, session: PeerSyncSession, frame: string | Uint8Array): boolean {
    const msg: NegMsgMessage = {
        ...createBaseMessage('neg_msg'),
        sessionId: session.sessionId,
        windowId: getExpectedWindowId(session),
        round: session.rounds,
        frame: encodeNegentropyFrame(frame),
    };

    return sendToPeer(peerKey, msg);
}

function sendNegClose(peerKey: string, session: PeerSyncSession, reason: string): boolean {
    session.localClosed = true;
    const windowId = session.windowId ?? 'none';
    const closeMsg: NegCloseMessage = {
        ...createBaseMessage('neg_close'),
        sessionId: session.sessionId,
        windowId,
        round: session.rounds,
        reason,
    };

    return sendToPeer(peerKey, closeMsg);
}

function mergeUniqueIds(current: string[], incoming: string[]): string[] {
    if (incoming.length === 0) {
        return current;
    }
    return Array.from(new Set([...current, ...incoming]));
}

function removeKnownIds(current: string[], known: string[]): string[] {
    if (known.length === 0 || current.length === 0) {
        return current;
    }

    const knownSet = new Set(known);
    return current.filter(id => !knownSet.has(id));
}

async function reconcileNegentropyFrame(
    peerKey: string,
    session: PeerSyncSession,
    frame: string | Uint8Array,
): Promise<{
    nextMsg: string | Uint8Array | null;
    haveIds: string[];
    needIds: string[];
} | null> {
    if (!negentropyAdapter) {
        throw new Error('negentropy adapter unavailable');
    }

    const windowRounds = session.currentWindowStats?.rounds ?? 0;
    if (windowRounds >= session.maxRounds) {
        finalizeCurrentWindowStats(session, { completed: false, cappedByRounds: true });
        sendNegClose(peerKey, session, 'max_rounds_reached');
        closePeerSession(peerKey, 'max_rounds_reached');
        return null;
    }

    const result = await negentropyAdapter.reconcile(frame);
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

async function maybeFinalizeInitiatorSession(peerKey: string, session: PeerSyncSession): Promise<void> {
    if (!session.initiator) {
        return;
    }

    if (!session.reconciliationComplete) {
        return;
    }

    if (session.pendingNeedIds.length > 0) {
        return;
    }

    const advanced = await maybeAdvanceToOlderWindow(peerKey, session);
    if (advanced) {
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

    session.pendingHaveIds = mergeUniqueIds(session.pendingHaveIds, outcome.haveIds);
    const newNeedIds = removeKnownIds(outcome.needIds, session.pendingNeedIds);
    session.pendingNeedIds = mergeUniqueIds(session.pendingNeedIds, newNeedIds);
    syncStats.negentropyRounds += 1;
    syncStats.negentropyHaveIds += outcome.haveIds.length;
    syncStats.negentropyNeedIds += outcome.needIds.length;

    if (outcome.haveIds.length > 0) {
        await sendOpsPushForIds(peerKey, session, outcome.haveIds);
    }

    if (newNeedIds.length > 0) {
        await sendOpsReq(peerKey, session, newNeedIds);
    }

    log.debug(
        {
            peer: shortName(peerKey),
            sessionId: session.sessionId,
            round: session.rounds,
            have: outcome.haveIds.length,
            need: outcome.needIds.length,
            pendingNeed: session.pendingNeedIds.length,
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
    syncStats.negentropyRounds += 1;
    syncStats.negentropyHaveIds += outcome.haveIds.length;
    syncStats.negentropyNeedIds += outcome.needIds.length;

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

function sendBatch(conn: HyperswarmConnection, batch: Operation[]): number {
    const limit = 8 * 1024 * 1014; // 8 MB limit

    const msg: BatchMessage = {
        type: 'batch',
        time: new Date().toISOString(),
        node: nodeInfo.name,
        relays: [],
        data: batch,
    };

    const json = JSON.stringify(msg);

    if (json.length < limit) {
        syncStats.bytesSent += messageBytes(json);
        conn.write(json);
        log.debug(` * sent ${batch.length} ops in ${json.length} bytes`);
        return batch.length;
    }
    else {
        if (batch.length < 2) {
            log.error(`Error: Single operation exceeds the limit of ${limit} bytes. Unable to send.`);
            return 0;
        }

        // split batch into 2 halves
        const midIndex = Math.floor(batch.length / 2);
        const batch1 = batch.slice(0, midIndex);
        const batch2 = batch.slice(midIndex);

        return sendBatch(conn, batch1) + sendBatch(conn, batch2);
    }
}

function isStringArray(arr: any[]): arr is string[] {
    return arr.every(item => typeof item === 'string');
}

async function shareDb(conn: HyperswarmConnection): Promise<void> {
    const startTimeMs = Date.now();
    try {
        const batchSize = 1000; // export DIDs in batches of 1000 for scalability
        const dids = await gatekeeper.getDIDs();

        // Either empty or we got an MdipDocument[] which should not happen.
        if (!isStringArray(dids)) {
            return;
        }

        for (let i = 0; i < dids.length; i += batchSize) {
            const didBatch = dids.slice(i, i + batchSize);
            const exports = await gatekeeper.exportBatch(didBatch);

            // hyperswarm distributes only operations
            const batch = exports.map(event => event.operation);
            log.debug(`${batch.length} operations fetched`);

            if (!batch || batch.length === 0) {
                continue;
            }

            const opsCount = batch.length;
            const sendBatchStart = Date.now();
            const opsSent = sendBatch(conn, batch);
            const sendBatchDurationMs = Date.now() - sendBatchStart;
            log.debug({ durationMs: sendBatchDurationMs }, 'sendBatch');
            log.debug(` * sent ${opsSent}/${opsCount} operations`);
        }
    }
    catch (error) {
        log.error({ error }, 'shareDb error');
    }
    const durationMs = Date.now() - startTimeMs;
    log.debug({ durationMs }, 'shareDb');
}

async function relayMsg(msg: HyperMessage): Promise<void> {
    const json = JSON.stringify(msg);

    const connectionsCount = Object.keys(connectionInfo).length;
    log.debug(`Connected nodes: ${connectionsCount}`);
    log.debug(`* sending ${msg.type} from: ${shortName(nodeKey)} (${config.nodeName}) *`);

    for (const peerKey in connectionInfo) {
        const conn = connectionInfo[peerKey];
        const last = new Date(conn.lastSeen);
        const now = Date.now();
        const minutesSinceLastSeen = Math.floor((now - last.getTime()) / 1000 / 60);
        const lastSeen = `last seen ${minutesSinceLastSeen} minutes ago ${last.toISOString()}`;

        if (!msg.relays.includes(peerKey)) {
            syncStats.bytesSent += messageBytes(json);
            conn.connection.write(json);
            log.debug(`* relaying to: ${conn.peerName} (${conn.nodeName}) ${lastSeen} *`);
        }
        else {
            log.debug(`* skipping relay to: ${conn.peerName} (${conn.nodeName}) ${lastSeen} *`);
        }
    }
}

async function importBatch(batch: Operation[]): Promise<Operation[]> {
    // The batch we receive from other hyperswarm nodes includes just operations.
    // We have to wrap the operations in new events before submitting to our gatekeeper for importing
    try {
        const hash = cipher.hashJSON(batch);
        const events = [];
        const now = new Date();
        const isoTime = now.toISOString();
        const ordTime = now.getTime();

        for (let i = 0; i < batch.length; i++) {
            events.push({
                registry: REGISTRY,
                time: isoTime,
                ordinal: [ordTime, i],
                operation: batch[i],
            })
        }

        log.debug(`importBatch: ${shortName(hash)} merging ${events.length} events...`);
        const importStart = Date.now();
        const response = await gatekeeper.importBatch(events);
        const importDurationMs = Date.now() - importStart;
        log.debug({ durationMs: importDurationMs }, 'importBatch');
        log.debug(`* ${JSON.stringify(response)}`);
        syncStats.opsRejected += response.rejected ?? 0;

        return filterIndexRejectedOperations(batch, response.rejectedIndices);
    }
    catch (error) {
        log.error({ error }, 'importBatch error');
        return [];
    }
}

async function persistAcceptedOperations(operations: Operation[], source: string): Promise<void> {
    if (!Array.isArray(operations) || operations.length === 0) {
        return;
    }

    const { records, invalid } = mapAcceptedOperationsToSyncRecords(operations);
    if (records.length === 0) {
        log.debug({ source, attempted: operations.length, invalid }, 'sync-store persist skipped');
        return;
    }

    const inserted = await syncStore.upsertMany(records);
    if (inserted > 0) {
        markNegentropyAdapterDirty();
        maybeStartBackgroundPrebuild(`persist_${source}`);
    }
    log.debug(
        { source, attempted: operations.length, mapped: records.length, invalid, inserted },
        'sync-store persist accepted ops'
    );
}

async function mergeBatch(batch: Operation[]): Promise<void> {

    if (!batch) {
        return;
    }

    let chunk = [];
    const acceptedCandidates: Operation[] = [];

    for (const operation of batch) {
        chunk.push(operation);

        if (chunk.length >= BATCH_SIZE) {
            const candidates = await importBatch(chunk);
            acceptedCandidates.push(...candidates);
            chunk = [];
        }
    }

    if (chunk.length > 0) {
        const candidates = await importBatch(chunk);
        acceptedCandidates.push(...candidates);
    }

    const processStart = Date.now();
    const response = await gatekeeper.processEvents();
    const processDurationMs = Date.now() - processStart;
    log.debug({ durationMs: processDurationMs }, 'processEvents');
    const { acceptedHashes: _acceptedHashes, ...processSummary } = response;
    log.debug(`mergeBatch: ${JSON.stringify(processSummary)}`);
    syncStats.opsApplied += (response.added ?? 0) + (response.merged ?? 0);
    syncStats.opsRejected += response.rejected ?? 0;

    const acceptedToPersist = filterOperationsByAcceptedHashes(acceptedCandidates, response.acceptedHashes);
    await persistAcceptedOperations(acceptedToPersist, 'mergeBatch');
}

let importQueue = asyncLib.queue<ImportQueueTask, asyncLib.ErrorCallback>(
    async function (task, callback) {
        const { name, msg } = task;
        try {
            const ready = await gatekeeper.isReady();

            if (ready) {
                const batch = msg.data || [];

                if (batch.length === 0) {
                    return;
                }

                if (msg.type === 'queue') {
                    syncStats.queueOpsImported += batch.length;
                    const samples = collectQueueDelaySamples(batch);
                    for (const sample of samples) {
                        addAggregateSample(syncStats.queueDelayMs, sample);
                    }
                }

                const nodeName = msg.node || 'anon';
                log.debug(`* merging batch (${batch.length} events) from: ${shortName(name)} (${nodeName}) *`);
                await mergeBatch(batch);
            }
        }
        catch (error) {
            log.error({ error }, 'mergeBatch error');
        }
        callback();
    }, 1); // concurrency is 1

let exportQueue = asyncLib.queue<ExportQueueTask, asyncLib.ErrorCallback>(
    async function (task, callback) {
        const { name, msg, conn } = task;
        try {
            const ready = await gatekeeper.isReady();

            if (ready) {
                const mode = connectionInfo[name]?.syncMode ?? 'unknown';
                if (!shouldAcceptLegacySync(mode, config.legacySyncEnabled)) {
                    log.debug({ peer: shortName(name), mode }, 'shareDb skipped by sync mode policy');
                    return;
                }
                log.debug(`* sharing db with: ${shortName(name)} (${msg.node || 'anon'}) *`);
                await shareDb(conn);
            }
        }
        catch (error) {
            log.error({ error }, 'shareDb error');
        }
        callback();
    }, 1); // concurrency is 1


const batchesSeen: Record<string, boolean> = {};

function newBatch(batch: Operation[]): boolean {
    const hash = cipher.hashJSON(batch);

    if (!batchesSeen[hash]) {
        batchesSeen[hash] = true;
        return true;
    }

    return false;
}

async function addPeer(did: string): Promise<void> {
    if (!config.ipfsEnabled) {
        return;
    }

    // Check peer suffix to avoid duplicate DID aliases
    const suffix = did.split(':').pop() || '';

    if (suffix in addedPeers) {
        return;
    }

    log.info(`Adding peer ${did}...`);
    addedPeers[suffix] = Date.now();

    try {
        const docs = await keymaster.resolveDID(did);
        const data = docs.didDocumentData as { node: NodeInfo };

        if (!data?.node || !data.node.ipfs) {
            return;
        }

        const { id, addresses } = data.node.ipfs;

        if (!id || !addresses) {
            return;
        }

        if (id !== nodeInfo.ipfs.id) {
            // A node should never add itself as a peer node
            await ipfs.addPeeringPeer(id, addresses);
        }

        knownNodes[did] = {
            name: data.node.name,
            ipfs: {
                id,
                addresses,
            },
        };

        knownPeers[id] = data.node.name;

        log.info(`Added IPFS peer: ${did} ${JSON.stringify(knownNodes[did], null, 4)}`);
    }
    catch (error) {
        if (!(did in badPeers)) {
            // Store time of first error so we can later implement a retry mechanism
            badPeers[did] = Date.now();
            log.error({ error }, `Error adding IPFS peer: ${did}`);
        }
    }
}

async function receiveMsg(peerKey: string, json: Buffer | string): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    let msg: HyperMessage;
    const payload = typeof json === 'string' ? json : json.toString('utf8');
    syncStats.bytesReceived += messageBytes(payload);

    try {
        msg = JSON.parse(payload);
    }
    catch (error) {
        const jsonPreview = payload.length > 80 ? `${payload.slice(0, 40)}...${payload.slice(-40)}` : payload;
        log.warn(`received invalid message from: ${conn.peerName}, JSON: ${jsonPreview}`);
        return;
    }

    const nodeName = msg.node || 'anon';

    log.debug(`received ${msg.type} from: ${shortName(peerKey)} (${nodeName})`);
    connectionInfo[peerKey].lastSeen = new Date().getTime();

    if (msg.type === 'batch') {
        if (Array.isArray(msg.data) && newBatch(msg.data)) {
            importQueue.push({ name: peerKey, msg });
        }
        return;
    }

    if (msg.type === 'queue') {
        if (Array.isArray(msg.data) && newBatch(msg.data)) {
            importQueue.push({ name: peerKey, msg });
            if (!Array.isArray(msg.relays)) {
                msg.relays = [];
            }
            msg.relays.push(peerKey);
            await relayMsg(msg);
        }
        return;
    }

    if (msg.type === 'sync') {
        if (!shouldAcceptLegacySync(connectionInfo[peerKey].syncMode, config.legacySyncEnabled)) {
            log.debug(
                { peer: shortName(peerKey), mode: connectionInfo[peerKey].syncMode },
                'ignoring legacy sync request'
            );
            return;
        }
        exportQueue.push({ name: peerKey, msg, conn: conn.connection });
        return;
    }

    if (msg.type === 'ping') {
        connectionInfo[peerKey].nodeName = nodeName;
        connectionInfo[peerKey].capabilities = normalizePeerCapabilities(msg.capabilities);

        if (Array.isArray(msg.peers)) {
            for (const did of msg.peers) {
                addPeer(did);
            }
        }

        await maybeStartPeerSync(peerKey);
        return;
    }

    if (msg.type === 'neg_open') {
        if (!negentropyAdapter) {
            log.warn('neg_open ignored because adapter is unavailable');
            return;
        }

        const window = parseRemoteWindow(msg.window);
        if (!window) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_open with invalid window');
            return;
        }
        if (typeof msg.windowId !== 'string' || msg.windowId.length === 0) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_open with invalid windowId');
            return;
        }

        let session = peerSessions.get(peerKey);
        if (session && session.sessionId !== msg.sessionId) {
            closePeerSession(peerKey, 'replaced_by_remote_open');
            session = undefined;
        }

        if (!session || session.mode !== 'negentropy' || session.sessionId !== msg.sessionId) {
            session = createPeerSession(peerKey, 'negentropy', false, msg.sessionId);
        }

        session.initiator = false;
        session.fullRepair = msg.fullRepair === true;
        session.maxRounds = config.negentropyMaxRoundsPerSession;
        const existingIndex = session.windows.findIndex(existingWindow => makeWindowId(existingWindow) === msg.windowId);
        if (existingIndex >= 0) {
            session.windows[existingIndex] = window;
            session.windowIndex = existingIndex;
        } else {
            session.windows.push(window);
            session.windowIndex = session.windows.length - 1;
        }
        const windowStats = await ensureWindowAdapterFresh(window, 'session_open_responder');
        initializeSessionWindowState(session, window, msg.windowId, windowStats);
        touchPeerSession(peerKey);
        await handleNegentropyRoundAsResponder(peerKey, session, decodeNegentropyFrame(msg.frame));
        return;
    }

    if (msg.type === 'neg_msg') {
        const session = peerSessions.get(peerKey);
        if (!session || session.mode !== 'negentropy' || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring neg_msg for unknown session');
            return;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'neg_msg')) {
            return;
        }

        touchPeerSession(peerKey);
        if (session.initiator) {
            await handleNegentropyRoundAsInitiator(peerKey, session, decodeNegentropyFrame(msg.frame));
        } else {
            await handleNegentropyRoundAsResponder(peerKey, session, decodeNegentropyFrame(msg.frame));
        }
        return;
    }

    if (msg.type === 'ops_req') {
        const session = peerSessions.get(peerKey);
        if (!session || session.mode !== 'negentropy' || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ops_req for unknown session');
            return;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'ops_req')) {
            return;
        }

        const requestedIds = Array.isArray(msg.ids)
            ? Array.from(new Set(msg.ids.map(id => String(id).toLowerCase()).filter(id => NEG_SYNC_ID_RE.test(id))))
            : [];
        syncStats.negentropyOpsReqReceived += requestedIds.length;
        await sendOpsPushForIds(peerKey, session, requestedIds);
        touchPeerSession(peerKey);
        return;
    }

    if (msg.type === 'ops_push') {
        const session = peerSessions.get(peerKey);
        if (!session || session.mode !== 'negentropy' || session.sessionId !== msg.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ops_push for unknown session');
            return;
        }
        if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'ops_push')) {
            return;
        }

        const batch = Array.isArray(msg.data) ? msg.data : [];
        if (batch.length > 0) {
            syncStats.negentropyOpsPushReceived += batch.length;
            const pushedIds = new Set(extractOperationHashes(batch));
            session.pendingNeedIds = session.pendingNeedIds.filter(id => !pushedIds.has(id));

            if (newBatch(batch)) {
                importQueue.push({
                    name: peerKey,
                    msg: {
                        ...createBaseMessage('batch'),
                        data: batch,
                    },
                });
            }

            await maybeFinalizeInitiatorSession(peerKey, session);
        }

        touchPeerSession(peerKey);
        return;
    }

    if (msg.type === 'neg_close') {
        const session = peerSessions.get(peerKey);
        if (session && session.sessionId === msg.sessionId && (!session.windowId || msg.windowId === session.windowId)) {
            closePeerSession(peerKey, msg.reason || 'remote_closed');
        }
        return;
    }

    log.warn(`unknown message type: ${msg.type}`);
}

async function flushQueue(): Promise<void> {
    const batch = await gatekeeper.getQueue(REGISTRY);
    log.debug(`${REGISTRY} queue: ${JSON.stringify(batch, null, 4)}`);

    if (batch.length > 0) {
        await persistAcceptedOperations(batch, 'flushQueue');
        syncStats.queueOpsRelayed += batch.length;
        const samples = collectQueueDelaySamples(batch);
        for (const sample of samples) {
            addAggregateSample(syncStats.queueDelayMs, sample);
        }

        const msg: BatchMessage = {
            type: 'queue',
            time: new Date().toISOString(),
            node: nodeInfo.name,
            relays: [],
            data: batch,
        };

        const hashes = batch
            .map(op => op.signature?.hash)
            .filter((hash): hash is string => !!hash);
        await gatekeeper.clearQueue(REGISTRY, hashes);
        await relayMsg(msg);
        await mergeBatch(batch);
    }
}

async function exportLoop(): Promise<void> {
    try {
        await flushQueue();
    } catch (error) {
        log.error({ error }, 'Error in exportLoop');
    }

    const importQueueLength = importQueue.length();

    if (importQueueLength > 0) {
        const delay = 60;
        log.debug(`export loop waiting ${delay}s for import queue to clear: ${importQueueLength}...`);
        setTimeout(exportLoop, delay * 1000);
    }
    else {
        log.debug(`export loop waiting ${config.exportInterval}s...`);
        setTimeout(exportLoop, config.exportInterval * 1000);
    }
}

async function checkConnections(): Promise<void> {
    expireIdlePeerSessions();

    if (Object.keys(connectionInfo).length === 0) {
        log.warn("No active connections, rejoining the topic...");
        await createSwarm();
        return;
    }

    const expireLimit = 3 * 60 * 1000; // 3 minutes in milliseconds
    const now = Date.now();

    for (const peerKey in connectionInfo) {
        const conn = connectionInfo[peerKey];
        const timeSinceLastSeen = now - conn.lastSeen;

        if (timeSinceLastSeen > expireLimit) {
            log.info(`Removing stale connection info for: ${conn.peerName} (${conn.nodeName}), last seen ${timeSinceLastSeen / 1000}s ago`);
            closeConnection(peerKey);
        }
    }
}

async function connectionLoop(): Promise<void> {
    try {
        log.debug(`Node info: ${JSON.stringify(nodeInfo, null, 4)}`);
        log.info(`Connected to hyperswarm protocol: ${config.protocol}`);

        await checkConnections();

        const msg: PingMessage = buildPingMessage();

        await relayMsg(msg);
        await runPeriodicNegentropyRepair();

        log.debug({ syncStats: buildSyncStatsSnapshot() }, 'hyperswarm sync stats');

        if (config.ipfsEnabled) {
            const peeringPeers = await ipfs.getPeeringPeers();
            console.log(`IPFS peers: ${peeringPeers.length}`);
            for (const peer of peeringPeers) {
                log.debug(`* peer ${peer.ID} (${knownPeers[peer.ID]})`);
            }
        }

        log.debug('connection loop waiting 60s...');
    } catch (error) {
        log.error({ error }, 'Error in pingLoop');
    }
    setTimeout(connectionLoop, 60 * 1000);
}

process.on('uncaughtException', (error) => {
    log.error({ error }, 'Unhandled exception caught');
});

process.on('unhandledRejection', (reason, promise) => {
    log.error({ reason, promise }, 'Unhandled rejection at');
});

process.stdin.on('data', d => {
    if (d.toString().startsWith('q')) {
        process.exit();
    }
});

// Join a common topic
const hash = sha256(config.protocol);
const networkID = Buffer.from(hash).toString('hex');
const topic = Buffer.from(b4a.from(networkID, 'hex'));

async function main(): Promise<void> {
    await syncStore.start();

    await gatekeeper.connect({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    const bootstrap = await bootstrapSyncStoreIfEmpty(syncStore, gatekeeper);
    log.info({ bootstrap }, 'sync-store bootstrap complete');

    await initNegentropyAdapter();

    if (config.ipfsEnabled) {
        await keymaster.connect({
            url: config.keymasterURL,
            waitUntilReady: true,
            intervalSeconds: 5,
            chatty: true,
        });

        if (!config.nodeID) {
            console.log('nodeID is not set. Please set the nodeID in the config file.');
            exit(1);
        }

        const { didDocument } = await keymaster.resolveDID(config.nodeID);

        if (!didDocument) {
            log.error(`DID document not found for nodeID: ${config.nodeID}`);
            exit(1);
        }

        const nodeDID = didDocument.id;

        if (!nodeDID) {
            log.error('nodeID is not set. Please set the nodeID in the config file.');
            exit(1);
        }

        log.info(`Using nodeID: ${config.nodeID} (${nodeDID})`);

        await ipfs.connect({
            url: config.ipfsURL,
            waitUntilReady: true,
            intervalSeconds: 5,
            chatty: true,
        });
        await ipfs.resetPeeringPeers();

        const ipfsID = await ipfs.getPeerID();
        const ipfsAddresses = await ipfs.getAddresses();
        log.info(`Using IPFS nodeID: ${JSON.stringify(ipfsID, null, 4)}`);

        nodeInfo = {
            name: config.nodeName,
            ipfs: {
                id: ipfsID,
                addresses: ipfsAddresses,
            },
        };

        knownNodes[nodeDID] = nodeInfo;
        await keymaster.updateAsset(nodeDID, { node: nodeInfo });
    } else {
        nodeInfo = {
            name: config.nodeName,
            ipfs: null,
        };
    }

    await exportLoop();
    await connectionLoop();
}

async function initNegentropyAdapter(): Promise<void> {
    negentropyAdapter = await NegentropyAdapter.create({
        syncStore,
        frameSizeLimit: config.negentropyFrameSizeLimit,
        recentWindowDays: config.negentropyRecentWindowDays,
        olderWindowDays: config.negentropyOlderWindowDays,
        maxRecordsPerWindow: config.negentropyMaxRecordsPerWindow,
        maxRoundsPerSession: config.negentropyMaxRoundsPerSession,
        deferInitialBuild: true,
    });
    adapterChangeSeq = 0;
    adapterBuiltSeq = -1;
    adapterBuiltAt = 0;
    adapterBuiltWindowId = null;
    adapterBuiltWindowStats = null;
    rebuildPromise = null;
    backgroundPrebuildQueued = false;
    log.info(
        {
            stats: negentropyAdapter.getStats(),
            recentWindowDays: config.negentropyRecentWindowDays,
            olderWindowDays: config.negentropyOlderWindowDays,
            maxRecordsPerWindow: config.negentropyMaxRecordsPerWindow,
            maxRoundsPerSession: config.negentropyMaxRoundsPerSession,
            frameSizeLimit: config.negentropyFrameSizeLimit,
        },
        'negentropy adapter initialized'
    );
}

export async function runMediator(options: MediatorMainOptions = {}): Promise<void> {
    if (options.syncStore) {
        syncStore = options.syncStore;
    }

    if (options.startLoops === false) {
        await syncStore.start();
        return;
    }

    return main();
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
    runMediator().catch(error => {
        log.error({ error }, 'fatal mediator error');
        process.exit(1);
    });
}
