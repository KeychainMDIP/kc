import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { Operation } from '@mdip/gatekeeper/types';
import { jest } from '@jest/globals';

import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import {
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    normalizePeerCapabilities,
} from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import {
    decodeUnknownTransportMessages,
    encodeFramedMessage,
} from '../../services/mediators/hyperswarm/src/transport-framing.ts';
import TestHelper from '../gatekeeper/helper.ts';
import {
    createMediatorNode,
    getMediatorNodeContext,
    installMediatorMocks,
    type MediatorNode,
} from './hyperswarm-mediator-harness.ts';
import {
    createRecordingDuplexPair,
    type RecordingDuplexPair,
} from './recording-duplex.ts';

installMediatorMocks();

const FRAMING_VERSION = 1;
const NEGENTROPY_VERSION = 1;
const hash = (char: string) => char.repeat(64);

interface ProtocolNode {
    node: MediatorNode;
    store: InMemoryOperationSyncStore;
    adapter: NegentropyAdapter;
}

interface AttachedPeer {
    peerKey: string;
    pair: RecordingDuplexPair;
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

async function eventually(assertion: () => boolean | Promise<boolean>, turns = 100): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) {
        if (await assertion()) {
            return;
        }
        await nextTurn();
    }
    throw new Error(`observable mediator condition did not settle after ${turns} turns`);
}

function compatibleCapabilities(overrides: Record<string, unknown> = {}) {
    return normalizePeerCapabilities({
        negentropy: true,
        negentropyVersion: NEGENTROPY_VERSION,
        orderedCatchup: false,
        ...overrides,
    });
}

function peerPing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'ping',
        time: new Date().toISOString(),
        node: 'peer',
        peers: [],
        capabilities: {
            negentropy: true,
            negentropyVersion: NEGENTROPY_VERSION,
        },
        transportFramingVersion: FRAMING_VERSION,
        ...overrides,
    };
}

function decodeWrites(pair: RecordingDuplexPair): Array<Record<string, unknown>> {
    return pair.transcript.flatMap(entry => {
        const decoded = decodeUnknownTransportMessages(entry.raw);
        return decoded.messages.map(message => JSON.parse(message.toString('utf8')) as Record<string, unknown>);
    });
}

async function makeOperations(count: number): Promise<Operation[]> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-protocol-fixtures'),
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const operations: Operation[] = [];

    for (let index = 0; index < count; index += 1) {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk(), {
            registry: 'hyperswarm',
        });
        operation.signature!.signed = new Date(Date.now() - ((count - index + 1) * 60_000)).toISOString();
        operations.push(operation);
    }
    return operations;
}

