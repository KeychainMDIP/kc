import Hyperswarm, { HyperswarmConnection } from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { createHash, randomBytes } from 'crypto';
import asyncLib from 'async';
import { EventEmitter } from 'events';

import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import KuboClient from '@mdip/ipfs/kubo';
import { generateCID } from '@mdip/ipfs/utils';
import { Operation } from '@mdip/gatekeeper/types';
import CipherNode from '@mdip/cipher/node';
import { childLogger } from '@mdip/common/logger';
import config from './config.js';
import type {
    OperationSyncStore,
    SyncOperationRecord,
    SyncOperationWriteRecord,
    SyncStoreCursor,
} from './db/types.js';
import SqliteOperationSyncStore from './db/sqlite.js';
import PostgresOperationSyncStore from './db/postgres.js';
import NegentropyAdapter, {
    type NegentropyWindowSnapshot,
    type NegentropyWindowStats,
    type ReconciliationWindow,
} from './negentropy/adapter.js';
import {
    NEG_SYNC_ID_RE,
    buildOrderedCatchupCapabilities,
    chooseConnectSyncMode,
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    normalizeNegentropyIds,
    normalizePeerCapabilities,
    parseRemoteWindow,
    supportsPeerNegentropy,
    type ConnectSyncModeReason,
    type PeerCapabilities,
    type SyncMode,
} from './negentropy/protocol.js';
import {
    decideInboundNegOpenConflict,
    hasActiveOrderedCatchupSession,
    shouldSchedulePeriodicRepair,
    shouldStartConnectTimeNegentropy,
    shouldStartPostOrderedCatchupNegentropy,
} from './negentropy/policy.js';
import {
    addAggregateSample,
    collectQueueDelaySamples,
} from './negentropy/observability.js';
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
import { bootstrapSyncStoreFromGatekeeper, type BootstrapResult } from './bootstrap.js';
import {
    dedupeOperationsByHash,
    filterKnownOperations,
    hasContentVerifiedOperationId,
    mapAcceptedOperationsToSyncRecords,
    partitionImportBatchOperations,
    prunePersistedSyncRecords,
} from './sync-persistence.js';
import { resolveAcceptedOperationsToPersist } from './sync-store-mirroring.js';
import {
    mapOperationToSyncKey,
} from './sync-mapping.js';
import {
    getExpectedOrderedCatchupRequestDecision,
    getOrderedCatchupDecision,
    getOrderedCursorFromRow,
    isOrderedCursorAfter,
    parseOrderedCatchupCursor,
} from './ordered-catchup.js';
import {
    classifyPendingBuffer,
    DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
    decodeFramedMessages,
    decodeLegacyJsonMessages,
    decodeUnknownTransportMessages,
    encodeFramedMessage,
    supportsLegacyRawTransportMessage,
} from './transport-framing.js';
import type {
    HyperMessage,
    HyperMessageBase,
    NativeNegentropyFrame,
    NegCloseMessage,
    NegentropyRoundOutcome,
    NegMsgMessage,
    NegOpenMessage,
    OpsPushMessage,
    OrderedCatchupDoneMessage,
    OrderedCatchupPushMessage,
    OrderedCatchupReqMessage,
    OpsReqMessage,
    PingMessage,
    QueueMessage,
} from './protocol-messages.js';
import {
    createConnectionInfo,
    createPeerSyncSessionState,
    type ConnectionInfo,
    type ImportQueueResult,
    type ImportQueueTask,
    type MalformedPeerState,
    type MediatorMainOptions,
    type NodeInfo,
    type PeerSessionMode,
    type PeerSyncSession,
} from './mediator-state.js';
import {
    buildSyncStatsSnapshot,
    createMediatorSyncStats,
} from './sync-stats.js';
import { exit } from 'process';
import path from 'path';
import { pathToFileURL } from 'url';

const log = childLogger({ service: 'hyperswarm-mediator' });

export type { MediatorMainOptions } from './mediator-state.js';

const gatekeeper = new GatekeeperClient();
const keymaster = new KeymasterClient();
const ipfs = new KuboClient();
const cipher = new CipherNode();

async function generateOperationCid(operation: Operation): Promise<string> {
    const canonical = cipher.canonicalizeJSON(operation);
    return generateCID(JSON.parse(canonical));
}

function createConfiguredSyncStore(): OperationSyncStore {
    if (config.db === 'postgres') {
        return new PostgresOperationSyncStore(config.postgresURL);
    }

    return new SqliteOperationSyncStore();
}

let syncStore: OperationSyncStore = createConfiguredSyncStore();
const pendingSyncRecords = new Map<string, SyncOperationWriteRecord>();
const terminalOperationCids = new Set<string>();
let negentropyAdapter: NegentropyAdapter | null = null;
let adapterChangeSeq = 0;
let adapterBuiltSeq = -1;
let adapterBuiltAt = 0;
let adapterBuiltWindowId: string | null = null;
let adapterBuiltSnapshot: NegentropyWindowSnapshot | null = null;
let rebuildPromise: Promise<void> | null = null;
let backgroundPrebuildQueued = false;

function replaceSyncStore(store: OperationSyncStore): void {
    pendingSyncRecords.clear();
    terminalOperationCids.clear();
    syncStore = store;
}

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const BATCH_SIZE = 100;
const NEGENTROPY_VERSION = 1;
const ORDERED_CATCHUP_VERSION = 1;
const TRANSPORT_FRAMING_VERSION = 1;
const MAX_FRAMED_MESSAGE_BYTES = DEFAULT_MAX_FRAMED_MESSAGE_BYTES;
const NEG_SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const NEG_MAX_IDS_PER_OPS_REQ = 1_000;
const NEG_MAX_IDS_PER_LOOKUP = 1_000;
const NEG_MAX_OPS_PER_PUSH = 300;
const MAX_PENDING_SYNC_RECORDS = NEG_MAX_IDS_PER_LOOKUP;
const TERMINAL_REJECTED_SYNC_ORDER = Number.MAX_SAFE_INTEGER;
const NEG_MAX_BYTES_PER_PUSH = 512 * 1024;
const ORDERED_CATCHUP_PREFETCH_BATCHES = 2;
const NEG_REPAIR_INTERVAL_MS = config.negentropyIntervalSeconds * 1000;
const NEG_ADAPTER_MAX_AGE_MS = 60 * 1000;
const ORDERED_CATCHUP_SERVER_EXPECTATION_MS = 5 * 1000;
const MALFORMED_PEER_STRIKE_WINDOW_MS = 5 * 60 * 1000;
const MALFORMED_PEER_COOLDOWN_MS = 5 * 60 * 1000;
const MALFORMED_PEER_REJECT_LOG_INTERVAL_MS = 60 * 1000;
const MALFORMED_PEER_MAX_STRIKES = 3;
const connectionInfo: Record<string, ConnectionInfo> = {};
const knownNodes: Record<string, NodeInfo> = {};
const knownPeers: Record<string, string> = {};
const addedPeers: Record<string, number> = {};
const badPeers: Record<string, number> = {};
const malformedPeers: Record<string, MalformedPeerState> = {};
const peerSessions = new Map<string, PeerSyncSession>();
const orderedCatchupTransitionPeers = new Set<string>();
let outboundSyncStartInProgress = false;
const syncStats = createMediatorSyncStats();

let swarm: Hyperswarm | null = null;
let nodeKey = '';
let nodeInfo: NodeInfo;

goodbye(async () => {
    if (swarm) {
        try {
            await Promise.resolve(swarm.destroy());
        } catch (error) {
            log.error({ error }, 'swarm destroy error');
        } finally {
            swarm = null;
        }
    }

    try {
        await syncStore.stop();
    } catch (error) {
        log.error({ error }, 'syncStore stop error');
    }
});

async function createSwarm(): Promise<void> {
    if (swarm) {
        await Promise.resolve(swarm.destroy());
    }

    swarm = new Hyperswarm();
    nodeKey = b4a.toString(swarm.keyPair.publicKey, 'hex');

    swarm.on('connection', conn => addConnection(conn));

    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();

    const shortTopic = shortName(b4a.toString(topic, 'hex'));
    log.info(`new hyperswarm peer id: ${shortName(nodeKey)} (${config.nodeName}) joined topic: ${shortTopic} using protocol: ${config.protocol}`);
}

function getMalformedPeerCooldown(peerKey: string, nowMs = Date.now()): MalformedPeerState | null {
    const state = malformedPeers[peerKey];
    if (!state) {
        return null;
    }

    if (state.cooldownUntil <= nowMs) {
        if ((nowMs - state.lastSeenAt) > MALFORMED_PEER_STRIKE_WINDOW_MS) {
            delete malformedPeers[peerKey];
        }
        return null;
    }

    return state;
}

function noteMalformedPeer(peerKey: string, reason: string): void {
    const nowMs = Date.now();
    let state = malformedPeers[peerKey];
    if (!state || (nowMs - state.firstSeenAt) > MALFORMED_PEER_STRIKE_WINDOW_MS) {
        state = {
            strikes: 0,
            firstSeenAt: nowMs,
            lastSeenAt: nowMs,
            cooldownUntil: 0,
            lastReason: reason,
            rejectedConnections: 0,
            lastRejectLogAt: 0,
        };
        malformedPeers[peerKey] = state;
    }

    state.strikes += 1;
    state.lastSeenAt = nowMs;
    state.lastReason = reason;

    if (state.strikes >= MALFORMED_PEER_MAX_STRIKES && state.cooldownUntil <= nowMs) {
        state.cooldownUntil = nowMs + MALFORMED_PEER_COOLDOWN_MS;
        state.rejectedConnections = 0;
        state.lastRejectLogAt = 0;
        syncStats.malformedPeerCooldowns += 1;
        log.warn(
            {
                peer: shortName(peerKey),
                reason,
                strikes: state.strikes,
                cooldownMs: MALFORMED_PEER_COOLDOWN_MS,
            },
            'peer entered malformed message cooldown'
        );
    }
}

function rejectMalformedPeerIfCoolingDown(peerKey: string, conn: HyperswarmConnection): boolean {
    const state = getMalformedPeerCooldown(peerKey);
    if (!state) {
        return false;
    }

    const nowMs = Date.now();
    state.rejectedConnections += 1;
    syncStats.malformedPeerConnectionsRejected += 1;

    const logPayload = {
        peer: shortName(peerKey),
        lastReason: state.lastReason,
        strikes: state.strikes,
        rejectedConnections: state.rejectedConnections,
        remainingMs: state.cooldownUntil - nowMs,
    };
    if ((nowMs - state.lastRejectLogAt) >= MALFORMED_PEER_REJECT_LOG_INTERVAL_MS) {
        state.lastRejectLogAt = nowMs;
        log.warn(logPayload, 'rejecting hyperswarm peer during malformed message cooldown');
    } else {
        log.debug(logPayload, 'rejecting hyperswarm peer during malformed message cooldown');
    }

    try {
        if (typeof conn.destroy === 'function') {
            conn.destroy();
        }
    }
    catch (error) {
        log.warn({ error, peer: shortName(peerKey) }, 'failed to destroy rejected malformed peer connection');
    }
    return true;
}

