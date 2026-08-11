import Hyperswarm, { HyperswarmConnection } from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { createHash, randomBytes } from 'crypto';
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
import PostgresOperationSyncStore from './db/postgres.js';
import NegentropyAdapter from './negentropy/adapter.js';
import {
    normalizePeerCapabilities,
} from './negentropy/protocol.js';
import {
    addAggregateSample,
    collectQueueDelaySamples,
} from './negentropy/observability.js';
import type { BootstrapResult } from './bootstrap.js';
import {
    createImportPipeline,
    TERMINAL_REJECTED_SYNC_ORDER,
    type ImportPipeline,
} from './import-pipeline.js';
import { createOrderedCatchupCoordinator } from './ordered-catchup-coordinator.js';
import { createNegentropyCoordinator } from './negentropy-coordinator.js';
import { createPeerSyncCoordinator } from './peer-sync-coordinator.js';
import {
    DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
    decodeFramedMessages,
    decodeLegacyJsonMessages,
    encodeFramedMessage,
} from './transport-framing.js';
import type {
    HyperMessage,
    HyperMessageBase,
    OrderedCatchupReqMessage,
    PingMessage,
    QueueMessage,
} from './protocol-messages.js';
import {
    createConnectionInfo,
    type ConnectionInfo,
    type MalformedPeerState,
    type MediatorMainOptions,
    type NodeInfo,
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

function createConfiguredSyncStore(): OperationSyncStore {
    if (config.db === 'postgres') {
        return new PostgresOperationSyncStore(config.postgresURL);
    }

    return new SqliteOperationSyncStore();
}

let syncStore: OperationSyncStore = createConfiguredSyncStore();
let shutdownStarted = false;

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const NEGENTROPY_VERSION = 1;
const ORDERED_CATCHUP_VERSION = 1;
const TRANSPORT_FRAMING_VERSION = 1;
const MAX_FRAMED_MESSAGE_BYTES = DEFAULT_MAX_FRAMED_MESSAGE_BYTES;
const NEG_SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const NEG_MAX_IDS_PER_OPS_REQ = 1_000;
const NEG_MAX_IDS_PER_LOOKUP = 1_000;
const NEG_MAX_OPS_PER_PUSH = 300;
const NEG_MAX_BYTES_PER_PUSH = 512 * 1024;
const NEG_REPAIR_INTERVAL_MS = config.negentropyIntervalSeconds * 1000;
const NEG_ADAPTER_MAX_AGE_MS = 60 * 1000;
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
const syncStats = createMediatorSyncStats();
let negentropyCoordinator: ReturnType<typeof createNegentropyCoordinator>;
let peerSyncCoordinator: ReturnType<typeof createPeerSyncCoordinator>;

function buildImportPipeline(store: OperationSyncStore): ImportPipeline {
    return createImportPipeline({
        gatekeeper,
        syncStore: store,
        cipher,
        syncStats,
        onStoreChanged(source) {
            negentropyCoordinator.markStoreChanged(source);
        },
    });
}

let importPipeline = buildImportPipeline(syncStore);

function buildOrderedCatchupCoordinator(
    store: OperationSyncStore,
    pipeline: ImportPipeline,
) {
    return createOrderedCatchupCoordinator({
        version: ORDERED_CATCHUP_VERSION,
        maxOpsPerPage: NEG_MAX_OPS_PER_PUSH,
        maxBytesPerPage: NEG_MAX_BYTES_PER_PUSH,
        idleTimeoutMs: NEG_SESSION_IDLE_TIMEOUT_MS,
        syncStore: store,
        importPipeline: pipeline,
        syncStats,
        getConnection: peerKey => connectionInfo[peerKey],
        createSessionId,
        createBaseMessage,
        sendToPeer,
        onIndexRefreshed: handleGatekeeperIndexSyncResult,
        onComplete: outcome => peerSyncCoordinator.handleOrderedCatchupComplete(outcome),
        onHandoffDeferred: () => peerSyncCoordinator.schedulePreferredSyncs(),
        onFailure: () => peerSyncCoordinator.handleOrderedCatchupFailure(),
    });
}

let orderedCatchupCoordinator = buildOrderedCatchupCoordinator(syncStore, importPipeline);

function buildNegentropyCoordinator(
    store: OperationSyncStore,
    pipeline: ImportPipeline,
) {
    return createNegentropyCoordinator({
        version: NEGENTROPY_VERSION,
        transportFramingVersion: TRANSPORT_FRAMING_VERSION,
        frameSizeLimit: config.negentropyFrameSizeLimit,
        maxRecordsPerWindow: config.negentropyMaxRecordsPerWindow,
        maxRoundsPerSession: config.negentropyMaxRoundsPerSession,
        maxIdsPerRequest: NEG_MAX_IDS_PER_OPS_REQ,
        maxIdsPerLookup: NEG_MAX_IDS_PER_LOOKUP,
        maxOpsPerPush: NEG_MAX_OPS_PER_PUSH,
        maxBytesPerPush: NEG_MAX_BYTES_PER_PUSH,
        adapterMaxAgeMs: NEG_ADAPTER_MAX_AGE_MS,
        idleTimeoutMs: NEG_SESSION_IDLE_TIMEOUT_MS,
        syncStore: store,
        importPipeline: pipeline,
        syncStats,
        getConnection: peerKey => connectionInfo[peerKey],
        createSessionId,
        createBaseMessage,
        sendToPeer,
        canStartBackgroundPrebuild: () => peerSyncCoordinator.canStartBackgroundPrebuild(),
        terminatePeerConnection,
        onSessionClosed: (peerKey, reason) => peerSyncCoordinator.handleNegentropySessionClosed(peerKey, reason),
    });
}

negentropyCoordinator = buildNegentropyCoordinator(syncStore, importPipeline);
peerSyncCoordinator = createPeerSyncCoordinator({
    negentropyVersion: NEGENTROPY_VERSION,
    orderedCatchupVersion: ORDERED_CATCHUP_VERSION,
    transportFramingVersion: TRANSPORT_FRAMING_VERSION,
    windowSize: config.negentropyMaxRecordsPerWindow,
    repairIntervalMs: NEG_REPAIR_INTERVAL_MS,
    syncStats,
    getNodeKey: () => nodeKey,
    getPeerKeys: () => Object.keys(connectionInfo),
    getConnection: peerKey => connectionInfo[peerKey],
    getSyncStore: () => syncStore,
    getImportPipeline: () => importPipeline,
    getNegentropyCoordinator: () => negentropyCoordinator,
    getOrderedCatchupCoordinator: () => orderedCatchupCoordinator,
    waitForInitialPing,
});

function replaceSyncStore(store: OperationSyncStore): void {
    if (importPipeline.queued > 0 || importPipeline.running > 0) {
        throw new Error('cannot replace sync store while imports are active');
    }
    orderedCatchupCoordinator.shutdown();
    importPipeline.shutdown();
    syncStore = store;
    importPipeline = buildImportPipeline(store);
    orderedCatchupCoordinator = buildOrderedCatchupCoordinator(store, importPipeline);
    negentropyCoordinator.replaceStore(store, importPipeline);
}

let swarm: Hyperswarm | null = null;
let nodeKey = '';
let nodeInfo: NodeInfo;

goodbye(async () => {
    shutdownStarted = true;
    const peerSyncShutdown = peerSyncCoordinator.shutdown();
    const negentropyShutdown = negentropyCoordinator.shutdown();
    const orderedCatchupShutdown = orderedCatchupCoordinator.shutdown();

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
        await peerSyncShutdown;
        await orderedCatchupShutdown;
        await negentropyShutdown;
        await importPipeline.shutdown();
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

    const previousConnection = connectionInfo[peerKey];
    if (previousConnection) {
        terminatePeerConnection(peerKey, 'connection_replaced', previousConnection);
    }

    const connectionState = createConnectionInfo({
        connection: conn,
        peerKey,
        peerName,
        requireInitialPing: true,
    });
    connectionInfo[peerKey] = connectionState;

    connectionState.initialPingPromise = sendPingToPeer(peerKey, connectionState).catch(error => {
        log.error({ error, peer: peerName }, 'failed to build initial hyperswarm ping');
        if (connectionInfo[peerKey] === connectionState) {
            terminatePeerConnection(peerKey, 'initial_ping_failed');
        }
    });

    conn.once('close', () => closeConnection(peerKey, connectionState));
    conn.once('error', error => {
        if (connectionInfo[peerKey] !== connectionState) {
            return;
        }
        log.warn({ error, peer: peerName }, 'hyperswarm peer connection error');
        terminatePeerConnection(peerKey, 'connection_error', connectionState);
    });
    conn.on('data', data => queueInboundPeerData(peerKey, data, connectionState));

    log.info(`received connection from: ${peerName}`);

    const peerNames = Object.values(connectionInfo).map(info => info.peerName);
    log.debug(`--- ${peerNames.length} nodes connected, detected nodes: ${peerNames.join(', ')}`);
}

function closeConnection(peerKey: string, expectedConnection?: ConnectionInfo): void {
    const conn = connectionInfo[peerKey];
    if (!conn || (expectedConnection && conn !== expectedConnection)) {
        return;
    }
    log.info(`* connection closed with: ${conn.peerName} (${conn.nodeName}) *`);

    delete connectionInfo[peerKey];
    orderedCatchupCoordinator.removePeer(peerKey, 'connection_closed');
    negentropyCoordinator.removePeer(peerKey, 'connection_closed');
}

function terminatePeerConnection(
    peerKey: string,
    reason: string,
    expectedConnection?: ConnectionInfo,
): void {
    const conn = connectionInfo[peerKey];
    if (!conn || (expectedConnection && conn !== expectedConnection)) {
        return;
    }

    orderedCatchupCoordinator.removePeer(peerKey, reason);
    negentropyCoordinator.removePeer(peerKey, reason);

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

function quarantineLegacyTransportPeer(
    peerKey: string,
    reason: string,
    details: Record<string, unknown> = {},
): void {
    const conn = connectionInfo[peerKey];
    if (!conn || conn.legacyTransportQuarantined) {
        return;
    }

    conn.legacyTransportQuarantined = true;
    conn.syncMode = 'unknown';
    conn.syncStarted = false;
    conn.negentropySynced = false;
    conn.inboundBuffer = Buffer.alloc(0);
    orderedCatchupCoordinator.removePeer(peerKey, reason);
    negentropyCoordinator.removePeer(peerKey, reason);
    syncStats.legacyTransportConnectionsQuarantined += 1;
    log.warn(
        {
            peer: shortName(peerKey),
            ...details,
        },
        'quarantined peer using an unsupported transport framing version'
    );
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

function writeFramedJson(conn: HyperswarmConnection, json: string): number {
    const framed = encodeFramedMessage(json, MAX_FRAMED_MESSAGE_BYTES);
    syncStats.bytesSent += framed.length;
    conn.write(framed);
    return framed.length;
}

async function buildPingMessage(): Promise<PingMessage> {
    const capabilities = await peerSyncCoordinator.buildCapabilities();

    return {
        ...createBaseMessage('ping'),
        peers: Object.keys(knownNodes),
        capabilities,
        transportFramingVersion: TRANSPORT_FRAMING_VERSION,
    };
}

function sendToPeer(peerKey: string, msg: HyperMessage): boolean {
    const conn = connectionInfo[peerKey];
    if (!conn
        || conn.legacyTransportQuarantined
        || (msg.type !== 'ping' && !conn.initialPingSent)) {
        return false;
    }

    try {
        const json = JSON.stringify(msg);
        writeFramedJson(conn.connection, json);
        return true;
    }
    catch (error) {
        log.error({ error, peer: shortName(peerKey), type: msg.type }, 'failed to send hyperswarm message');
        return false;
    }
}

async function sendPingToPeer(peerKey: string, expectedConnection?: ConnectionInfo): Promise<void> {
    const ping = await buildPingMessage();
    const conn = connectionInfo[peerKey];
    if (!conn || (expectedConnection && conn !== expectedConnection)) {
        return;
    }
    if (sendToPeer(peerKey, ping)) {
        conn.initialPingSent = true;
        log.debug(`* sent ping to: ${shortName(peerKey)}`);
    }
}

async function waitForInitialPing(peerKey: string, conn: ConnectionInfo): Promise<boolean> {
    await conn.initialPingPromise;
    return connectionInfo[peerKey] === conn
        && conn.initialPingSent
        && !conn.legacyTransportQuarantined;
}

function buildPeerSyncCompatibilityContext(peerKey: string, conn: ConnectionInfo): object {
    return {
        peer: shortName(peerKey),
        node: conn.nodeName || 'anon',
        capabilities: conn.capabilities,
        peerTransportFramingVersion: conn.peerTransportFramingVersion,
        requiredNegentropyVersion: NEGENTROPY_VERSION,
        requiredTransportFramingVersion: TRANSPORT_FRAMING_VERSION,
    };
}

function createSessionId(peerKey: string): string {
    const nonce = randomBytes(8).toString('hex');
    return `${Date.now().toString(36)}-${shortName(nodeKey)}-${shortName(peerKey)}-${nonce}`;
}

function expireIdlePeerSessions(): void {
    const now = Date.now();
    negentropyCoordinator.expire(now);
    orderedCatchupCoordinator.expire(now);
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

const batchesSeen: Record<string, boolean> = {};

function newBatch(batch: Operation[]): boolean {
    const hash = cipher.hashJSON(batch);

    if (!batchesSeen[hash]) {
        batchesSeen[hash] = true;
        return true;
    }

    return false;
}

function queueInboundPeerData(
    peerKey: string,
    chunk: Buffer | string,
    expectedConnection?: ConnectionInfo,
): void {
    const conn = connectionInfo[peerKey];
    if (!conn || (expectedConnection && conn !== expectedConnection)) {
        return;
    }

    if (conn.legacyTransportQuarantined) {
        syncStats.bytesReceived += typeof chunk === 'string'
            ? Buffer.byteLength(chunk, 'utf8')
            : chunk.length;
        conn.lastSeen = Date.now();
        return;
    }

    const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    conn.inboundReceiveChain = conn.inboundReceiveChain
        .then(() => processInboundPeerData(peerKey, incoming, conn))
        .catch(error => {
            log.error({ error, peer: shortName(peerKey) }, 'inbound hyperswarm message processing failed');
            terminatePeerConnection(peerKey, 'inbound_processing_failed', conn);
        });
}

async function processInboundPeerData(
    peerKey: string,
    chunk: Buffer,
    expectedConnection?: ConnectionInfo,
): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn || (expectedConnection && conn !== expectedConnection)) {
        return;
    }

    syncStats.bytesReceived += chunk.length;
    if (conn.legacyTransportQuarantined) {
        conn.lastSeen = Date.now();
        return;
    }

    conn.inboundBuffer = conn.inboundBuffer.length === 0
        ? chunk
        : Buffer.concat([conn.inboundBuffer, chunk]);

    while (conn.inboundBuffer.length > 0) {
        const parsed = decodeFramedMessages(conn.inboundBuffer, MAX_FRAMED_MESSAGE_BYTES);
        if (parsed.error) {
            const legacy = decodeLegacyJsonMessages(conn.inboundBuffer, MAX_FRAMED_MESSAGE_BYTES, 1);
            if (!legacy.error) {
                if (legacy.messages.length === 0) {
                    conn.inboundBuffer = legacy.remaining;
                    return;
                }

                const message = legacy.messages[0];
                try {
                    const legacyMessage = JSON.parse(message.toString('utf8')) as { type?: unknown };
                    if (typeof legacyMessage.type !== 'string') {
                        throw new Error('unframed message type must be a string');
                    }

                    if (conn.initialInboundMessageReceived) {
                        quarantineLegacyTransportPeer(
                            peerKey,
                            'legacy_unframed_transport',
                            { messageType: legacyMessage.type },
                        );
                        return;
                    }

                    if (legacyMessage.type !== 'ping') {
                        throw new Error('initial unframed message must be a ping');
                    }
                }
                catch (error) {
                    log.warn(
                        { error, peer: shortName(peerKey) },
                        'received invalid unframed initial hyperswarm ping'
                    );
                    noteMalformedPeer(peerKey, 'invalid_unframed_initial_ping');
                    terminatePeerConnection(peerKey, 'invalid_unframed_initial_ping');
                    return;
                }

                conn.initialInboundMessageReceived = true;
                conn.inboundBuffer = legacy.remaining;
                await receiveMsg(peerKey, message.toString('utf8'), conn);
                if (connectionInfo[peerKey] !== conn) {
                    return;
                }
                continue;
            }
        }

        if (parsed.error) {
            log.warn(
                {
                    peer: shortName(peerKey),
                    pendingBytes: conn.inboundBuffer.length,
                    error: parsed.error,
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

        conn.initialInboundMessageReceived = true;
        conn.inboundBuffer = parsed.remaining;
        for (const message of parsed.messages) {
            await receiveMsg(peerKey, message.toString('utf8'), conn);
            if (connectionInfo[peerKey] !== conn) {
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
    const conn = connectionInfo[peerKey];
    if (!conn) {
        return;
    }

    const peerTransportFramingVersion = Number.isInteger(msg.transportFramingVersion)
        ? Number(msg.transportFramingVersion)
        : null;
    conn.peerTransportFramingVersion = peerTransportFramingVersion;
    if (peerTransportFramingVersion !== TRANSPORT_FRAMING_VERSION) {
        quarantineLegacyTransportPeer(
            peerKey,
            peerTransportFramingVersion === null
                ? 'missing_transport_framing_version'
                : 'unsupported_transport_framing_version',
            {
                peerTransportFramingVersion,
                requiredTransportFramingVersion: TRANSPORT_FRAMING_VERSION,
            },
        );
        return;
    }

    clearMalformedPeer(peerKey, 'valid_ping');
    conn.nodeName = nodeName;
    conn.capabilities = normalizePeerCapabilities(msg.capabilities);
    log.info(
        {
            ...buildPeerSyncCompatibilityContext(peerKey, conn),
            rawCapabilities: msg.capabilities ?? null,
        },
        'peer capabilities received'
    );

    if (Array.isArray(msg.peers)) {
        for (const did of msg.peers) {
            addPeer(did);
        }
    }

    await peerSyncCoordinator.onPeerCapabilities(peerKey);
}

async function receiveMsg(
    peerKey: string,
    json: Buffer | string,
    expectedConnection?: ConnectionInfo,
): Promise<void> {
    const conn = connectionInfo[peerKey];
    if (!conn
        || (expectedConnection && conn !== expectedConnection)
        || conn.legacyTransportQuarantined) {
        return;
    }

    let msg: HyperMessage;
    const payload = typeof json === 'string' ? json : json.toString('utf8');

    try {
        msg = JSON.parse(payload);
    }
    catch {
        const jsonPreview = payload.length > 80 ? `${payload.slice(0, 40)}...${payload.slice(-40)}` : payload;
        log.warn({ peer: conn.peerName, jsonPreview }, 'received invalid hyperswarm JSON message');
        noteMalformedPeer(peerKey, 'invalid_hyperswarm_json_message');
        terminatePeerConnection(peerKey, 'invalid_hyperswarm_json_message');
        return;
    }

    const nodeName = msg.node || 'anon';
    const messageType = msg.type;

    log.debug(`received ${msg.type} from: ${shortName(peerKey)} (${nodeName})`);
    conn.lastSeen = new Date().getTime();

    if (msg.type !== 'ping' && conn.peerTransportFramingVersion !== TRANSPORT_FRAMING_VERSION) {
        quarantineLegacyTransportPeer(
            peerKey,
            'missing_transport_framing_version',
            {
                messageType,
                requiredTransportFramingVersion: TRANSPORT_FRAMING_VERSION,
            },
        );
        return;
    }
    if (msg.type !== 'ping' && !await waitForInitialPing(peerKey, conn)) {
        return;
    }

    if (msg.type === 'queue') {
        if (Array.isArray(msg.data) && newBatch(msg.data)) {
            importPipeline.enqueue({
                kind: 'remote',
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

    if (msg.type === 'ordered_catchup_req'
        || msg.type === 'ordered_catchup_push'
        || msg.type === 'ordered_catchup_done'
        || msg.type === 'neg_open'
        || msg.type === 'neg_msg'
        || msg.type === 'ops_req'
        || msg.type === 'ops_push'
        || msg.type === 'neg_close') {
        await peerSyncCoordinator.handleMessage(peerKey, msg);
        return;
    }

    log.warn(`unknown message type: ${messageType}`);
}

async function flushQueue(): Promise<void> {
    const batch = await gatekeeper.getQueue(REGISTRY);

    if (batch.length > 0) {
        const imported = await importPipeline.enqueue({
            kind: 'local_queue',
            phase: 'persist',
            name: nodeKey,
            data: batch,
        });
        if (imported.retryable) {
            throw new Error('failed to import local Gatekeeper queue');
        }
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
        const merged = await importPipeline.enqueue({
            kind: 'local_queue',
            phase: 'merge',
            name: nodeKey,
            data: batch,
        });
        if (merged.retryable) {
            throw new Error('failed to merge local Gatekeeper queue');
        }
    }
}

async function handleGatekeeperIndexSyncResult(source: string, sync: BootstrapResult): Promise<void> {
    if (shutdownStarted) {
        return;
    }
    if (sync.resetReason) {
        peerSyncCoordinator.resetAfterGatekeeperReset(sync);
    }
    await negentropyCoordinator.handleIndexRefreshed(source, sync);

    if (shutdownStarted) {
        return;
    }

    log.debug({ source, sync }, 'gatekeeper index sync complete');

    if (sync.resetReason) {
        await peerSyncCoordinator.restartAfterGatekeeperReset();
    }
}

async function syncGatekeeperIndexToStore(source: string): Promise<void> {
    const sync = await importPipeline.refreshIndex(source);
    await handleGatekeeperIndexSyncResult(source, sync);
}

async function waitForInitialGatekeeperIndexSync(): Promise<void> {
    while (true) {
        try {
            const bootstrap = await importPipeline.refreshIndex('startup');
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

    const importQueueLength = importPipeline.queued;

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
        await peerSyncCoordinator.runPeriodicRepairs();

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
    await orderedCatchupCoordinator.shutdown();
    await importPipeline.shutdown();
    const deletedRejectedOperations = await syncStore.deleteBySyncOrder(TERMINAL_REJECTED_SYNC_ORDER);
    importPipeline = buildImportPipeline(syncStore);
    orderedCatchupCoordinator = buildOrderedCatchupCoordinator(syncStore, importPipeline);
    negentropyCoordinator.replaceStore(syncStore, importPipeline);
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
    await negentropyCoordinator.initializeAdapter();
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
        negentropyCoordinator.reset();
        orderedCatchupCoordinator.reset();
        peerSyncCoordinator.reset();
        nodeKey = '';
        replaceSyncStore(createConfiguredSyncStore());
        negentropyCoordinator.setAdapter(null);
    },

    setNodeKey(key: string): void {
        nodeKey = key;
    },

    setSyncStore(store: OperationSyncStore): void {
        replaceSyncStore(store);
    },

    setNegentropyAdapter(adapter: unknown): void {
        negentropyCoordinator.setAdapter(adapter as NegentropyAdapter | null);
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
            peerTransportFramingVersion: TRANSPORT_FRAMING_VERSION,
            ...connectionInfoOverrides,
        } as ConnectionInfo;
    },

    disconnectPeer(peerKey: string): void {
        closeConnection(peerKey);
    },

    async sendOrderedCatchupPage(peerKey: string, msg: OrderedCatchupReqMessage): Promise<void> {
        await orderedCatchupCoordinator.handleMessage(peerKey, msg);
    },

    async maybeStartPeerSync(peerKey: string, source: 'connect' | 'periodic' = 'connect'): Promise<void> {
        await peerSyncCoordinator.maybeStartPeerSync(peerKey, source);
    },

    clearExpiredOrderedCatchupServerExpectation(peerKey: string, now = Date.now()): boolean {
        return orderedCatchupCoordinator.expireServerExpectation(peerKey, now);
    },

    createOrderedCatchupClientSession(peerKey: string, sessionId: string): void {
        if (orderedCatchupCoordinator.createClientSession(peerKey, sessionId)) {
            connectionInfo[peerKey].syncMode = 'negentropy';
            connectionInfo[peerKey].syncStarted = true;
        }
    },

    async receiveMsg(peerKey: string, msg: Record<string, unknown>): Promise<void> {
        await receiveMsg(peerKey, JSON.stringify(msg));
    },

    async processInboundPeerData(peerKey: string, chunk: Buffer | string): Promise<void> {
        await processInboundPeerData(peerKey, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
    },

    async sendPingToPeer(peerKey: string): Promise<void> {
        await sendPingToPeer(peerKey);
    },

    getConnectionState(peerKey: string): Record<string, unknown> | null {
        const conn = connectionInfo[peerKey];
        if (!conn) {
            return null;
        }
        const sessionId = negentropyCoordinator.getActiveSessionId(peerKey);
        const orderedState = orderedCatchupCoordinator.getPeerState(peerKey);
        const orderedSessionId = orderedState.clientSessionId ?? orderedState.serverSessionId;

        return {
            syncMode: conn.syncMode,
            syncStarted: conn.syncStarted,
            activeSession: sessionId
                ? {
                    mode: 'negentropy',
                    sessionId,
                }
                : orderedSessionId
                    ? { mode: 'ordered_catchup', sessionId: orderedSessionId }
                    : null,
            orderedCatchupClientSessionId: orderedState.clientSessionId,
            orderedCatchupServerSessionId: orderedState.serverSessionId,
            orderedCatchupServerLastActivity: orderedState.serverLastActivity,
            orderedCatchupServerPendingSince: orderedState.serverPendingSince,
            orderedCatchupServerPendingUntil: orderedState.serverPendingUntil,
            orderedCatchupServerPendingReason: orderedState.serverPendingReason,
            orderedCatchupServerPendingGap: orderedState.serverPendingGap,
            initialPingSent: conn.initialPingSent,
            peerTransportFramingVersion: conn.peerTransportFramingVersion,
            legacyTransportQuarantined: conn.legacyTransportQuarantined,
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
