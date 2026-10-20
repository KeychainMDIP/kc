import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { HyperswarmConnection } from 'hyperswarm';
import type { Operation } from '@mdip/gatekeeper/types';
import { generateCID } from '@mdip/ipfs/utils';
import TestHelper from '../gatekeeper/helper.ts';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import { createBulkWorkScheduler } from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';
import { createHyperswarmTransport } from '../../services/mediators/hyperswarm/src/hyperswarm-transport.ts';
import { createImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import { createNegentropyCoordinator } from '../../services/mediators/hyperswarm/src/negentropy-coordinator.ts';
import { normalizePeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';
import { createPeerDirectory } from '../../services/mediators/hyperswarm/src/peer-directory.ts';
import { createQueueCoordinator } from '../../services/mediators/hyperswarm/src/queue-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { encodeFramedMessage, decodeFramedMessages } from '../../services/mediators/hyperswarm/src/transport-framing.ts';

const limits = {
    maxIdsPerRequest: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
    maxFrameBytes: 0, maxRecordsPerWindow: 25_000,
};
const base = { node: 'test', time: '', relays: [] };
const ping = {
    ...base, type: 'ping' as const, peers: [], transportFramingVersion: 1,
    capabilities: { negentropy: true, negentropyVersion: 2 },
};

class Socket extends EventEmitter {
    readonly remotePublicKey: Buffer;
    destroyed = false;
    lastWrite = Buffer.alloc(0);
    blocked = false;
    releaseWrite?: () => void;

    constructor(id: number) {
        super();
        this.remotePublicKey = Buffer.from(id.toString(16).padStart(64, '0'), 'hex');
    }
    get key() { return this.remotePublicKey.toString('hex'); }
    write(data: Uint8Array) { this.lastWrite = Buffer.from(data); return true; }
    flush(): Promise<boolean> {
        return this.blocked
            ? new Promise(resolve => { this.releaseWrite = () => resolve(true); })
            : Promise.resolve(true);
    }
    pause() {}
    resume() {}
    destroy() { this.destroyed = true; this.emit('close'); }
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function createHarness() {
    const stats = createMediatorSyncStats();
    const cipher = new CipherNode();
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hostile-peer'), registries: ['hyperswarm'], ipfsEnabled: false,
    });
    const store = new InMemoryOperationSyncStore();
    await store.start();
    const bulkReads = createBulkWorkScheduler(2);
    const pages = createOperationPageBudget(5, 5 * limits.maxBytesPerPush);
    const pipeline = createImportPipeline({
        gatekeeper: {
            isReady: async () => true,
            importBatch: batch => gatekeeper.importBatch(batch),
            processEvents: () => gatekeeper.processEvents(),
            exportIndex: async () => { throw new Error('unexpected index refresh'); },
        },
        cipher, syncStore: store, syncStats: stats, retryDelayMs: 300_000,
        beginStoreMutation: () => () => undefined, onStoreChanged: () => undefined,
    });
    let queue!: ReturnType<typeof createQueueCoordinator>;
    let negentropy!: ReturnType<typeof createNegentropyCoordinator>;
    const transport = createHyperswarmTransport({
        framingVersion: 1, requiredNegentropyVersion: 2, payloadLimits: limits, syncStats: stats,
        maxPeerStates: 4, maxMessageBytes: 1024 * 1024,
        maxOutboundBytesPerConnection: 4096, maxOutboundBytesTotal: 8192,
        buildInitialPing: async () => ping,
        onPing: (_key, message, connection) => {
            connection.capabilities = normalizePeerCapabilities(message.capabilities);
        },
        onQueue: (key, message, connection) => queue.handleMessage(key, message, connection),
        onSyncMessage: (key, message) => {
            if (message.type === 'ordered_catchup_push' || message.type === 'ordered_catchup_done'
                || message.type === 'ordered_catchup_req') { return; }
            return negentropy.handleMessage(key, message);
        },
        onDisconnected: (key, reason, connection) => {
            queue.handleDisconnected(key, reason, connection);
            negentropy.removePeer(key, reason);
        },
    });
    negentropy = createNegentropyCoordinator({
        version: 2, transportFramingVersion: 1, frameSizeLimit: 0,
        maxRecordsPerWindow: 25_000, maxRoundsPerSession: 64,
        maxIdsPerRequest: 1_000, maxIdsPerLookup: 32,
        maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
        idleTimeoutMs: 120_000, repairIntervalMs: 300_000,
        syncStore: store, importPipeline: pipeline, syncStats: stats, cipher, bulkReads,
        operationPages: pages,
        getConnection: key => transport.getConnection(key),
        createSessionId: key => `session-${key}`,
        createBaseMessage: type => ({ ...base, type }),
        sendToPeer: (key, message) => transport.sendToPeer(key, message),
        sendBulkToPeer: (key, message) => transport.sendBulkToPeer(key, message),
        canStartBackgroundPrebuild: () => false,
        onProtocolViolation: (key, reason, connection) => transport.reportProtocolViolation(key, reason, connection),
        terminatePeerConnection: (key, reason) => transport.terminatePeer(key, reason),
        onSessionClosed: () => undefined,
    });
    const repair = jest.fn(async () => false);
    queue = createQueueCoordinator({
        registry: 'hyperswarm', maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024,
        repairIntervalMs: 300_000, gatekeeper, cipher, syncStats: stats, bulkReads,
        operationPages: pages, getImportPipeline: () => pipeline, getNodeKey: () => 'local',
        getConnection: key => transport.getConnection(key), requestRepair: repair,
        createQueueMessage: () => ({ ...base, type: 'queue' }), relay: message => transport.relay(message),
        onProtocolViolation: (key, reason, connection) => transport.reportProtocolViolation(key, reason, connection),
    });
    async function send(socket: Socket, message: unknown) {
        await transport.processInboundPeerData(socket.key, encodeFramedMessage(JSON.stringify(message)));
    }
    async function connect(id: number) {
        const socket = new Socket(id);
        transport.addConnection(socket as unknown as HyperswarmConnection);
        const connection = transport.getConnection(socket.key);
        if (connection) { await connection.initialPingPromise; await send(socket, ping); }
        return socket;
    }
    return {
        stats, cipher, gatekeeper, store, pages, pipeline, queue, transport, negentropy, repair, send, connect,
        async close() {
            await Promise.all([transport.shutdown(), queue.shutdown(), negentropy.shutdown(), bulkReads.shutdown()]);
            await pipeline.shutdown();
            await store.stop();
        },
    };
}

describe('hostile peer integration', () => {
    it('bounds concurrent gossip, outcomes, bytes and quarantine under peer churn', async () => {
        const h = await createHarness();
        const blockedImport = deferred();
        const started = deferred();
        const originalImport = h.gatekeeper.importBatch.bind(h.gatekeeper);
        jest.spyOn(h.gatekeeper, 'importBatch').mockImplementation(async events => {
            started.resolve(); await blockedImport.promise; return originalImport(events);
        });
        try {
            const sockets: Socket[] = [];
            for (let id = 1; id <= 70; id += 1) { sockets.push(await h.connect(id)); }
            expect(h.transport.getAccounting().connections).toBe(64);
            expect(sockets.slice(64).every(socket => socket.destroyed)).toBe(true);
            expect(h.stats.hardening.connectionCapacityRefusals).toBe(6);

            const helper = new TestHelper(h.gatekeeper, h.cipher);
            const valid = await helper.createAgentOp(h.cipher.generateRandomJwk(), { registry: 'hyperswarm' });
            const message = (operation: Operation) => ({ ...base, type: 'queue', data: [operation] });
            const first = h.send(sockets[0], message(valid));
            await started.promise;
            const secondOp = await helper.createAgentOp(h.cipher.generateRandomJwk(), { registry: 'hyperswarm' });
            const second = h.send(sockets[1], message(secondOp));
            await new Promise(resolve => setImmediate(resolve));
            expect(h.queue.getMetrics().admitted).toBe(2);

            for (let index = 0; index < 4_200; index += 1) {
                const unsigned = { type: 'create' as const, created: String(index), mdip: valid.mdip };
                const operation = { ...unsigned, signature: {
                    signed: valid.signature!.signed, hash: h.cipher.hashJSON(unsigned), value: 'fake-signature',
                } };
                await h.send(sockets[2], message(operation));
                expect(h.queue.getMetrics().recentOutcomes).toBeLessThanOrEqual(4_096);
            }
            expect(h.queue.getMetrics()).toEqual({ admitted: 2, inFlight: 2, recentOutcomes: 4_096, repairsPending: 1 });
            expect(h.pipeline.queued + h.pipeline.running).toBe(2);
            expect(h.pages.pages).toBe(2);
            expect(h.pages.bytes).toBeLessThanOrEqual(5 * 512 * 1024);
            expect(h.transport.getAccounting().inboundBytes).toBeLessThanOrEqual(1024 * 1024 + 2 * (512 * 1024 + 65540) + 4);
            expect(h.stats.protocolViolationCooldowns).toBe(0);
            expect(h.stats.hardening.gossipRepairsScheduled).toBe(1);

            // Flood valid-shaped messages without letting the socket drain.
            const output: Promise<boolean>[] = [];
            sockets[3].blocked = true;
            for (let index = 0; index < 30; index += 1) {
                output.push(h.transport.sendBulkToPeer(sockets[3].key, { ...base, type: 'queue', data: [valid] }));
            }
            expect(h.transport.getAccounting().outboundBytes).toBeLessThanOrEqual(8192);
            expect(h.stats.hardening.outboundBudgetRefusals).toBeGreaterThan(0);
            h.transport.terminatePeer(sockets[3].key, 'test_output_drain');
            await Promise.all(output);
            expect(h.transport.getAccounting().outboundBytes).toBe(0);

            blockedImport.resolve();
            await Promise.all([first, second]);
            expect(await h.store.count()).toBe(2);
            expect(h.queue.getMetrics().admitted).toBe(0);
            expect(h.pages.bytes).toBe(0);
            expect(h.stats.hardening.gossipOverloadDrops).toBe(4_200);
            h.repair.mockResolvedValueOnce(true);
            await h.queue.runRepairs();
            expect(h.stats.hardening.gossipRepairsStarted).toBe(1);

            for (let index = 4; index < 12; index += 1) {
                await h.send(sockets[index], { ...base, type: 'queue', data: Array(301).fill(valid) });
                expect(sockets[index].destroyed).toBe(true);
                const reconnect = await h.connect(index + 1);
                expect(reconnect.destroyed).toBe(true);
                expect(h.transport.getSecurityMetrics().total).toBeLessThanOrEqual(4);
            }
            expect(h.stats.hardening.oversizedOperationMessages).toBe(8);
            expect(h.stats.protocolViolationConnectionsRejected).toBe(8);
            expect(h.transport.getSecurityMetrics().evictions).toBe(4);
            // Recreating the swarm reuses this transport and its quarantine.
            for (const key of h.transport.getPeerKeys()) { h.transport.terminatePeer(key, 'swarm_recreated'); }
            expect((await h.connect(12)).destroyed).toBe(true);
        }
        finally { blockedImport.resolve(); await h.close(); }
    });

    it('keeps history-relative rejection portable but never retains unaddressable data', async () => {
        const h = await createHarness();
        try {
            const peer = await h.connect(1);
            await h.connect(2);
            const helper = new TestHelper(h.gatekeeper, h.cipher);
            const rejected = await helper.createAgentOp(h.cipher.generateRandomJwk(), { registry: 'hyperswarm' });
            rejected.signature!.value = '0'.repeat(128);
            await h.send(peer, { ...base, type: 'queue', data: [rejected] });
            expect(await h.store.count()).toBe(1);
            expect(h.stats.hardening.terminalRecordsPersisted).toBe(1);
            expect(h.stats.protocolViolationCooldowns).toBe(0);
            expect(h.stats.hardening.gossipShareableOperations).toBe(1);
            expect(h.stats.hardening.gossipOperationsRelayed).toBe(1);

            const invalid = structuredClone(rejected);
            invalid.created = 'tampered';
            await h.send(peer, { ...base, type: 'queue', data: [invalid] });
            expect(peer.destroyed).toBe(true);
            expect(h.stats.hardening.malformedQueueOperations).toBe(1);
            expect(await h.store.count()).toBe(1);
            expect(h.queue.getMetrics().inFlight).toBe(0);
        }
        finally { await h.close(); }
    });

    it('rejects unsolicited Negentropy data without importing or retaining it', async () => {
        const h = await createHarness();
        try {
            const peer = await h.connect(1);
            await h.negentropy.initializeAdapter();
            expect(await h.negentropy.startSession(peer.key, { source: 'connect', modeReason: null, initiator: true })).toBe(true);
            const open = JSON.parse(decodeFramedMessages(peer.lastWrite).messages[0].toString());
            await h.send(peer, { ...base, type: 'ops_push', sessionId: open.sessionId,
                windowId: open.windowId, round: open.round, requestId: 999, page: 0,
                hasMore: false, data: [],
            });
            expect(peer.destroyed).toBe(true);
            expect(await h.store.count()).toBe(0);
            expect(h.stats.hardening.unauthorizedNegentropyMessages).toBe(1);
            expect(h.pages.bytes).toBe(0);
        }
        finally { await h.close(); }
    });

    it('bounds advertised peer resolution and preserves the operator Kubo baseline', async () => {
        const stats = createMediatorSyncStats();
        const blocked = deferred();
        const peers = [{ ID: 'operator', Addrs: ['operator-address'] }];
        const directory = createPeerDirectory({
            enabled: true, getLocalIpfsId: () => 'local',
            limits: { maxQueued: 8, maxConcurrent: 2, maxRecords: 3, maxFailures: 3, maxKuboPeers: 4 },
            keymaster: { resolveDID: async did => {
                await blocked.promise;
                return { didDocumentData: { node: { name: did, ipfs: {
                    id: did, addresses: ['address'],
                } } } };
            } },
            ipfs: {
                getPeeringPeers: async () => structuredClone(peers),
                addPeeringPeer: async (id, addresses) => { peers.push({ ID: id, Addrs: addresses }); },
                removePeeringPeer: async id => { peers.splice(peers.findIndex(peer => peer.ID === id), 1); },
            },
        });
        const transport = createHyperswarmTransport({
            framingVersion: 1, requiredNegentropyVersion: 2, payloadLimits: limits, syncStats: stats,
            buildInitialPing: async () => ping, onPing: (_key, message) => directory.addPeers(message.peers),
            onQueue: () => undefined, onSyncMessage: () => undefined, onDisconnected: () => undefined,
        });
        try {
            await directory.initialize();
            const dids = await Promise.all(Array.from({ length: 40 }, async (_, id) => `did:test:${await generateCID({ id })}`));
            for (let id = 1; id <= 3; id += 1) {
                const socket = new Socket(id);
                transport.addConnection(socket as unknown as HyperswarmConnection);
                await transport.getConnection(socket.key)!.initialPingPromise;
                await transport.processInboundPeerData(socket.key, encodeFramedMessage(JSON.stringify({ ...ping, peers: dids })));
            }
            expect(directory.getMetrics()).toMatchObject({ queued: 8, active: 2, records: 0 });
            expect(directory.getMetrics().admissionDrops).toBeGreaterThan(0);
            blocked.resolve();
            await directory.waitForIdle();
            expect(directory.getMetrics().records).toBeLessThanOrEqual(3);
            expect(directory.getMetrics().failed).toBeLessThanOrEqual(3);
            expect(peers.length).toBe(4);
            expect(peers[0]).toEqual({ ID: 'operator', Addrs: ['operator-address'] });
            expect(directory.getMetrics().kuboCapacityRefusals).toBeGreaterThan(0);
            expect(stats.protocolViolationCooldowns).toBe(0);
        }
        finally { blocked.resolve(); await transport.shutdown(); await directory.shutdown(); }
    });
});