function clearMalformedPeer(peerKey: string, reason: string): void {
    const state = malformedPeers[peerKey];
    if (!state) {
        return;
    }

    delete malformedPeers[peerKey];
    log.info(
        {
            peer: shortName(peerKey),
            reason,
            strikes: state.strikes,
            rejectedConnections: state.rejectedConnections,
        },
        'cleared malformed peer cooldown state'
    );
}

function addConnection(conn: HyperswarmConnection): void {
    const peerKey = b4a.toString(conn.remotePublicKey, 'hex');
    const peerName = shortName(peerKey);

    if (rejectMalformedPeerIfCoolingDown(peerKey, conn)) {
        return;
    }

    conn.once('close', () => closeConnection(peerKey));
    conn.once('error', error => {
        log.warn({ error, peer: peerName }, 'hyperswarm peer connection error');
        terminatePeerConnection(peerKey, 'connection_error');
    });
    conn.on('data', data => queueInboundPeerData(peerKey, data));

    log.info(`received connection from: ${peerName}`);

    connectionInfo[peerKey] = createConnectionInfo({
        connection: conn,
        peerKey,
        peerName,
    });

    const peerNames = Object.values(connectionInfo).map(info => info.peerName);
    log.debug(`--- ${peerNames.length} nodes connected, detected nodes: ${peerNames.join(', ')}`);

    void sendPingToPeer(peerKey, 'initial');
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

function terminatePeerConnection(peerKey: string, reason: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    closePeerSession(peerKey, reason);

    try {
        if (typeof conn.connection.destroy === 'function') {
            conn.connection.destroy();
        } else {
            closeConnection(peerKey);
        }
    }
    catch (error) {
        log.warn({ error, peer: shortName(peerKey), reason }, 'failed to destroy peer connection');
        closeConnection(peerKey);
    }
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

function createBaseMessage<T extends HyperMessage['type']>(type: T): Omit<HyperMessageBase, 'type'> & { type: T } {
    return {
        type,
        time: new Date().toISOString(),
        node: nodeInfo?.name || config.nodeName,
        relays: [],
    };
}

function writeLegacyJson(conn: HyperswarmConnection, json: string): number {
    const bytes = Buffer.byteLength(json, 'utf8');
    syncStats.bytesSent += bytes;
    conn.write(json);
    return bytes;
}

function writeFramedJson(conn: HyperswarmConnection, json: string): number {
    const framed = encodeFramedMessage(json, MAX_FRAMED_MESSAGE_BYTES);
    syncStats.bytesSent += framed.length;
    conn.write(framed);
    return framed.length;
}

function setPeerTransportMode(
    peerKey: string,
    transportMode: ConnectionInfo['transportMode'],
    reason: string,
): void {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.transportMode === transportMode) {
        return;
    }

    const previousMode = conn.transportMode;
    conn.transportMode = transportMode;
    log.debug({
        peer: shortName(peerKey),
        previousMode,
        transportMode,
        reason,
    }, 'updated hyperswarm transport mode');
}

function setPeerInboundTransportMode(
    peerKey: string,
    inboundTransportMode: ConnectionInfo['inboundTransportMode'],
    reason: string,
): void {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.inboundTransportMode === inboundTransportMode) {
        return;
    }

    const previousMode = conn.inboundTransportMode;
    conn.inboundTransportMode = inboundTransportMode;
    log.debug({
        peer: shortName(peerKey),
        previousMode,
        inboundTransportMode,
        reason,
    }, 'updated hyperswarm inbound transport mode');
}

async function buildPeerCapabilities(): Promise<PeerCapabilities> {
    if (!config.negentropyEnabled) {
        return {
            negentropy: false,
            ...buildOrderedCatchupCapabilities({
                enabled: false,
                version: ORDERED_CATCHUP_VERSION,
                operationCount: 0,
                orderedOperationCount: 0,
            }),
        };
    }

    const orderedStatus = await getLocalOrderedCatchupStatus();

    return {
        negentropy: true,
        negentropyVersion: NEGENTROPY_VERSION,
        ...buildOrderedCatchupCapabilities({
            enabled: config.orderedCatchupEnabled,
            version: ORDERED_CATCHUP_VERSION,
            operationCount: orderedStatus.operationCount,
            orderedOperationCount: orderedStatus.orderedOperationCount,
        }),
    };
}

async function getLocalOrderedCatchupStatus(): Promise<{
    operationCount: number;
    orderedOperationCount: number;
    ready: boolean;
}> {
    const [operationCount, orderedOperationCount] = await Promise.all([
        syncStore.count(),
        syncStore.countOrdered(),
    ]);

    return {
        operationCount,
        orderedOperationCount,
        ready: operationCount > 0 && operationCount === orderedOperationCount,
    };
}

async function buildPingMessage(): Promise<PingMessage> {
    const capabilities = await buildPeerCapabilities();

    return {
        ...createBaseMessage('ping'),
        peers: Object.keys(knownNodes),
        capabilities,
        transportFramingVersion: TRANSPORT_FRAMING_VERSION,
    };
}

interface SendToPeerOptions {
    initialPing?: boolean;
}

function sendToPeer(peerKey: string, msg: HyperMessage, options: SendToPeerOptions = {}): boolean {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return false;
    }

    try {
        const json = JSON.stringify(msg);
        if (conn.transportMode === 'framed') {
            writeFramedJson(conn.connection, json);
        } else if (conn.transportMode === 'legacy' && supportsLegacyRawTransportMessage(msg.type)) {
            writeLegacyJson(conn.connection, json);
        } else if (conn.transportMode === 'unknown'
            && msg.type === 'ping'
            && options.initialPing === true
            && !conn.initialPingSent) {
            writeLegacyJson(conn.connection, json);
            conn.initialPingSent = true;
        } else {
            log.debug({ peer: shortName(peerKey), type: msg.type }, 'deferring hyperswarm message until transport negotiation completes');
            return false;
        }
        return true;
    }
    catch (error) {
        log.error({ error, peer: shortName(peerKey), type: msg.type, transportMode: conn.transportMode }, 'failed to send hyperswarm message');
        return false;
    }
}

async function sendPingToPeer(peerKey: string, source: 'initial' | 'periodic' = 'periodic'): Promise<void> {
    const ping = await buildPingMessage();
    if (sendToPeer(peerKey, ping, { initialPing: source === 'initial' })) {
        log.debug(`* sent ping to: ${shortName(peerKey)}`);
    }
}

function createSessionId(peerKey: string): string {
    const nonce = randomBytes(8).toString('hex');
    return `${Date.now().toString(36)}-${shortName(nodeKey)}-${shortName(peerKey)}-${nonce}`;
}

function createPeerSession(peerKey: string, mode: PeerSessionMode, initiator: boolean, sessionId?: string): PeerSyncSession {
    const now = Date.now();
    const session = createPeerSyncSessionState({
        sessionId: sessionId ?? createSessionId(peerKey),
        peerKey,
        mode,
        initiator,
        maxRounds: config.negentropyMaxRoundsPerSession,
        now,
    });
    peerSessions.set(peerKey, session);
    connectionInfo[peerKey].syncMode = mode === 'ordered_catchup' ? 'negentropy' : mode;
    connectionInfo[peerKey].syncStarted = true;
    if (mode === 'negentropy') {
        syncStats.negentropySessionsStarted += 1;
        connectionInfo[peerKey].lastNegentropyAttemptAt = now;
    } else if (mode === 'ordered_catchup') {
        syncStats.orderedCatchupSessionsStarted += 1;
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

    const retryOnNextPeriodic = session.mode === 'negentropy' && reason === 'ordered_catchup_active';
    const orderedCatchupHandoffPending = session.mode === 'ordered_catchup'
        && (reason === 'ordered_catchup_complete' || reason === 'ordered_catchup_done');
    if (session.mode === 'negentropy') {
        orderedCatchupTransitionPeers.delete(peerKey);
    }
    peerSessions.delete(peerKey);
    if (!orderedCatchupHandoffPending) {
        addAggregateSample(syncStats.syncDurationMs, Date.now() - session.startedAt);
    }
    const conn = connectionInfo[peerKey];
    if (conn && session.mode === 'negentropy') {
        conn.lastNegentropyAttemptAt = retryOnNextPeriodic ? 0 : Date.now();
        syncStats.negentropySessionsClosed += 1;
        if (reason === 'complete') {
            conn.negentropySynced = true;
            syncStats.negentropySessionsCompleted += 1;
        } else {
            conn.negentropySynced = false;
            syncStats.negentropySessionsFailed += 1;
        }
    } else if (conn && session.mode === 'ordered_catchup') {
        clearOrderedCatchupClientState(peerKey, session.sessionId, reason);
        if (!orderedCatchupHandoffPending) {
            syncStats.orderedCatchupSessionsFailed += 1;
        }
    }

    if (session.mode !== 'ordered_catchup') {
        maybeStartBackgroundPrebuild('session_closed');
        if (!retryOnNextPeriodic) {
            void maybeSchedulePreferredSyncs();
        }
    }

    log.debug({
        peer: shortName(peerKey),
        mode: session.mode,
        rounds: session.rounds,
        pendingHave: session.pendingHaveIds.size,
        pendingNeed: session.pendingNeedIds.size,
        unresolvedNeed: session.unresolvedNeedIds.size,
        reason,
    }, 'peer sync session closed');
}

function resetConnectionSyncStateAfterGatekeeperReset(conn: ConnectionInfo): void {
    conn.syncMode = 'unknown';
    conn.syncStarted = false;
    conn.lastNegentropyAttemptAt = 0;
    conn.negentropySynced = false;
    conn.orderedCatchupAttempted = false;
    conn.orderedCatchupClientSessionId = null;
    conn.orderedCatchupServerSessionId = null;
    conn.orderedCatchupServerLastActivity = 0;
    conn.orderedCatchupServerPendingSince = 0;
    conn.orderedCatchupServerPendingUntil = 0;
    conn.orderedCatchupServerPendingReason = null;
    conn.orderedCatchupServerPendingGap = 0;
}

function resetRuntimeSyncStateAfterGatekeeperReset(sync: BootstrapResult): void {
    const activeSessions = peerSessions.size;
    const connectedPeers = Object.keys(connectionInfo).length;

    peerSessions.clear();
    orderedCatchupTransitionPeers.clear();
    pendingSyncRecords.clear();
    terminalOperationCids.clear();
    invalidateNegentropyAdapterCache();

    for (const conn of Object.values(connectionInfo)) {
        resetConnectionSyncStateAfterGatekeeperReset(conn);
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
            connectedPeers,
        },
        'gatekeeper reset detected; hyperswarm runtime sync state reset'
    );
}