describe('hyperswarm mediator protocol characterization', () => {
    const nodes: MediatorNode[] = [];
    const pairs: RecordingDuplexPair[] = [];
    let nodeNumber = 0;

    async function createNode(options: {
        keyByte?: number;
        env?: Record<string, string | undefined>;
        maxRecords?: number;
        maxRounds?: number;
    } = {}): Promise<ProtocolNode> {
        const maxRecords = options.maxRecords ?? 16;
        const maxRounds = options.maxRounds ?? 8;
        const node = await createMediatorNode({
            name: `protocol-node-${++nodeNumber}`,
            publicKey: Buffer.alloc(32, options.keyByte ?? 0x11),
            env: {
                KC_HYPR_NEGENTROPY_ENABLE: 'true',
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'false',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'true',
                KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW: String(maxRecords),
                KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION: String(maxRounds),
                ...options.env,
            },
        });
        nodes.push(node);

        const store = new InMemoryOperationSyncStore();
        await store.start();
        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            maxRecordsPerWindow: maxRecords,
            maxRoundsPerSession: maxRounds,
            deferInitialBuild: true,
        });
        node.run(() => {
            const context = getMediatorNodeContext();
            context.syncStore = store;
            context.negentropyAdapter = adapter;
            node.mediator.__test.setSyncStore(store);
            node.mediator.__test.setNegentropyAdapter(adapter);
        });
        return { node, store, adapter };
    }

    function attachPeer(
        protocolNode: ProtocolNode,
        options: {
            peerKeyByte?: number;
            mode?: 'unknown' | 'framed' | 'legacy';
            overrides?: Record<string, unknown>;
        } = {},
    ): AttachedPeer {
        const publicKeyB = Buffer.alloc(32, options.peerKeyByte ?? 0x22);
        const peerKey = publicKeyB.toString('hex');
        const pair = createRecordingDuplexPair({
            publicKeyA: protocolNode.node.publicKey,
            publicKeyB,
            receiveAtA: async () => undefined,
            receiveAtB: async () => undefined,
        });
        pairs.push(pair);

        const mode = options.mode ?? 'unknown';
        protocolNode.node.run(() => protocolNode.node.mediator.__test.addConnection(peerKey, {
            connection: pair.connectionA,
            ...(mode === 'framed' && {
                capabilities: compatibleCapabilities(),
                transportMode: 'framed',
                inboundTransportMode: 'framed',
                peerTransportFramingVersion: FRAMING_VERSION,
            }),
            ...(mode === 'legacy' && {
                transportMode: 'legacy',
                inboundTransportMode: 'legacy',
            }),
            ...options.overrides,
        }));
        return { peerKey, pair };
    }

    afterEach(async () => {
        for (const pair of pairs.splice(0).reverse()) {
            await pair.destroy();
        }
        for (const node of nodes.splice(0).reverse()) {
            await node.dispose();
        }
        jest.restoreAllMocks();
    });

    it('sends one raw initial ping then negotiates framed Negentropy traffic', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendPingToPeer(peerKey, 'initial'));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendPingToPeer(peerKey, 'initial'));
        expect(pair.transcript).toHaveLength(1);
        expect(pair.transcript[0]).toMatchObject({ messageType: 'ping', transportMode: 'legacy' });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            Buffer.from(JSON.stringify(peerPing())),
        ));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendPingToPeer(peerKey, 'periodic'));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({
            syncMode: 'negentropy',
            transportMode: 'framed',
            inboundTransportMode: 'framed',
            peerTransportFramingVersion: FRAMING_VERSION,
            activeSession: { mode: 'negentropy' },
        });
        expect(pair.transcript.slice(1).map(entry => [entry.messageType, entry.transportMode])).toEqual(
            expect.arrayContaining([
                ['neg_open', 'framed'],
                ['ping', 'framed'],
            ]),
        );
    });

    it.each([
        ['missing capabilities', undefined, FRAMING_VERSION, 'legacy'],
        ['version mismatch', { negentropy: true, negentropyVersion: 2 }, FRAMING_VERSION, 'legacy'],
        ['framing mismatch', { negentropy: true, negentropyVersion: 1 }, 2, 'legacy'],
    ])('falls back for %s', async (
        _case,
        capabilities,
        transportFramingVersion,
        expectedMode,
    ) => {
        const protocolNode = await createNode();
        const { peerKey } = attachPeer(protocolNode);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, peerPing({
            capabilities,
            transportFramingVersion,
        })));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({ syncMode: expectedMode, activeSession: { mode: 'legacy' } });
    });

    it('selects no mode for an incompatible peer when legacy synchronization is disabled', async () => {
        const protocolNode = await createNode({
            env: { KC_HYPR_LEGACY_SYNC_ENABLE: 'false' },
        });
        const { peerKey, pair } = attachPeer(protocolNode);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, peerPing({
            capabilities: { negentropy: true, negentropyVersion: 2 },
        })));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({ syncMode: 'unknown', activeSession: null });
        expect(pair.transcript).toHaveLength(0);
    });

    it.each([
        ['lower local key initiates', 0x11, 0x22, true],
        ['higher local key waits', 0x33, 0x22, false],
    ])('%s', async (_case, localKeyByte, peerKeyByte, shouldInitiate) => {
        const protocolNode = await createNode({ keyByte: localKeyByte });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte, mode: 'framed' });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );

        expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(shouldInitiate);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual(shouldInitiate ? expect.objectContaining({ mode: 'negentropy' }) : null);
    });

    it('buffers fragmented frames and processes coalesced frames in order', async () => {
        const operations = await makeOperations(2);
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey } = attachPeer(protocolNode);
        const pingFrame = encodeFramedMessage(JSON.stringify(peerPing()));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            pingFrame.subarray(0, 3),
        ));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.transportMode,
        )).toBe('unknown');
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            pingFrame.subarray(3),
        ));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.transportMode,
        )).toBe('framed');

        const coalesced = Buffer.concat(operations.map(operation => encodeFramedMessage(JSON.stringify({
            type: 'batch',
            data: [operation],
        }))));
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, coalesced),
        );
        await eventually(async () => (await protocolNode.store.count()) === 2);
        expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(2);
    });

    it('transitions from a raw ping to a framed message in the same chunk', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey } = attachPeer(protocolNode);
        const chunk = Buffer.concat([
            Buffer.from(JSON.stringify(peerPing())),
            encodeFramedMessage(JSON.stringify({ type: 'batch', data: [operation] })),
        ]);

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, chunk),
        );
        await eventually(async () => (await protocolNode.store.count()) === 1);

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({ transportMode: 'framed', inboundTransportMode: 'framed' });
    });

    it.each([
        ['malformed framed header', Buffer.alloc(4)],
        ['malformed legacy prefix', Buffer.from('not-json')],
    ])('terminates a peer after %s', async (_case, payload) => {
        const protocolNode = await createNode();
        const mode = payload[0] === 0 ? 'framed' : 'unknown';
        const { peerKey, pair } = attachPeer(protocolNode, { mode });
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, payload),
        );

        expect(destroySpy).toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('preserves an incomplete frame without terminating the peer', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');
        const frame = encodeFramedMessage(JSON.stringify(peerPing()));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            frame.subarray(0, frame.length - 1),
        ));

        expect(destroySpy).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).not.toBeNull();
    });

    it('replaces Negentropy sessions and ignores stale sessions and windows', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...open,
            sessionId: 'remote-session',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: 'remote-session' });

        const writesBefore = pair.transcript.length;
        const importsBefore = protocolNode.node.gatekeeperClient.importBatch.mock.calls.length;
        for (const message of [
            { type: 'neg_msg', sessionId: 'stale', windowId: open.windowId, frame: open.frame },
            { type: 'ops_req', sessionId: 'remote-session', windowId: 'stale-window', ids: [hash('a')] },
            { type: 'ops_push', sessionId: 'remote-session', windowId: 'stale-window', data: [] },
            { type: 'neg_close', sessionId: 'stale', windowId: open.windowId, reason: 'complete' },
        ]) {
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.receiveMsg(peerKey, message),
            );
        }
        expect(pair.transcript).toHaveLength(writesBefore);
        expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(importsBefore);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: 'remote-session' });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: 'remote-session',
            windowId: open.windowId,
            reason: 'complete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('closes a session when sending neg_open throws', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        jest.spyOn(pair.connectionA, 'write').mockImplementation(() => {
            throw new Error('write failed');
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('starts eligible periodic repair without requiring a timer loop', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {
            mode: 'framed',
            overrides: {
                syncMode: 'negentropy',
                syncStarted: true,
                lastNegentropyAttemptAt: 0,
                negentropySynced: false,
            },
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey, 'periodic'),
        );

        expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual(expect.objectContaining({ mode: 'negentropy' }));
    });

    it('closes a session when a one-record window reaches its round limit', async () => {
        const [localOperation, peerOperation] = await makeOperations(2);
        const protocolNode = await createNode({ maxRecords: 1, maxRounds: 1 });
        const peerStore = new InMemoryOperationSyncStore();
        await peerStore.start();
        const peerStopSpy = jest.spyOn(peerStore, 'stop');
        const peerAdapter = await NegentropyAdapter.create({
            syncStore: peerStore,
            maxRecordsPerWindow: 1,
            maxRoundsPerSession: 1,
            deferInitialBuild: true,
        });
        const toRecord = (operation: Operation) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        });
        await protocolNode.store.upsertMany([toRecord(localOperation)]);
        await peerStore.upsertMany([toRecord(peerOperation)]);
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });

        try {
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
            );
            const open = decodeWrites(pair).find(message => message.type === 'neg_open') as any;
            if (!open) {
                throw new Error('expected local neg_open');
            }
            const peerSnapshot = await peerAdapter.buildSnapshotForWindow(open.window);
            const peerEngine = peerAdapter.createEngineForSnapshot(peerSnapshot);
            const peerFirst = await peerEngine.reconcile(decodeNegentropyFrame(open.frame));
            if (peerFirst.nextMsg === null) {
                throw new Error('expected a multi-round Negentropy exchange');
            }

            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                type: 'neg_msg',
                sessionId: open.sessionId,
                windowId: open.windowId,
                frame: encodeNegentropyFrame(peerFirst.nextMsg!),
            }));
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                type: 'neg_msg',
                sessionId: open.sessionId,
                windowId: open.windowId,
                frame: encodeNegentropyFrame(peerFirst.nextMsg!),
            }));

            expect(decodeWrites(pair).filter(message => message.type === 'neg_close').at(-1)).toMatchObject({
                reason: 'max_rounds_reached',
            });
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toBeNull();
        }
        finally {
            await peerStore.stop();
            expect(peerStopSpy).toHaveBeenCalledTimes(1);
        }
    });

    it('imports queue gossip, suppresses relays, and filters known operations', async () => {
        const [knownOperation, newOperation] = await makeOperations(2);
        const protocolNode = await createNode({ keyByte: 0x44 });
        const source = attachPeer(protocolNode, { peerKeyByte: 0x11, mode: 'framed' });
        const excluded = attachPeer(protocolNode, { peerKeyByte: 0x22, mode: 'framed' });
        const recipient = attachPeer(protocolNode, { peerKeyByte: 0x33, mode: 'framed' });

        const queueMessage = {
            type: 'queue',
            relays: [excluded.peerKey],
            data: [knownOperation],
        };
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(source.peerKey, queueMessage),
        );
        await eventually(async () => await protocolNode.store.has(knownOperation.signature!.hash));

        expect(source.pair.transcript).toHaveLength(0);
        expect(excluded.pair.transcript).toHaveLength(0);
        expect(recipient.pair.transcript.map(entry => entry.messageType)).toEqual(['queue']);

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(source.peerKey, queueMessage),
        );
        expect(recipient.pair.transcript).toHaveLength(1);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(source.peerKey, {
            type: 'batch',
            data: [knownOperation, newOperation],
        }));
        await eventually(async () => await protocolNode.store.has(newOperation.signature!.hash));

        const lastImport = protocolNode.node.gatekeeperClient.importBatch.mock.calls.at(-1)?.[0] ?? [];
        expect(lastImport.map(event => event.operation.signature?.hash)).toEqual([newOperation.signature!.hash]);
        expect(await protocolNode.store.count()).toBe(2);
    });

    it('serves ordered catch-up pages and validates request cursors', async () => {
        const operations = await makeOperations(2);
        const protocolNode = await createNode({
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        await protocolNode.store.upsertMany(operations.map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const { peerKey, pair } = attachPeer(protocolNode, {
            mode: 'framed',
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                    operationCount: 0,
                    orderedOperationCount: 0,
                }),
            },
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendOrderedCatchupPage(peerKey, {
            type: 'ordered_catchup_req',
            sessionId: 'server-session',
        } as any));
        const push = decodeWrites(pair).at(-1);
        expect(push).toMatchObject({
            type: 'ordered_catchup_push',
            sessionId: 'server-session',
            hasMore: false,
            cursor: { syncOrder: 2, id: operations[1].signature!.hash },
        });
        expect((push?.data as Operation[]).map(operation => operation.signature!.hash)).toEqual(
            operations.map(operation => operation.signature!.hash),
        );

        const writesBefore = pair.transcript.length;
        for (const cursor of [-1, 'bad', { syncOrder: -1, id: hash('a') }, { syncOrder: 1, id: 'bad' }]) {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendOrderedCatchupPage(peerKey, {
                type: 'ordered_catchup_req',
                sessionId: 'invalid-session',
                cursor,
            } as any));
        }
        expect(pair.transcript).toHaveLength(writesBefore);
    });

    it('rejects unsupported ordered catch-up and finishes disabled or unready requests', async () => {
        const request = {
            type: 'ordered_catchup_req',
            sessionId: 'server-session',
        } as any;
        const orderedCapabilities = compatibleCapabilities({
            orderedCatchup: true,
            orderedCatchupVersion: 1,
            orderedCatchupReady: true,
        });

        const unsupportedNode = await createNode({
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        const unsupportedPeer = attachPeer(unsupportedNode, { mode: 'framed' });
        await unsupportedNode.node.run(
            () => unsupportedNode.node.mediator.__test.sendOrderedCatchupPage(unsupportedPeer.peerKey, request),
        );
        expect(unsupportedPeer.pair.transcript).toHaveLength(0);

        const disabledNode = await createNode({
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'false' },
        });
        const disabledPeer = attachPeer(disabledNode, {
            mode: 'framed',
            overrides: { capabilities: orderedCapabilities },
        });
        await disabledNode.node.run(
            () => disabledNode.node.mediator.__test.sendOrderedCatchupPage(disabledPeer.peerKey, request),
        );
        expect(decodeWrites(disabledPeer.pair).at(-1)).toMatchObject({ type: 'ordered_catchup_done' });

        const emptyNode = await createNode({
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        const emptyPeer = attachPeer(emptyNode, {
            mode: 'framed',
            overrides: { capabilities: orderedCapabilities },
        });
        await emptyNode.node.run(
            () => emptyNode.node.mediator.__test.sendOrderedCatchupPage(emptyPeer.peerKey, request),
        );
        expect(decodeWrites(emptyPeer.pair).at(-1)).toMatchObject({ type: 'ordered_catchup_done' });

        const [operation] = await makeOperations(1);
        const unorderedNode = await createNode({
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        await unorderedNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const unorderedPeer = attachPeer(unorderedNode, {
            mode: 'framed',
            overrides: { capabilities: orderedCapabilities },
        });
        await unorderedNode.node.run(
            () => unorderedNode.node.mediator.__test.sendOrderedCatchupPage(unorderedPeer.peerKey, request),
        );
        expect(decodeWrites(unorderedPeer.pair).at(-1)).toMatchObject({ type: 'ordered_catchup_done' });
    });

    it('handles ordered catch-up push, done, stale sessions, and invalid cursors', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode({
            keyByte: 0x33,
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22, mode: 'framed' });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'client-session'),
        );

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'stale-session',
            cursor: { syncOrder: 1, id: operation.signature!.hash },
            hasMore: true,
            data: [operation],
        }));
        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'client-session',
            cursor: { syncOrder: 1, id: operation.signature!.hash },
            hasMore: true,
            data: [operation],
        }));
        await eventually(async () => await protocolNode.store.has(operation.signature!.hash));
        expect(decodeWrites(pair).at(-1)).toMatchObject({
            type: 'ordered_catchup_req',
            sessionId: 'client-session',
            cursor: { syncOrder: 1, id: operation.signature!.hash },
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ordered_catchup_done',
            sessionId: 'stale-session',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'ordered_catchup', sessionId: 'client-session' });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ordered_catchup_push',
            sessionId: 'client-session',
            cursor: { syncOrder: -1, id: hash('a') },
            hasMore: false,
            data: [],
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();

        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'done-session'),
        );
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ordered_catchup_done',
            sessionId: 'done-session',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });
});
