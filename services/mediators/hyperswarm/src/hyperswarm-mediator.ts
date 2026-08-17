import Hyperswarm, { type HyperswarmConnection } from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { createHash, randomBytes } from 'crypto';
import { EventEmitter } from 'events';

import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import KuboClient from '@mdip/ipfs/kubo';
import CipherNode from '@mdip/cipher/node';
import { childLogger } from '@mdip/common/logger';
import config from './config.js';
import type { OperationSyncStore } from './db/types.js';
import SqliteOperationSyncStore from './db/sqlite.js';
import PostgresOperationSyncStore from './db/postgres.js';
import NegentropyAdapter from './negentropy/adapter.js';
import {
    createImportPipeline,
    TERMINAL_REJECTED_SYNC_ORDER,
    type ImportPipeline,
} from './import-pipeline.js';
import { createOrderedCatchupCoordinator } from './ordered-catchup-coordinator.js';
import { createNegentropyCoordinator } from './negentropy-coordinator.js';
import { createPeerSyncCoordinator } from './peer-sync-coordinator.js';
import { createHyperswarmTransport } from './hyperswarm-transport.js';
import { createPeerDirectory } from './peer-directory.js';
import { createQueueCoordinator } from './queue-coordinator.js';
import type {
    HyperMessage,
    HyperMessageBase,
    OrderedCatchupReqMessage,
    PingMessage,
} from './protocol-messages.js';
import {
    createConnectionInfo,
    type ConnectionInfo,
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

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const NEGENTROPY_VERSION = 1;
const ORDERED_CATCHUP_VERSION = 1;
const TRANSPORT_FRAMING_VERSION = 1;
const NEG_SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const NEG_MAX_IDS_PER_OPS_REQ = 1_000;
const NEG_MAX_IDS_PER_LOOKUP = 1_000;
const NEG_MAX_OPS_PER_PUSH = 300;
const NEG_MAX_BYTES_PER_PUSH = 512 * 1024;
const NEG_REPAIR_INTERVAL_MS = config.negentropyIntervalSeconds * 1000;
const NEG_ADAPTER_MAX_AGE_MS = 60 * 1000;
const syncStats = createMediatorSyncStats();
let nodeKey = '';
let nodeInfo: NodeInfo;
const peerDirectory = createPeerDirectory({
    enabled: config.ipfsEnabled,
    keymaster,
    ipfs,
    getLocalIpfsId: () => nodeInfo?.ipfs?.id ?? null,
});
let negentropyCoordinator: ReturnType<typeof createNegentropyCoordinator>;
let peerSyncCoordinator: ReturnType<typeof createPeerSyncCoordinator>;
let transport: ReturnType<typeof createHyperswarmTransport>;

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
        getConnection: peerKey => transport.getConnection(peerKey),
        createSessionId,
        createBaseMessage,
        sendToPeer: (peerKey, message) => transport.sendToPeer(peerKey, message),
        onIndexRefreshed: (source, sync) => peerSyncCoordinator.handleIndexRefreshed(source, sync),
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
        getConnection: peerKey => transport.getConnection(peerKey),
        createSessionId,
        createBaseMessage,
        sendToPeer: (peerKey, message) => transport.sendToPeer(peerKey, message),
        canStartBackgroundPrebuild: () => peerSyncCoordinator.canStartBackgroundPrebuild(),
        terminatePeerConnection: (peerKey, reason) => transport.terminatePeer(peerKey, reason),
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
    getPeerKeys: () => transport.getPeerKeys(),
    getConnection: peerKey => transport.getConnection(peerKey),
    getSyncStore: () => syncStore,
    getImportPipeline: () => importPipeline,
    getNegentropyCoordinator: () => negentropyCoordinator,
    getOrderedCatchupCoordinator: () => orderedCatchupCoordinator,
    waitForInitialPing: (peerKey, connection) => transport.waitForInitialPing(peerKey, connection),
    onPeersAdvertised: dids => peerDirectory.addPeers(dids),
});