async function maybeRestartPeerSyncsAfterGatekeeperReset(): Promise<void> {
    for (const peerKey of Object.keys(connectionInfo)) {
        await maybeStartPeerSync(peerKey, 'connect');
        if (getActiveNegentropySessions() > 0) {
            return;
        }
    }

    await maybeSchedulePreferredSyncs();
}

function expireIdlePeerSessions(): void {
    const now = Date.now();
    for (const [peerKey, session] of peerSessions.entries()) {
        if (now - session.lastActivity > NEG_SESSION_IDLE_TIMEOUT_MS) {
            if (session.mode === 'negentropy') {
                sendNegClose(peerKey, session, 'idle_timeout');
            }
            closePeerSession(peerKey, 'idle_timeout');
        }
    }

    for (const [peerKey, conn] of Object.entries(connectionInfo)) {
        clearExpiredOrderedCatchupServerExpectation(peerKey, now);
        if (conn.orderedCatchupServerSessionId
            && conn.orderedCatchupServerLastActivity > 0
            && (now - conn.orderedCatchupServerLastActivity) > NEG_SESSION_IDLE_TIMEOUT_MS) {
            clearOrderedCatchupServerState(
                peerKey,
                conn.orderedCatchupServerSessionId,
                'server_idle_timeout',
            );
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
        config.negentropyEnabled,
        conn.peerTransportFramingVersion === TRANSPORT_FRAMING_VERSION,
    );
}

function supportsPeerNegentropyTransport(conn: ConnectionInfo): boolean {
    return supportsPeerNegentropy(conn.capabilities, NEGENTROPY_VERSION)
        && conn.peerTransportFramingVersion === TRANSPORT_FRAMING_VERSION;
}

function hasActiveOrderedCatchupForPeer(conn: ConnectionInfo): boolean {
    return hasActiveOrderedCatchupSession({
        orderedCatchupClientSessionId: conn.orderedCatchupClientSessionId,
        orderedCatchupServerSessionId: conn.orderedCatchupServerSessionId,
    });
}

function hasPendingOrderedCatchupServerExpectation(conn: ConnectionInfo, now = Date.now()): boolean {
    return conn.orderedCatchupServerPendingUntil > now;
}

function hasOrderedCatchupOutboundGuardForPeer(conn: ConnectionInfo, now = Date.now()): boolean {
    return hasActiveOrderedCatchupForPeer(conn) || hasPendingOrderedCatchupServerExpectation(conn, now);
}

function getActiveOrderedCatchupSessionId(conn: ConnectionInfo, session?: PeerSyncSession): string | null {
    if (session?.mode === 'ordered_catchup') {
        return session.sessionId;
    }

    return conn.orderedCatchupClientSessionId ?? conn.orderedCatchupServerSessionId;
}

function setOrderedCatchupServerExpectation(peerKey: string, reason: string, gap: number): void {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    const now = Date.now();
    if (hasPendingOrderedCatchupServerExpectation(conn, now)) {
        return;
    }

    conn.orderedCatchupServerPendingSince = now;
    conn.orderedCatchupServerPendingUntil = now + ORDERED_CATCHUP_SERVER_EXPECTATION_MS;
    conn.orderedCatchupServerPendingReason = reason;
    conn.orderedCatchupServerPendingGap = gap;
    log.info(
        {
            peer: shortName(peerKey),
            reason,
            gap,
            pendingMs: ORDERED_CATCHUP_SERVER_EXPECTATION_MS,
            pendingUntil: new Date(conn.orderedCatchupServerPendingUntil).toISOString(),
        },
        'ordered catch-up server request expected'
    );
}

function clearOrderedCatchupServerExpectation(peerKey: string, reason: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.orderedCatchupServerPendingUntil <= 0) {
        return;
    }

    const previous = {
        pendingSince: conn.orderedCatchupServerPendingSince,
        pendingUntil: conn.orderedCatchupServerPendingUntil,
        pendingReason: conn.orderedCatchupServerPendingReason,
        pendingGap: conn.orderedCatchupServerPendingGap,
    };

    conn.orderedCatchupServerPendingSince = 0;
    conn.orderedCatchupServerPendingUntil = 0;
    conn.orderedCatchupServerPendingReason = null;
    conn.orderedCatchupServerPendingGap = 0;
    log.debug(
        {
            peer: shortName(peerKey),
            reason,
            ...previous,
        },
        'ordered catch-up server request expectation cleared'
    );
}

function clearExpiredOrderedCatchupServerExpectation(peerKey: string, now = Date.now()): boolean {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.orderedCatchupServerPendingUntil <= 0 || conn.orderedCatchupServerPendingUntil > now) {
        return false;
    }

    clearOrderedCatchupServerExpectation(peerKey, 'server_expectation_timeout');
    return true;
}

function setOrderedCatchupClientState(peerKey: string, sessionId: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.orderedCatchupClientSessionId === sessionId) {
        return;
    }

    const previousSessionId = conn.orderedCatchupClientSessionId;
    conn.orderedCatchupClientSessionId = sessionId;
    log.debug({
        peer: shortName(peerKey),
        previousSessionId,
        sessionId,
    }, 'ordered catch-up client state set');
}

function clearOrderedCatchupClientState(peerKey: string, sessionId: string, reason: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.orderedCatchupClientSessionId !== sessionId) {
        return;
    }

    conn.orderedCatchupClientSessionId = null;
    log.debug({
        peer: shortName(peerKey),
        sessionId,
        reason,
    }, 'ordered catch-up client state cleared');
}

function setOrderedCatchupServerState(peerKey: string, sessionId: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    clearOrderedCatchupServerExpectation(peerKey, 'ordered_catchup_server_state_set');
    const previousSessionId = conn.orderedCatchupServerSessionId;
    conn.orderedCatchupServerSessionId = sessionId;
    conn.orderedCatchupServerLastActivity = Date.now();
    if (previousSessionId !== sessionId) {
        log.debug({
            peer: shortName(peerKey),
            previousSessionId,
            sessionId,
        }, 'ordered catch-up server state set');
    }
}

function clearOrderedCatchupServerState(peerKey: string, sessionId: string, reason: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.orderedCatchupServerSessionId !== sessionId) {
        return;
    }

    conn.orderedCatchupServerSessionId = null;
    conn.orderedCatchupServerLastActivity = 0;
    log.debug({
        peer: shortName(peerKey),
        sessionId,
        reason,
    }, 'ordered catch-up server state cleared');
}

function logNegentropySuppressedByOrderedCatchup(
    peerKey: string,
    source: 'connect' | 'periodic' | 'ordered_catchup_complete',
): void {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    log.debug({
        peer: shortName(peerKey),
        source,
        orderedCatchupClientSessionId: conn.orderedCatchupClientSessionId,
        orderedCatchupServerSessionId: conn.orderedCatchupServerSessionId,
        orderedCatchupServerPendingUntil: conn.orderedCatchupServerPendingUntil,
        orderedCatchupServerPendingReason: conn.orderedCatchupServerPendingReason,
        orderedCatchupServerPendingGap: conn.orderedCatchupServerPendingGap,
    }, 'outbound negentropy suppressed while ordered catch-up is active or expected');
}

function buildPeerSyncCompatibilityContext(peerKey: string, conn: ConnectionInfo): object {
    return {
        peer: shortName(peerKey),
        node: conn.nodeName || 'anon',
        capabilities: conn.capabilities,
        peerTransportFramingVersion: conn.peerTransportFramingVersion,
        requiredNegentropyVersion: NEGENTROPY_VERSION,
        requiredTransportFramingVersion: TRANSPORT_FRAMING_VERSION,
        negentropyEnabled: config.negentropyEnabled,
        orderedCatchupEnabled: config.orderedCatchupEnabled,
    };
}

function incrementNoModeReason(reason: ConnectSyncModeReason | null): void {
    syncStats.modeSelectionsNoMode += 1;
    if (reason === 'missing_capabilities') {
        syncStats.modeSelectionsNoModeMissingCapabilities += 1;
    }
    if (reason === 'negentropy_disabled') {
        syncStats.modeSelectionsNoModeNegentropyDisabled += 1;
    }
    if (reason === 'version_mismatch') {
        syncStats.modeSelectionsNoModeVersionMismatch += 1;
    }
    if (reason === 'transport_framing_unsupported') {
        syncStats.modeSelectionsNoModeTransportFramingUnsupported += 1;
    }
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

function hasActiveOutboundOrderedCatchup(): boolean {
    if (orderedCatchupTransitionPeers.size > 0) {
        return true;
    }

    for (const session of peerSessions.values()) {
        if (session.mode === 'ordered_catchup' && session.initiator) {
            return true;
        }
    }

    return false;
}

async function maybeSchedulePreferredSyncs(): Promise<void> {
    if (getActiveNegentropySessions() === 0) {
        for (const peerKey in connectionInfo) {
            await maybeStartPeerSync(peerKey, 'periodic');
            if (getActiveNegentropySessions() > 0) {
                return;
            }
        }
    }
}

async function startNegentropySessionForPeer(
    peerKey: string,
    source: 'connect' | 'periodic' | 'ordered_catchup_complete',
    modeReason: ConnectSyncModeReason | 'ordered_catchup_complete' | null = null,
    initiatorOverride?: boolean,
): Promise<boolean> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return false;
    }

    clearExpiredOrderedCatchupServerExpectation(peerKey);
    if (hasOrderedCatchupOutboundGuardForPeer(conn)) {
        logNegentropySuppressedByOrderedCatchup(peerKey, source);
        return false;
    }

    if (conn.negentropySynced || peerSessions.has(peerKey) || getActiveNegentropySessions() > 0) {
        return false;
    }

    const initiator = initiatorOverride ?? nodeKey.localeCompare(peerKey) < 0;
    const session = createPeerSession(peerKey, 'negentropy', initiator);
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
                modeReason,
                initiator,
                sessionId: session.sessionId,
                source,
                plannedWindows: session.windows.length,
            },
            'peer sync mode selected'
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

async function startOrderedCatchupSessionForPeer(
    peerKey: string,
    decisionReason: string,
    gap: number,
): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    if (conn.negentropySynced
        || peerSessions.has(peerKey)
        || getActiveNegentropySessions() > 0
        || hasActiveOutboundOrderedCatchup()
        || importQueue.length() > 0
        || importQueue.running() > 0) {
        return;
    }

    conn.orderedCatchupAttempted = true;
    const session = createPeerSession(peerKey, 'ordered_catchup', true);
    setOrderedCatchupClientState(peerKey, session.sessionId);
    log.info(
        {
            peer: shortName(peerKey),
            mode: 'ordered_catchup',
            sessionId: session.sessionId,
            reason: decisionReason,
            gap,
        },
        'peer ordered catch-up selected'
    );

    if (!sendOrderedCatchupReq(peerKey, session)) {
        closePeerSession(peerKey, 'send_ordered_catchup_req_failed');
    }
}

async function maybeStartPeerSync(peerKey: string, source: 'connect' | 'periodic' = 'connect'): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
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
        conn.syncMode = mode ?? 'unknown';
        if (conn.syncStarted) {
            return;
        }
        syncStats.modeSelectionsTotal += 1;
    } else {
        mode = conn.syncMode;
    }

    if (!mode || mode === 'unknown') {
        if (source === 'connect') {
            incrementNoModeReason(modeReason);
            log.info(
                {
                    ...buildPeerSyncCompatibilityContext(peerKey, conn),
                    modeReason,
                    source,
                },
                'peer sync mode unavailable'
            );
        }
        return;
    }

    if (hasActiveOutboundOrderedCatchup()) {
        logNegentropySuppressedByOrderedCatchup(peerKey, source);
        return;
    }

    if (source === 'connect') {
        syncStats.modeSelectionsNegentropy += 1;
    }

    if (outboundSyncStartInProgress || importQueue.length() > 0 || importQueue.running() > 0) {
        return;
    }

    outboundSyncStartInProgress = true;
    try {
        const initiator = nodeKey.localeCompare(peerKey) < 0;
        const hasActiveSession = peerSessions.has(peerKey);
        const activeNegentropySessions = getActiveNegentropySessions();
        clearExpiredOrderedCatchupServerExpectation(peerKey);
        let orderedCatchupActive = hasOrderedCatchupOutboundGuardForPeer(conn);

        conn.syncStarted = true;

        if (conn.negentropySynced) {
            return;
        }

        const localOperationCount = await syncStore.count();
        if (connectionInfo[peerKey] !== conn) {
            return;
        }
        const orderedCatchupDecision = getOrderedCatchupDecision({
            enabled: config.orderedCatchupEnabled && !conn.orderedCatchupAttempted,
            localOperationCount,
            peerCapabilities: conn.capabilities,
            requiredVersion: ORDERED_CATCHUP_VERSION,
            windowSize: config.negentropyMaxRecordsPerWindow,
        });
        if (orderedCatchupDecision.useOrderedCatchup && !hasActiveSession && activeNegentropySessions === 0) {
            await startOrderedCatchupSessionForPeer(
                peerKey,
                orderedCatchupDecision.reason,
                orderedCatchupDecision.gap,
            );
            return;
        }

        if (source === 'connect'
            && initiator
            && !orderedCatchupActive
            && !hasActiveSession
            && activeNegentropySessions === 0) {
            const localOrderedOperationCount = await syncStore.countOrdered();
            if (connectionInfo[peerKey] !== conn) {
                return;
            }
            const expectedOrderedCatchupRequest = getExpectedOrderedCatchupRequestDecision({
                enabled: config.orderedCatchupEnabled,
                localOperationCount,
                localOrderedOperationCount,
                peerCapabilities: conn.capabilities,
                requiredVersion: ORDERED_CATCHUP_VERSION,
                windowSize: config.negentropyMaxRecordsPerWindow,
            });

            if (expectedOrderedCatchupRequest.expectRequest) {
                setOrderedCatchupServerExpectation(
                    peerKey,
                    expectedOrderedCatchupRequest.reason,
                    expectedOrderedCatchupRequest.gap,
                );
                orderedCatchupActive = hasOrderedCatchupOutboundGuardForPeer(conn);
            }
        }

        const shouldStart = source === 'connect'
            ? shouldStartConnectTimeNegentropy(mode, hasActiveSession, initiator, orderedCatchupActive)
            : shouldSchedulePeriodicRepair({
                syncMode: mode,
                hasActiveSession,
                orderedCatchupActive,
                importQueueLength: importQueue.length(),
                importQueueRunning: importQueue.running(),
                activeNegentropySessions,
                lastAttemptAtMs: conn.lastNegentropyAttemptAt,
                nowMs: Date.now(),
                repairIntervalMs: NEG_REPAIR_INTERVAL_MS,
                isInitiator: initiator,
                syncCompleted: conn.negentropySynced,
            });

        if (!shouldStart) {
            if (orderedCatchupActive) {
                logNegentropySuppressedByOrderedCatchup(peerKey, source);
            }
            return;
        }

        if (activeNegentropySessions > 0) {
            return;
        }

        if (connectionInfo[peerKey] !== conn) {
            return;
        }
        await startNegentropySessionForPeer(peerKey, source, modeReason);
    }
    finally {
        outboundSyncStartInProgress = false;
    }
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
    return finished;
}

async function buildInitialHistoryWindowForSession(): Promise<ReconciliationWindow> {
    if (!negentropyAdapter) {
        throw new Error('negentropy adapter unavailable');
    }

    return buildInitialHistoryWindow(
        MDIP_EPOCH_SECONDS,
        currentSyncTimestampSeconds(),
        config.negentropyMaxRecordsPerWindow,
    );
}