const queueCoordinator = createQueueCoordinator({
    registry: REGISTRY,
    gatekeeper,
    cipher,
    syncStats,
    getImportPipeline: () => importPipeline,
    getNodeKey: () => nodeKey,
    createQueueMessage: () => createBaseMessage('queue'),
    relay: message => transport.relay(message),
});

transport = createHyperswarmTransport({
    framingVersion: TRANSPORT_FRAMING_VERSION,
    syncStats,
    buildInitialPing: buildPingMessage,
    onPing: (peerKey, message, connection) => peerSyncCoordinator.handlePing(peerKey, message, connection),
    onQueue: (peerKey, message) => queueCoordinator.handleMessage(peerKey, message),
    onSyncMessage: (peerKey, message) => peerSyncCoordinator.handleMessage(peerKey, message),
    onDisconnected: (peerKey, reason) => peerSyncCoordinator.handleDisconnected(peerKey, reason),
    onQuarantined: (peerKey, reason, connection) => peerSyncCoordinator.handleQuarantined(peerKey, reason, connection),
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

goodbye(async () => {
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

    swarm.on('connection', conn => transport.addConnection(conn));

    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();

    const shortTopic = shortName(b4a.toString(topic, 'hex'));
    log.info(`new hyperswarm peer id: ${shortName(nodeKey)} (${config.nodeName}) joined topic: ${shortTopic} using protocol: ${config.protocol}`);
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

async function buildPingMessage(): Promise<PingMessage> {
    const capabilities = await peerSyncCoordinator.buildCapabilities();

    return {
        ...createBaseMessage('ping'),
        peers: peerDirectory.getKnownDids(),
        capabilities,
        transportFramingVersion: TRANSPORT_FRAMING_VERSION,
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

async function syncGatekeeperIndexToStore(source: string): Promise<void> {
    const sync = await importPipeline.refreshIndex(source);
    await peerSyncCoordinator.handleIndexRefreshed(source, sync);
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
        await queueCoordinator.flush();
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
    transport.expireStaleConnections();

    if (transport.getPeerKeys().length === 0) {
        log.warn("No active connections, rejoining the topic...");
        await createSwarm();
    }
}

async function connectionLoop(): Promise<void> {
    try {
        log.debug(`Node info: ${JSON.stringify(nodeInfo, null, 4)}`);
        log.info(`Connected to hyperswarm protocol: ${config.protocol}`);

        await checkConnections();

        const msg = await buildPingMessage();

        await transport.relay(msg);
        await peerSyncCoordinator.runPeriodicRepairs();

        log.debug({ syncStats: buildSyncStatsSnapshot(syncStats) }, 'hyperswarm sync stats');

        if (config.ipfsEnabled) {
            const peeringPeers = await ipfs.getPeeringPeers();
            console.log(`IPFS peers: ${peeringPeers.length}`);
            for (const peer of peeringPeers) {
                log.debug(`* peer ${peer.ID} (${peerDirectory.getPeerName(peer.ID)})`);
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

    await negentropyCoordinator.initializeAdapter();

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

        peerDirectory.registerNode(nodeDID);
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
        transport.reset();
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

        transport.setConnection(peerKey, {
            ...createConnectionInfo({
                connection,
                peerKey,
                peerName: shortName(peerKey),
                nodeName: 'test-peer',
            }),
            peerTransportFramingVersion: TRANSPORT_FRAMING_VERSION,
            ...connectionInfoOverrides,
        } as ConnectionInfo);
    },

    disconnectPeer(peerKey: string): void {
        transport.closePeer(peerKey);
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
            const conn = transport.getConnection(peerKey);
            if (conn) {
                conn.syncMode = 'negentropy';
                conn.syncStarted = true;
            }
        }
    },

    async receiveMsg(peerKey: string, msg: Record<string, unknown>): Promise<void> {
        await transport.receiveMessage(peerKey, msg);
    },

    async processInboundPeerData(peerKey: string, chunk: Buffer | string): Promise<void> {
        await transport.processInboundPeerData(peerKey, chunk);
    },

    async sendPingToPeer(peerKey: string): Promise<void> {
        await transport.sendInitialPing(peerKey);
    },

    getConnectionState(peerKey: string): Record<string, unknown> | null {
        const conn = transport.getConnection(peerKey);
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