function maybeStartBackgroundPrebuild(reason: string): void {
    if (!negentropyAdapter) {
        return;
    }

    if (!isNegentropyAdapterDirty()) {
        return;
    }

    if (hasActiveOutboundOrderedCatchup()) {
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
    (async () => {
        const window = await buildInitialHistoryWindowForSession();
        await ensureWindowAdapterFresh(window, `background_${reason}`);
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

async function ensureWindowAdapterFresh(window: ReconciliationWindow, reason: string): Promise<NegentropyWindowSnapshot> {
    if (!negentropyAdapter) {
        throw new Error('negentropy adapter unavailable');
    }

    const targetWindowId = makeWindowId(window);
    const now = Date.now();
    const recentlyBuilt = adapterBuiltAt > 0 && (now - adapterBuiltAt) <= NEG_ADAPTER_MAX_AGE_MS;
    const sameWindow = adapterBuiltWindowId === targetWindowId;

    if (!isNegentropyAdapterDirty() && recentlyBuilt && sameWindow) {
        const cached = cloneWindowSnapshot(adapterBuiltSnapshot);
        if (cached) {
            return cached;
        }
    }

    if (rebuildPromise) {
        await rebuildPromise;
        const recentAfterWait = adapterBuiltAt > 0 && (Date.now() - adapterBuiltAt) <= NEG_ADAPTER_MAX_AGE_MS;
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
        ...createBaseMessage('neg_open'),
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
    const rows: SyncOperationRecord[] = [];

    for (const idBatch of idLookupBatches) {
        const batchRows = await syncStore.getByIds(idBatch);
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

function sendOrderedCatchupDone(peerKey: string, sessionId: string): boolean {
    const msg: OrderedCatchupDoneMessage = {
        ...createBaseMessage('ordered_catchup_done'),
        sessionId,
    };

    const sent = sendToPeer(peerKey, msg);
    clearOrderedCatchupServerState(peerKey, sessionId, sent ? 'ordered_catchup_done_sent' : 'send_ordered_catchup_done_failed');
    return sent;
}

function sendOrderedCatchupReq(peerKey: string, session: PeerSyncSession): boolean {
    const msg: OrderedCatchupReqMessage = {
        ...createBaseMessage('ordered_catchup_req'),
        sessionId: session.sessionId,
        cursor: session.orderedCatchupCursor ?? undefined,
    };

    const sent = sendToPeer(peerKey, msg);
    if (sent) {
        session.orderedCatchupRequestOutstanding = true;
    }
    return sent;
}

function refillOrderedCatchupPrefetch(peerKey: string, session: PeerSyncSession): boolean {
    if (peerSessions.get(peerKey) !== session
        || session.orderedCatchupTerminalReason
        || session.orderedCatchupRequestOutstanding
        || session.orderedCatchupPendingImports > ORDERED_CATCHUP_PREFETCH_BATCHES) {
        return true;
    }

    return sendOrderedCatchupReq(peerKey, session);
}

async function sendOrderedCatchupPage(peerKey: string, msg: OrderedCatchupReqMessage): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    clearOrderedCatchupServerExpectation(peerKey, 'ordered_catchup_req_received');

    if (conn.capabilities.orderedCatchup !== true || conn.capabilities.orderedCatchupVersion !== ORDERED_CATCHUP_VERSION) {
        log.warn(
            {
                peer: shortName(peerKey),
                sessionId: msg.sessionId,
                peerOrderedCatchup: conn.capabilities.orderedCatchup,
                peerOrderedCatchupVersion: conn.capabilities.orderedCatchupVersion,
            },
            'ignoring ordered catch-up request from unsupported peer'
        );
        return;
    }

    if (!config.orderedCatchupEnabled) {
        sendOrderedCatchupDone(peerKey, msg.sessionId);
        return;
    }

    const cursor = parseOrderedCatchupCursor(msg.cursor);
    if (cursor === null) {
        log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ordered catch-up request with invalid cursor');
        return;
    }

    const continuingSession = conn.orderedCatchupServerSessionId === msg.sessionId;
    if (!continuingSession) {
        const status = await getLocalOrderedCatchupStatus();
        if (connectionInfo[peerKey] !== conn) {
            return;
        }
        if (!status.ready) {
            log.info(
                {
                    peer: shortName(peerKey),
                    sessionId: msg.sessionId,
                    operationCount: status.operationCount,
                    orderedOperationCount: status.orderedOperationCount,
                },
                'ordered catch-up requested but local store is not ready'
            );
            sendOrderedCatchupDone(peerKey, msg.sessionId);
            return;
        }
    }

    setOrderedCatchupServerState(peerKey, msg.sessionId);

    const rows = await syncStore.iterateOrdered({
        after: cursor,
        limit: NEG_MAX_OPS_PER_PUSH + 1,
    });
    if (connectionInfo[peerKey] !== conn) {
        return;
    }
    const candidateRows = rows.slice(0, NEG_MAX_OPS_PER_PUSH);
    const [opBatch = []] = chunkOperationsForPush(candidateRows.map(row => row.operation), {
        maxOpsPerPush: NEG_MAX_OPS_PER_PUSH,
        maxBytesPerPush: NEG_MAX_BYTES_PER_PUSH,
    });
    const pageRows = candidateRows.slice(0, opBatch.length);
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = lastRow ? getOrderedCursorFromRow(lastRow) : null;

    if (pageRows.length === 0 || !nextCursor) {
        sendOrderedCatchupDone(peerKey, msg.sessionId);
        return;
    }

    const push: OrderedCatchupPushMessage = {
        ...createBaseMessage('ordered_catchup_push'),
        sessionId: msg.sessionId,
        cursor: nextCursor,
        hasMore: rows.length > pageRows.length,
        data: opBatch,
    };

    if (!sendToPeer(peerKey, push)) {
        clearOrderedCatchupServerState(peerKey, msg.sessionId, 'send_ordered_catchup_push_failed');
        return;
    }

    syncStats.orderedCatchupPagesSent += 1;
    syncStats.orderedCatchupOpsSent += push.data.length;

    if (!push.hasMore) {
        clearOrderedCatchupServerState(peerKey, msg.sessionId, 'ordered_catchup_final_page_sent');
    }
}

function completeOrderedCatchup(peerKey: string, session: PeerSyncSession, reason: string): void {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    conn.orderedCatchupAttempted = true;
    session.reconciliationComplete = true;
    closePeerSession(peerKey, reason);
    queueOrderedCatchupPostImport(peerKey, reason, session.startedAt);
}

function maybeCompleteOrderedCatchup(peerKey: string, session: PeerSyncSession): void {
    if (peerSessions.get(peerKey) !== session
        || session.orderedCatchupPendingImports > 0
        || !session.orderedCatchupTerminalReason) {
        return;
    }

    completeOrderedCatchup(peerKey, session, session.orderedCatchupTerminalReason);
}

function settleOrderedCatchupImport(
    peerKey: string,
    session: PeerSyncSession,
    retryable: boolean,
): void {
    session.orderedCatchupPendingImports = Math.max(0, session.orderedCatchupPendingImports - 1);
    if (retryable) {
        session.orderedCatchupImportsAborted = true;
    }
    if (peerSessions.get(peerKey) !== session) {
        return;
    }

    if (retryable) {
        closePeerSession(peerKey, 'ordered_catchup_import_retryable');
        return;
    }

    touchPeerSession(peerKey);
    if (!refillOrderedCatchupPrefetch(peerKey, session)) {
        closePeerSession(peerKey, 'send_ordered_catchup_req_failed');
        return;
    }
    maybeCompleteOrderedCatchup(peerKey, session);
}

function queueOrderedCatchupImport(peerKey: string, session: PeerSyncSession, batch: Operation[]): void {
    session.orderedCatchupPendingImports += 1;
    importQueue.push<ImportQueueResult>({
        name: peerKey,
        data: batch,
        orderedCatchupSession: session,
    }, (error, imported) => {
        try {
            if (error || !imported) {
                if (error) {
                    log.error({ error, peer: shortName(peerKey), sessionId: session.sessionId }, 'ordered catch-up import failed');
                }
                settleOrderedCatchupImport(peerKey, session, true);
                return;
            }
            settleOrderedCatchupImport(peerKey, session, imported.retryable);
        }
        catch (completionError) {
            log.error(
                { error: completionError, peer: shortName(peerKey), sessionId: session.sessionId },
                'ordered catch-up import completion failed'
            );
        }
    });
}

async function waitForImportQueueIdle(reason: string): Promise<void> {
    while (importQueue.length() > 0 || importQueue.running() > 0) {
        log.debug(
            {
                reason,
                queued: importQueue.length(),
                running: importQueue.running(),
            },
            'waiting for import queue to drain'
        );
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

function queueOrderedCatchupPostImport(peerKey: string, reason: string, startedAt: number): void {
    if (orderedCatchupTransitionPeers.has(peerKey)) {
        log.debug({ peer: shortName(peerKey), reason }, 'ordered catch-up post-import continuation already queued');
        return;
    }

    orderedCatchupTransitionPeers.add(peerKey);
    (async () => {
        let handoffStarted = false;
        let postImportCompleted = false;
        try {
            await waitForImportQueueIdle('ordered_catchup_complete');
            await syncGatekeeperIndexToStore('ordered_catchup_complete');
            postImportCompleted = true;
            const durationMs = Date.now() - startedAt;
            syncStats.orderedCatchupSessionsCompleted += 1;
            addAggregateSample(syncStats.syncDurationMs, durationMs);
            log.debug({ peer: shortName(peerKey), reason, durationMs }, 'ordered catch-up handoff ready');
            markNegentropyAdapterDirty();
            handoffStarted = await maybeStartPostOrderedCatchupNegentropy(peerKey, reason);
        }
        catch (error) {
            if (!postImportCompleted) {
                syncStats.orderedCatchupSessionsFailed += 1;
                addAggregateSample(syncStats.syncDurationMs, Date.now() - startedAt);
            }
            log.error({ error, peer: shortName(peerKey), reason }, 'ordered catch-up post-import continuation failed');
        }
        finally {
            if (!handoffStarted) {
                orderedCatchupTransitionPeers.delete(peerKey);
            }
        }

        if (postImportCompleted && !handoffStarted && getActiveNegentropySessions() === 0) {
            await maybeSchedulePreferredSyncs();
        }
    })().catch(error => {
        log.error({ error, peer: shortName(peerKey), reason }, 'ordered catch-up post-import scheduling failed');
    });
}

async function maybeStartPostOrderedCatchupNegentropy(peerKey: string, reason: string): Promise<boolean> {
    const conn = connectionInfo[peerKey];
    const shouldStart = shouldStartPostOrderedCatchupNegentropy({
        syncMode: conn?.syncMode ?? 'unknown',
        peerConnected: !!conn,
        peerSupportsNegentropyTransport: conn ? supportsPeerNegentropyTransport(conn) : false,
        hasActiveSession: peerSessions.has(peerKey),
        importQueueLength: importQueue.length(),
        importQueueRunning: importQueue.running(),
        activeNegentropySessions: getActiveNegentropySessions(),
        syncCompleted: conn?.negentropySynced ?? false,
    });

    if (shouldStart) {
        return startNegentropySessionForPeer(
            peerKey,
            'ordered_catchup_complete',
            'ordered_catchup_complete',
            true,
        );
    } else {
        log.debug(
            {
                peer: shortName(peerKey),
                reason,
                syncMode: conn?.syncMode ?? 'unknown',
                peerConnected: !!conn,
                peerSupportsNegentropyTransport: conn ? supportsPeerNegentropyTransport(conn) : false,
                hasActiveSession: peerSessions.has(peerKey),
                importQueueLength: importQueue.length(),
                importQueueRunning: importQueue.running(),
                activeNegentropySessions: getActiveNegentropySessions(),
                syncCompleted: conn?.negentropySynced ?? false,
            },
            'post ordered catch-up negentropy handoff deferred'
        );
    }

    return false;
}

async function handleOrderedCatchupPush(peerKey: string, msg: OrderedCatchupPushMessage): Promise<void> {
    const conn = connectionInfo[peerKey];
    const session = peerSessions.get(peerKey);
    if (!conn || !session || session.mode !== 'ordered_catchup' || session.sessionId !== msg.sessionId) {
        log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ordered catch-up push for unknown session');
        return;
    }
    if (session.orderedCatchupTerminalReason) {
        log.debug({
            peer: shortName(peerKey),
            sessionId: msg.sessionId,
            terminalReason: session.orderedCatchupTerminalReason,
        }, 'ignoring ordered catch-up push after terminal message');
        return;
    }
    if (!session.orderedCatchupRequestOutstanding
        && session.orderedCatchupPendingImports > ORDERED_CATCHUP_PREFETCH_BATCHES) {
        log.warn({
            peer: shortName(peerKey),
            sessionId: msg.sessionId,
            pendingImports: session.orderedCatchupPendingImports,
        }, 'closing ordered catch-up session after unsolicited prefetched push');
        closePeerSession(peerKey, 'ordered_catchup_prefetch_overflow');
        return;
    }

    const cursor = parseOrderedCatchupCursor(msg.cursor);
    if (cursor === null || cursor === undefined) {
        log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ordered catch-up push with invalid cursor');
        closePeerSession(peerKey, 'invalid_ordered_catchup_cursor');
        return;
    }

    if (session.orderedCatchupCursor && !isOrderedCursorAfter(cursor, session.orderedCatchupCursor)) {
        log.warn({
            peer: shortName(peerKey),
            sessionId: msg.sessionId,
            previousCursor: session.orderedCatchupCursor,
            cursor,
        }, 'ignoring ordered catch-up push with non-advancing cursor');
        closePeerSession(peerKey, 'non_advancing_ordered_catchup_cursor');
        return;
    }

    session.orderedCatchupRequestOutstanding = false;
    const batch = normalizeInboundOpsPushBatch(msg.data);
    syncStats.orderedCatchupPagesReceived += 1;
    syncStats.orderedCatchupOpsReceived += batch.length;
    touchPeerSession(peerKey);
    session.orderedCatchupCursor = cursor;
    if (batch.length > 0) {
        queueOrderedCatchupImport(peerKey, session, batch);
    }

    if (msg.hasMore === true) {
        if (!refillOrderedCatchupPrefetch(peerKey, session)) {
            closePeerSession(peerKey, 'send_ordered_catchup_req_failed');
        }
        return;
    }

    session.orderedCatchupTerminalReason = 'ordered_catchup_complete';
    maybeCompleteOrderedCatchup(peerKey, session);
}

async function handleOrderedCatchupDone(peerKey: string, msg: OrderedCatchupDoneMessage): Promise<void> {
    const session = peerSessions.get(peerKey);
    if (!session || session.mode !== 'ordered_catchup' || session.sessionId !== msg.sessionId) {
        log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ordered catch-up done for unknown session');
        return;
    }

    session.orderedCatchupRequestOutstanding = false;
    session.orderedCatchupTerminalReason = 'ordered_catchup_done';
    touchPeerSession(peerKey);
    maybeCompleteOrderedCatchup(peerKey, session);
}

function sendNegMsg(peerKey: string, session: PeerSyncSession, frame: string | Uint8Array): boolean {
    const msg: NegMsgMessage = {
        ...createBaseMessage('neg_msg'),
        sessionId: session.sessionId,
        windowId: getExpectedWindowId(session),
        round: session.rounds,
        frame: encodeNegentropyFrame(frame),
        windowProgress: buildWindowProgress(session),
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
        windowProgress: buildWindowProgress(session),
    };

    return sendToPeer(peerKey, closeMsg);
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
        for (const ids of chunkIds(Array.from(session.unresolvedNeedIds), NEG_MAX_IDS_PER_LOOKUP)) {
            const rows = await syncStore.getByIds(ids);
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

async function collectTerminalUnresolvedOperations(session: PeerSyncSession): Promise<Operation[]> {
    const operationsByPrevid = new Map<string, Array<{ id: string; operation: Operation }>>();
    const selected = new Map<string, Operation>();
    const queuedCids = new Set<string>();
    const cidQueue: string[] = [];

    const queueCid = (cid: string): void => {
        if (!queuedCids.has(cid)) {
            queuedCids.add(cid);
            cidQueue.push(cid);
        }
    };

    for (const cid of terminalOperationCids) {
        queueCid(cid);
    }

    for (const [id, operation] of session.unresolvedOperations) {
        if (!session.unresolvedNeedIds.has(id)
            || !hasContentVerifiedOperationId(operation, cipher)) {
            continue;
        }

        if (operation.type !== 'create' && operation.previd === undefined) {
            selected.set(id, operation);
            try {
                queueCid(await generateOperationCid(operation));
            }
            catch (error) {
                log.warn({ error, id }, 'failed to derive terminal legacy operation CID');
            }
            continue;
        }

        if (typeof operation.previd !== 'string') {
            continue;
        }

        const children = operationsByPrevid.get(operation.previd) ?? [];
        children.push({ id, operation });
        operationsByPrevid.set(operation.previd, children);
    }

    let queueIndex = 0;
    while (queueIndex < cidQueue.length) {
        const cid = cidQueue[queueIndex++];
        for (const child of operationsByPrevid.get(cid) ?? []) {
            if (selected.has(child.id)) {
                continue;
            }

            selected.set(child.id, child.operation);
            try {
                queueCid(await generateOperationCid(child.operation));
            }
            catch (error) {
                log.warn({ error, id: child.id }, 'failed to derive terminal fork descendant CID');
            }
        }
    }

    return Array.from(selected.values());
}

// Store pre-0.5 operations without previd and descendants of terminal modern forks
// until restart so completed reconciliation does not retry permanently losing history.
async function persistTerminalUnresolvedOperations(peerKey: string, session: PeerSyncSession): Promise<void> {
    if (peerSessions.get(peerKey) !== session || session.unresolvedNeedIds.size === 0) {
        return;
    }

    const operations = await collectTerminalUnresolvedOperations(session);
    if (peerSessions.get(peerKey) !== session || operations.length === 0) {
        return;
    }

    try {
        const persistedIds = await persistProcessedOperations(
            [],
            operations,
            'negentropy_terminal_unresolved',
        );
        if (peerSessions.get(peerKey) !== session) {
            return;
        }
        for (const id of persistedIds) {
            session.provenStoredPushIds.add(id);
            session.pendingNeedIds.delete(id);
            session.unresolvedNeedIds.delete(id);
            session.unresolvedOperations.delete(id);
        }
    }
    catch (error) {
        log.warn(
            { error, peer: shortName(peerKey), operations: operations.length },
            'failed to persist terminal unresolved operations'
        );
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
    syncStats.negentropyRounds += 1;
    syncStats.negentropyHaveIds += outcome.haveIds.length;
    syncStats.negentropyNeedIds += outcome.needIds.length;

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

async function relayMsg(msg: HyperMessage): Promise<void> {
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
            if (sendToPeer(peerKey, msg)) {
                log.debug(`* relaying to: ${conn.peerName} (${conn.nodeName}) ${lastSeen} *`);
            } else {
                log.debug(`* deferring relay to: ${conn.peerName} (${conn.nodeName}) ${lastSeen} *`);
            }
        }
        else {
            log.debug(`* skipping relay to: ${conn.peerName} (${conn.nodeName}) ${lastSeen} *`);
        }
    }
}

async function importBatch(batch: Operation[]) {
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

        return partitionImportBatchOperations(batch, response.rejectedIndices);
    }
    catch (error) {
        log.error({ error }, 'importBatch error');
        throw error;
    }
}

async function recordTerminalOperationCids(operations: Operation[], source: string): Promise<void> {
    for (const operation of operations) {
        try {
            terminalOperationCids.add(await generateOperationCid(operation));
        }
        catch (error) {
            log.warn({ error, source }, 'failed to record terminal operation CID');
        }
    }
}

async function persistProcessedOperations(
    acceptedOperations: Operation[],
    rejectedOperations: Operation[],
    source: string,
    retryIds: Iterable<string> = [],
): Promise<string[]> {
    const accepted = mapAcceptedOperationsToSyncRecords(acceptedOperations);
    const verifiedRejectedOperations = rejectedOperations.filter(
        operation => hasContentVerifiedOperationId(operation, cipher)
    );
    const rejectedHashMismatches = rejectedOperations.length - verifiedRejectedOperations.length;
    const rejected = mapAcceptedOperationsToSyncRecords(verifiedRejectedOperations.map(operation => ({
        operation,
        syncOrder: TERMINAL_REJECTED_SYNC_ORDER,
    })));
    if (rejectedHashMismatches > 0) {
        log.warn(
            { source, rejectedHashMismatches },
            'skipping terminal sync records with unverified operation IDs'
        );
    }
    const records = [...rejected.records, ...accepted.records];
    const invalid = accepted.invalid + rejected.invalid;
    const operationCount = acceptedOperations.length + rejectedOperations.length;
    const recordsToPersist = new Map<string, SyncOperationWriteRecord>();
    for (const record of records) {
        pendingSyncRecords.delete(record.id);
        pendingSyncRecords.set(record.id, record);
        recordsToPersist.set(record.id, record);
    }

    let retryCandidates = 0;
    for (const id of new Set(retryIds)) {
        const pending = pendingSyncRecords.get(id);
        if (!pending || recordsToPersist.has(id)) {
            continue;
        }
        retryCandidates += 1;
        recordsToPersist.set(id, pending);
    }

    const attemptedRecords = Array.from(recordsToPersist.values());
    if (attemptedRecords.length === 0) {
        log.debug({
            source,
            accepted: acceptedOperations.length,
            rejected: rejectedOperations.length,
            rejectedHashMismatches,
            attempted: operationCount,
            invalid,
        }, 'sync-store persist skipped');
        return [];
    }

    let result;
    try {
        result = await syncStore.upsertMany(attemptedRecords);
    }
    catch (error) {
        const pendingBeforeTrim = pendingSyncRecords.size;
        while (pendingSyncRecords.size > MAX_PENDING_SYNC_RECORDS) {
            const oldestId = pendingSyncRecords.keys().next().value;
            if (oldestId === undefined) {
                break;
            }
            pendingSyncRecords.delete(oldestId);
        }
        log.error(
            {
                error,
                source,
                accepted: acceptedOperations.length,
                rejected: rejectedOperations.length,
                rejectedHashMismatches,
                attempted: operationCount,
                mapped: records.length,
                retryCandidates,
                recordsAttempted: attemptedRecords.length,
                pending: pendingSyncRecords.size,
                pendingEvicted: pendingBeforeTrim - pendingSyncRecords.size,
            },
            'sync-store persist processed ops failed'
        );
        throw error;
    }

    for (const record of attemptedRecords) {
        if (pendingSyncRecords.get(record.id) === record) {
            pendingSyncRecords.delete(record.id);
        }
    }
    const terminalRecordIds = new Set(
        attemptedRecords
            .filter(record => record.syncOrder === TERMINAL_REJECTED_SYNC_ORDER)
            .map(record => record.id)
    );
    await recordTerminalOperationCids(
        verifiedRejectedOperations.filter(operation => {
            const mapped = mapOperationToSyncKey(operation);
            return mapped.ok && terminalRecordIds.has(mapped.value.idHex);
        }),
        source,
    );

    if (result.inserted > 0 || result.updated > 0) {
        markNegentropyAdapterDirty();
        maybeStartBackgroundPrebuild(`persist_${source}`);
    }
    log.debug(
        {
            source,
            accepted: acceptedOperations.length,
            rejected: rejectedOperations.length,
            rejectedHashMismatches,
            attempted: operationCount,
            mapped: records.length,
            retryCandidates,
            recordsAttempted: attemptedRecords.length,
            pendingRemaining: pendingSyncRecords.size,
            invalid,
            inserted: result.inserted,
            updated: result.updated,
        },
        'sync-store persist processed ops'
    );
    return attemptedRecords.map(record => record.id);
}

async function mergeBatch(batch: Operation[]): Promise<string[]> {

    if (!batch) {
        return [];
    }

    let chunk = [];
    const processCandidates: Operation[] = [];
    const structurallyRejected: Operation[] = [];

    for (const operation of batch) {
        chunk.push(operation);

        if (chunk.length >= BATCH_SIZE) {
            const imported = await importBatch(chunk);
            processCandidates.push(...imported.processCandidates);
            structurallyRejected.push(...imported.rejectedOperations);
            chunk = [];
        }
    }

    if (chunk.length > 0) {
        const imported = await importBatch(chunk);
        processCandidates.push(...imported.processCandidates);
        structurallyRejected.push(...imported.rejectedOperations);
    }

    const processStart = Date.now();
    const response = await gatekeeper.processEvents();
    const processDurationMs = Date.now() - processStart;
    log.debug({ durationMs: processDurationMs }, 'processEvents');
    if (response.busy) {
        throw new Error('gatekeeper processEvents busy');
    }
    const processSummary = { ...response };
    delete processSummary.acceptedHashes;
    delete processSummary.acceptedEvents;
    delete processSummary.rejectedOperations;
    log.debug(`mergeBatch: ${JSON.stringify(processSummary)}`);
    syncStats.opsApplied += (response.added ?? 0) + (response.merged ?? 0);
    syncStats.opsRejected += response.rejected ?? 0;

    const acceptedToPersist = resolveAcceptedOperationsToPersist(
        processCandidates,
        response.acceptedHashes,
        response.acceptedEvents,
    );
    const processRejected = dedupeOperationsByHash(response.rejectedOperations ?? []);
    const rejectedToPersist = dedupeOperationsByHash([
        ...structurallyRejected,
        ...processRejected,
    ]);
    const retryIds = new Set<string>();
    for (const operation of batch) {
        const mapped = mapOperationToSyncKey(operation);
        if (mapped.ok) {
            retryIds.add(mapped.value.idHex);
        }
    }
    return persistProcessedOperations(
        acceptedToPersist,
        rejectedToPersist,
        'mergeBatch',
        retryIds,
    );
}

let importQueue = asyncLib.queue<ImportQueueTask, ImportQueueResult>(
    async function (task): Promise<ImportQueueResult> {
        const { name, data: batch } = task;
        const result: ImportQueueResult = {
            knownIds: [],
            persistedIds: [],
            retryable: false,
        };
        if (task.orderedCatchupSession?.orderedCatchupImportsAborted) {
            return result;
        }
        try {
            const ready = await gatekeeper.isReady();

            if (!ready) {
                result.retryable = true;
                return result;
            }

            if (batch.length === 0) {
                return result;
            }

            if (task.queueGossip) {
                syncStats.queueOpsImported += batch.length;
                const samples = collectQueueDelaySamples(batch);
                for (const sample of samples) {
                    addAggregateSample(syncStats.queueDelayMs, sample);
                }
            }

            const filtered = await filterKnownOperations(batch, syncStore, NEG_MAX_OPS_PER_PUSH);
            result.knownIds = filtered.knownIds;
            if (filtered.known > 0) {
                log.debug(
                    {
                        peer: shortName(name),
                        node: task.node || 'anon',
                        received: batch.length,
                        forwarded: filtered.operations.length,
                        knownDropped: filtered.known,
                        mapped: filtered.mapped,
                        invalid: filtered.invalid,
                    },
                    'filtered inbound operations against sync-store'
                );
            }

            if (filtered.operations.length === 0) {
                return result;
            }

            const nodeName = task.node || 'anon';
            log.debug(
                `* merging batch (${filtered.operations.length}/${batch.length} events) from: ${shortName(name)} (${nodeName}) *`
            );
            result.persistedIds = await mergeBatch(filtered.operations);
        }
        catch (error) {
            result.retryable = true;
            log.error({ error }, 'mergeBatch error');
        }
        return result;
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

function queueInboundPeerData(peerKey: string, chunk: Buffer | string): void {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    conn.inboundReceiveChain = conn.inboundReceiveChain
        .then(() => processInboundPeerData(peerKey, incoming))
        .catch(error => {
            log.error({ error, peer: shortName(peerKey) }, 'inbound hyperswarm message processing failed');
            terminatePeerConnection(peerKey, 'inbound_processing_failed');
        });
}

async function processInboundPeerData(peerKey: string, chunk: Buffer): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    syncStats.bytesReceived += chunk.length;
    conn.inboundBuffer = conn.inboundBuffer.length === 0
        ? chunk
        : Buffer.concat([conn.inboundBuffer, chunk]);

    while (conn.inboundBuffer.length > 0) {
        if (conn.inboundTransportMode === 'framed') {
            const parsed = decodeFramedMessages(conn.inboundBuffer, MAX_FRAMED_MESSAGE_BYTES);
            if (parsed.error) {
                log.warn(
                    {
                        peer: shortName(peerKey),
                        pendingBytes: conn.inboundBuffer.length,
                        error: parsed.error,
                        ...classifyPendingBuffer(conn.inboundBuffer),
                    },
                    'received malformed framed hyperswarm message'
                );
                noteMalformedPeer(peerKey, 'malformed_framed_message');
                terminatePeerConnection(peerKey, 'malformed_framed_message');
                return;
            }

            if (parsed.messages.length === 0) {
                conn.inboundBuffer = parsed.remaining;
                return;
            }

            conn.inboundBuffer = parsed.remaining;
            for (const message of parsed.messages) {
                await receiveMsg(peerKey, message.toString('utf8'));
                if (!connectionInfo[peerKey]) {
                    return;
                }
            }
            continue;
        }

        // Parse one pre-negotiation raw message at a time. If that message advertises
        // framing, receiveMsg() switches inbound mode before the remaining bytes are decoded.
        const maxLegacyMessages = 1;
        const parsed = conn.inboundTransportMode === 'unknown'
            ? decodeUnknownTransportMessages(conn.inboundBuffer, MAX_FRAMED_MESSAGE_BYTES, maxLegacyMessages)
            : decodeLegacyJsonMessages(conn.inboundBuffer, MAX_FRAMED_MESSAGE_BYTES, maxLegacyMessages);
        if (parsed.error) {
            log.warn(
                {
                    peer: shortName(peerKey),
                    transportMode: conn.transportMode,
                    inboundTransportMode: conn.inboundTransportMode,
                    pendingBytes: conn.inboundBuffer.length,
                    error: parsed.error,
                    legacyError: 'legacyError' in parsed ? parsed.legacyError : undefined,
                    framedError: 'framedError' in parsed ? parsed.framedError : undefined,
                },
                'received malformed legacy hyperswarm message'
            );
            noteMalformedPeer(peerKey, 'malformed_legacy_message');
            terminatePeerConnection(peerKey, 'malformed_legacy_message');
            return;
        }

        if (parsed.messages.length === 0) {
            conn.inboundBuffer = parsed.remaining;
            return;
        }

        conn.inboundBuffer = parsed.remaining;
        if ('transportMode' in parsed && parsed.transportMode === 'framed') {
            setPeerTransportMode(peerKey, 'framed', 'received_framed_message_before_ping');
            setPeerInboundTransportMode(peerKey, 'framed', 'received_framed_message_before_ping');
        }
        for (const message of parsed.messages) {
            await receiveMsg(peerKey, message.toString('utf8'));
            if (!connectionInfo[peerKey]) {
                return;
            }
        }
    }
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

async function handlePingMessage(
    peerKey: string,
    msg: PingMessage,
    nodeName: string,
): Promise<void> {
    clearMalformedPeer(peerKey, 'valid_ping');
    connectionInfo[peerKey].nodeName = nodeName;
    connectionInfo[peerKey].capabilities = normalizePeerCapabilities(msg.capabilities);
    const peerTransportFramingVersion = Number.isInteger(msg.transportFramingVersion)
        ? Number(msg.transportFramingVersion)
        : null;
    connectionInfo[peerKey].peerTransportFramingVersion = peerTransportFramingVersion;
    const negotiatedTransportMode = peerTransportFramingVersion === TRANSPORT_FRAMING_VERSION ? 'framed' : 'legacy';
    setPeerTransportMode(peerKey, negotiatedTransportMode, 'ping_capability_exchange');
    if (negotiatedTransportMode === 'framed') {
        const inboundMode = connectionInfo[peerKey].inboundTransportMode;
        if (inboundMode !== 'framed') {
            setPeerInboundTransportMode(peerKey, 'framed', 'ping_capability_exchange');
        }
    } else {
        setPeerInboundTransportMode(peerKey, 'legacy', 'ping_capability_exchange');
    }
    log.info(
        {
            ...buildPeerSyncCompatibilityContext(peerKey, connectionInfo[peerKey]),
            rawCapabilities: msg.capabilities ?? null,
        },
        'peer capabilities received'
    );

    if (Array.isArray(msg.peers)) {
        for (const did of msg.peers) {
            addPeer(did);
        }
    }

    await maybeStartPeerSync(peerKey);
    await maybeSchedulePreferredSyncs();
}

async function handleNegOpenMessage(
    peerKey: string,
    conn: ConnectionInfo,
    msg: NegOpenMessage,
): Promise<void> {
    let session = peerSessions.get(peerKey);
    const remoteSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : '';
    const activeOrderedCatchupSessionId = getActiveOrderedCatchupSessionId(conn, session);
    const conflictDecision = decideInboundNegOpenConflict({
        activeSessionMode: session?.mode ?? null,
        activeSessionId: session?.sessionId ?? null,
        activeOrderedCatchupSessionId,
        remoteSessionId,
    });
    const globalOrderedCatchupActive = hasActiveOutboundOrderedCatchup();
    const peerOrderedCatchupActive = hasOrderedCatchupOutboundGuardForPeer(conn);

    if (conflictDecision.action === 'ignore' || globalOrderedCatchupActive || peerOrderedCatchupActive) {
        const remoteWindowId = typeof msg.windowId === 'string' ? msg.windowId : '';
        const rejectionSent = remoteSessionId.length > 0
            && remoteWindowId.length > 0
            && supportsPeerNegentropyTransport(conn)
            && sendToPeer(peerKey, {
                ...createBaseMessage('neg_close'),
                sessionId: remoteSessionId,
                windowId: remoteWindowId,
                round: Number.isInteger(msg.round) ? msg.round : 0,
                reason: 'ordered_catchup_active',
            });
        log.warn(
            {
                peer: shortName(peerKey),
                remoteSessionId,
                activeSessionMode: session?.mode ?? null,
                activeSessionId: session?.sessionId ?? null,
                activeOrderedCatchupSessionId,
                globalOrderedCatchupActive,
                peerOrderedCatchupActive,
                postImportActive: orderedCatchupTransitionPeers.size > 0,
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
    if (!supportsPeerNegentropyTransport(conn)) {
        log.warn(
            {
                peer: shortName(peerKey),
                sessionId: msg.sessionId,
                peerVersion: conn.capabilities.version,
                requiredVersion: NEGENTROPY_VERSION,
                peerTransportFramingVersion: conn.peerTransportFramingVersion,
                requiredTransportFramingVersion: TRANSPORT_FRAMING_VERSION,
            },
            'ignoring neg_open from incompatible negentropy transport'
        );
        return;
    }

    const window = parseRemoteWindow(msg.window, config.negentropyMaxRecordsPerWindow);
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

    if (!session || session.mode !== 'negentropy' || session.sessionId !== msg.sessionId) {
        session = createPeerSession(peerKey, 'negentropy', false, msg.sessionId);
    }

    session.initiator = false;
    session.maxRounds = config.negentropyMaxRoundsPerSession;
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
    if (!session || session.mode !== 'negentropy' || session.sessionId !== msg.sessionId) {
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
    if (peerSessions.get(peerKey) === session) {
        touchPeerSession(peerKey);
    }
}

async function handleOpsPushMessage(peerKey: string, msg: OpsPushMessage): Promise<void> {
    const session = peerSessions.get(peerKey);
    if (!session || session.mode !== 'negentropy' || session.sessionId !== msg.sessionId) {
        log.warn({ peer: shortName(peerKey), sessionId: msg.sessionId }, 'ignoring ops_push for unknown session');
        return;
    }
    if (!isCurrentSessionWindow(peerKey, session, msg.windowId, 'ops_push')) {
        return;
    }

    const batch = normalizeInboundOpsPushBatch(msg.data);
    if (batch.length > 0) {
        syncStats.negentropyOpsPushReceived += batch.length;
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

        const imported = await importQueue.pushAsync<ImportQueueResult>({
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
                terminatePeerConnection(peerKey, 'unresolved_operations');
                return;
            }
        }
        closePeerSession(peerKey, msg.reason || 'remote_closed');
    }
}

async function receiveMsg(peerKey: string, json: Buffer | string): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    let msg: HyperMessage;
    const payload = typeof json === 'string' ? json : json.toString('utf8');

    try {
        msg = JSON.parse(payload);
    }
    catch {
        const jsonPreview = payload.length > 80 ? `${payload.slice(0, 40)}...${payload.slice(-40)}` : payload;
        log.warn({ peer: conn.peerName, transportMode: conn.transportMode, jsonPreview }, 'received invalid hyperswarm JSON message');
        noteMalformedPeer(peerKey, 'invalid_hyperswarm_json_message');
        terminatePeerConnection(peerKey, 'invalid_hyperswarm_json_message');
        return;
    }

    const nodeName = msg.node || 'anon';
    const messageType = msg.type;

    log.debug(`received ${msg.type} from: ${shortName(peerKey)} (${nodeName})`);
    connectionInfo[peerKey].lastSeen = new Date().getTime();

    if (msg.type !== 'ping' && conn.transportMode === 'unknown') {
        setPeerTransportMode(peerKey, 'legacy', 'received_raw_message_before_ping');
        setPeerInboundTransportMode(peerKey, 'legacy', 'received_raw_message_before_ping');
    }

    if (msg.type === 'queue') {
        if (Array.isArray(msg.data) && newBatch(msg.data)) {
            importQueue.push({
                name: peerKey,
                node: msg.node,
                data: msg.data,
                queueGossip: true,
            });
            if (!Array.isArray(msg.relays)) {
                msg.relays = [];
            }
            msg.relays.push(peerKey);
            await relayMsg(msg);
        }
        return;
    }

    if (msg.type === 'ping') {
        await handlePingMessage(peerKey, msg, nodeName);
        return;
    }

    if (msg.type === 'ordered_catchup_req') {
        await sendOrderedCatchupPage(peerKey, msg);
        return;
    }

    if (msg.type === 'ordered_catchup_push') {
        await handleOrderedCatchupPush(peerKey, msg);
        return;
    }

    if (msg.type === 'ordered_catchup_done') {
        await handleOrderedCatchupDone(peerKey, msg);
        return;
    }

    if (msg.type === 'neg_open') {
        await handleNegOpenMessage(peerKey, conn, msg);
        return;
    }

    if (msg.type === 'neg_msg') {
        await handleNegMsgMessage(peerKey, msg);
        return;
    }

    if (msg.type === 'ops_req') {
        await handleOpsReqMessage(peerKey, msg);
        return;
    }

    if (msg.type === 'ops_push') {
        await handleOpsPushMessage(peerKey, msg);
        return;
    }

    if (msg.type === 'neg_close') {
        await handleNegCloseMessage(peerKey, msg);
        return;
    }

    log.warn(`unknown message type: ${messageType}`);
}

async function flushQueue(): Promise<void> {
    const batch = await gatekeeper.getQueue(REGISTRY);

    if (batch.length > 0) {
        await persistProcessedOperations(batch, [], 'flushQueue');
        syncStats.queueOpsRelayed += batch.length;
        const samples = collectQueueDelaySamples(batch);
        for (const sample of samples) {
            addAggregateSample(syncStats.queueDelayMs, sample);
        }

        const msg: QueueMessage = {
            type: 'queue',
            time: new Date().toISOString(),
            node: nodeInfo.name,
            relays: [],
            data: batch,
        };

        const hashes = batch
            .map((op: Operation) => op.signature?.hash)
            .filter((hash): hash is string => !!hash);
        await gatekeeper.clearQueue(REGISTRY, hashes);
        await relayMsg(msg);
        await mergeBatch(batch);
    }
}

async function syncGatekeeperIndexToStore(source: string): Promise<void> {
    const sync = await bootstrapSyncStoreFromGatekeeper(syncStore, gatekeeper);
    if (sync.resetReason) {
        resetRuntimeSyncStateAfterGatekeeperReset(sync);
    }
    else if (pendingSyncRecords.size > 0) {
        try {
            const pruned = await prunePersistedSyncRecords(
                pendingSyncRecords,
                syncStore,
                NEG_MAX_IDS_PER_LOOKUP,
            );
            log.debug({ source, ...pruned, remaining: pendingSyncRecords.size }, 'pruned persisted sync-store retries');
        }
        catch (error) {
            log.warn(
                { error, source, remaining: pendingSyncRecords.size },
                'failed to prune persisted sync-store retries'
            );
        }
    }

    if (!sync.resetReason && (sync.inserted > 0 || sync.updated > 0 || sync.deleted > 0)) {
        markNegentropyAdapterDirty();
        for (const [peerKey, session] of peerSessions.entries()) {
            if (
                (sync.inserted > 0 || sync.updated > 0)
                && session.mode === 'negentropy'
                && session.unresolvedNeedIds.size > 0
            ) {
                await refreshStoredUnresolvedNeeds(peerKey, session);
            }
        }
    }

    if (sync.resetReason || sync.inserted > 0 || sync.updated > 0 || sync.deleted > 0) {
        maybeStartBackgroundPrebuild(`gatekeeper_index_${source}`);
    }

    log.debug({ source, sync }, 'gatekeeper index sync complete');

    if (sync.resetReason) {
        await maybeRestartPeerSyncsAfterGatekeeperReset();
    }
}

async function waitForInitialGatekeeperIndexSync(): Promise<void> {
    while (true) {
        try {
            const bootstrap = await bootstrapSyncStoreFromGatekeeper(syncStore, gatekeeper);
            log.info({ bootstrap }, 'sync-store bootstrap complete');
            return;
        }
        catch (error) {
            log.error({ error }, 'Error in sync-store bootstrap');
            await new Promise(resolve => setTimeout(resolve, config.exportInterval * 1000));
        }
    }
}

async function exportLoop(): Promise<void> {
    try {
        await syncGatekeeperIndexToStore('exportLoop');
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

        const msg = await buildPingMessage();

        await relayMsg(msg);
        await runPeriodicNegentropyRepair();
        await maybeSchedulePreferredSyncs();

        log.debug({ syncStats: buildSyncStatsSnapshot(syncStats) }, 'hyperswarm sync stats');

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
const networkID = createHash('sha256').update(config.protocol, 'utf8').digest('hex');
const topic = Buffer.from(b4a.from(networkID, 'hex'));

async function main(): Promise<void> {
    log.info({ db: config.db }, 'sync-store backend selected');
    await syncStore.start();
    // Retry pre-0.5 out-of-order operations and modern losing-fork descendants after restart.
    const deletedRejectedOperations = await syncStore.deleteBySyncOrder(
        TERMINAL_REJECTED_SYNC_ORDER,
    );
    terminalOperationCids.clear();
    log.info(
        { deletedRejectedOperations },
        'removed terminal rejected operations from sync store',
    );

    await gatekeeper.connect({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    await waitForInitialGatekeeperIndexSync();

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
    if (!config.negentropyEnabled) {
        negentropyAdapter = null;
        adapterChangeSeq = 0;
        adapterBuiltSeq = -1;
        adapterBuiltAt = 0;
        adapterBuiltWindowId = null;
        adapterBuiltSnapshot = null;
        rebuildPromise = null;
        backgroundPrebuildQueued = false;
        log.info('negentropy disabled via KC_HYPR_NEGENTROPY_ENABLE; full reconciliation is disabled');
        return;
    }

    negentropyAdapter = await NegentropyAdapter.create({
        syncStore,
        frameSizeLimit: config.negentropyFrameSizeLimit,
        maxRecordsPerWindow: config.negentropyMaxRecordsPerWindow,
        maxRoundsPerSession: config.negentropyMaxRoundsPerSession,
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
            maxRecordsPerWindow: config.negentropyMaxRecordsPerWindow,
            maxRoundsPerSession: config.negentropyMaxRoundsPerSession,
            frameSizeLimit: config.negentropyFrameSizeLimit,
        },
        'negentropy adapter initialized'
    );
}

export async function runMediator(options: MediatorMainOptions = {}): Promise<void> {
    if (options.syncStore) {
        replaceSyncStore(options.syncStore);
    }

    if (options.startLoops === false) {
        await syncStore.start();
        return;
    }

    return main();
}

export const __test = {
    resetState(): void {
        for (const peerKey of Object.keys(connectionInfo)) {
            delete connectionInfo[peerKey];
        }
        peerSessions.clear();
        orderedCatchupTransitionPeers.clear();
        outboundSyncStartInProgress = false;
        nodeKey = '';
        replaceSyncStore(createConfiguredSyncStore());
        negentropyAdapter = null;
        adapterChangeSeq = 0;
        adapterBuiltSeq = -1;
        adapterBuiltAt = 0;
        adapterBuiltWindowId = null;
        adapterBuiltSnapshot = null;
        rebuildPromise = null;
        backgroundPrebuildQueued = false;
    },

    setNodeKey(key: string): void {
        nodeKey = key;
    },

    setSyncStore(store: OperationSyncStore): void {
        replaceSyncStore(store);
    },

    setNegentropyAdapter(adapter: unknown): void {
        negentropyAdapter = adapter as NegentropyAdapter | null;
    },

    addConnection(peerKey: string, overrides: Record<string, unknown> = {}): void {
        const connection = (overrides.connection as HyperswarmConnection | undefined) ?? ({
            write: () => undefined,
            destroy: () => undefined,
            once: () => undefined,
            on: () => undefined,
            remotePublicKey: Buffer.from(peerKey, 'hex'),
        } as unknown as HyperswarmConnection);
        const connectionInfoOverrides = { ...overrides };
        delete connectionInfoOverrides.connection;

        connectionInfo[peerKey] = {
            ...createConnectionInfo({
                connection,
                peerKey,
                peerName: shortName(peerKey),
                nodeName: 'test-peer',
            }),
            ...connectionInfoOverrides,
        } as ConnectionInfo;
    },

    disconnectPeer(peerKey: string): void {
        closeConnection(peerKey);
    },

    async sendOrderedCatchupPage(peerKey: string, msg: OrderedCatchupReqMessage): Promise<void> {
        await sendOrderedCatchupPage(peerKey, msg);
    },

    async maybeStartPeerSync(peerKey: string, source: 'connect' | 'periodic' = 'connect'): Promise<void> {
        await maybeStartPeerSync(peerKey, source);
    },

    clearExpiredOrderedCatchupServerExpectation(peerKey: string, now = Date.now()): boolean {
        return clearExpiredOrderedCatchupServerExpectation(peerKey, now);
    },

    createOrderedCatchupClientSession(peerKey: string, sessionId: string): void {
        const session = createPeerSession(peerKey, 'ordered_catchup', true, sessionId);
        setOrderedCatchupClientState(peerKey, session.sessionId);
    },

    async receiveMsg(peerKey: string, msg: Record<string, unknown>): Promise<void> {
        await receiveMsg(peerKey, JSON.stringify(msg));
    },

    async processInboundPeerData(peerKey: string, chunk: Buffer | string): Promise<void> {
        await processInboundPeerData(peerKey, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
    },

    async sendPingToPeer(peerKey: string, source: 'initial' | 'periodic' = 'periodic'): Promise<void> {
        await sendPingToPeer(peerKey, source);
    },

    getConnectionState(peerKey: string): Record<string, unknown> | null {
        const conn = connectionInfo[peerKey];
        if (!conn) {
            return null;
        }
        const session = peerSessions.get(peerKey);

        return {
            syncMode: conn.syncMode,
            syncStarted: conn.syncStarted,
            activeSession: session
                ? {
                    mode: session.mode,
                    sessionId: session.sessionId,
                }
                : null,
            orderedCatchupClientSessionId: conn.orderedCatchupClientSessionId,
            orderedCatchupServerSessionId: conn.orderedCatchupServerSessionId,
            orderedCatchupServerLastActivity: conn.orderedCatchupServerLastActivity,
            orderedCatchupServerPendingSince: conn.orderedCatchupServerPendingSince,
            orderedCatchupServerPendingUntil: conn.orderedCatchupServerPendingUntil,
            orderedCatchupServerPendingReason: conn.orderedCatchupServerPendingReason,
            orderedCatchupServerPendingGap: conn.orderedCatchupServerPendingGap,
            initialPingSent: conn.initialPingSent,
            transportMode: conn.transportMode,
            inboundTransportMode: conn.inboundTransportMode,
            peerTransportFramingVersion: conn.peerTransportFramingVersion,
        };
    },

    getSyncStatsSnapshot(): object {
        return buildSyncStatsSnapshot(syncStats);
    },
};

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
    runMediator().catch(error => {
        log.error({ error }, 'fatal mediator error');
        process.exit(1);
    });
}
