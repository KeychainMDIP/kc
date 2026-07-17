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
import { estimateOperationBytes } from '../../services/mediators/hyperswarm/src/negentropy/transfer.ts';
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

async function makeDependencyChain(): Promise<Operation[]> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-protocol-dependency-fixtures'),
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const keys = cipher.generateRandomJwk();
    const controller = await helper.createAgentOp(keys, { registry: 'hyperswarm' });
    const controllerDid = await gatekeeper.createDID(controller);
    const asset = await helper.createAssetOp(controllerDid, keys, { registry: 'hyperswarm' });
    const assetDid = await gatekeeper.createDID(asset);
    const document = await gatekeeper.resolveDID(assetDid);
    document.didDocumentData = { version: 2 };
    const update = await helper.createUpdateOp(keys, assetDid, document);
    await gatekeeper.updateDID(update);
    const deletion = await helper.createDeleteOp(keys, assetDid);
    await gatekeeper.deleteDID(deletion);
    const operations = [controller, asset, update, deletion];
    await gatekeeper.resetDb();
    return operations;
}

async function makeLargeAssetOperations(count: number, payloadBytes: number): Promise<Operation[]> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-protocol-large-fixtures'),
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const keys = cipher.generateRandomJwk();
    const controller = await helper.createAgentOp(keys, { registry: 'hyperswarm' });
    const controllerDid = await gatekeeper.createDID(controller);
    const operations: Operation[] = [];

    for (let index = 0; index < count; index += 1) {
        const operation = await helper.createAssetOp(controllerDid, keys, { registry: 'hyperswarm' });
        operation.data = `${index}:${'x'.repeat(payloadBytes)}`;
        const unsigned = { ...operation };
        delete unsigned.signature;
        const hashValue = cipher.hashJSON(unsigned);
        operation.signature = {
            signer: controllerDid,
            signed: new Date(Date.now() - ((count - index + 1) * 60_000)).toISOString(),
            hash: hashValue,
            value: cipher.signHash(hashValue, keys.privateJwk),
        };
        await gatekeeper.createDID(operation);
        operations.push(operation);
    }
    await gatekeeper.resetDb();
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

    async function createRemoteOpen(operations: Operation[] = []): Promise<Record<string, unknown>> {
        const source = await createNode();
        if (operations.length > 0) {
            await source.store.upsertMany(operations.map(operation => ({
                id: operation.signature!.hash,
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                operation,
            })));
        }
        const peer = attachPeer(source, { mode: 'framed' });
        await source.node.run(() => source.node.mediator.__test.maybeStartPeerSync(peer.peerKey));
        const open = decodeWrites(peer.pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected remote neg_open fixture');
        }
        return open;
    }

    function replaceWithOrderedSession(
        protocolNode: ProtocolNode,
        peerKey: string,
        sessionId = 'replacement-session',
    ): AttachedPeer {
        protocolNode.node.run(() => protocolNode.node.mediator.__test.disconnectPeer(peerKey));
        const replacement = attachPeer(protocolNode, { mode: 'framed' });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, sessionId),
        );
        return replacement;
    }

    async function expectFailedNegentropySessionCanRetry(
        protocolNode: ProtocolNode,
        peerKey: string,
        pair: RecordingDuplexPair,
        failedSessionId: unknown,
    ): Promise<void> {
        const opensBefore = decodeWrites(pair).filter(message => message.type === 'neg_open');
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();

        const now = Date.now();
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now + 301_000);
        try {
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey, 'periodic'),
            );
        }
        finally {
            nowSpy.mockRestore();
        }

        const opensAfter = decodeWrites(pair).filter(message => message.type === 'neg_open');
        expect(opensAfter).toHaveLength(opensBefore.length + 1);
        expect(opensAfter.at(-1)?.sessionId).not.toBe(failedSessionId);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: opensAfter.at(-1)?.sessionId });
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

    it('rejects invalid framed neg_open windows and window IDs', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');
        const buildSnapshot = jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow');
        const window = open.window as Record<string, unknown>;
        const invalidMessages = [
            {
                ...open,
                sessionId: 'invalid-window',
                window: { ...window, fromTs: 2, toTs: 1 },
            },
            {
                ...open,
                sessionId: 'invalid-window-id',
                windowId: '',
            },
        ];

        for (const message of invalidMessages) {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify(message)),
            ));
        }

        expect(buildSnapshot).not.toHaveBeenCalled();
        expect(pair.transcript).toHaveLength(0);
        expect(destroySpy).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('ignores framed neg_open while ordered catch-up is active', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({
            keyByte: 0x33,
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        const buildSnapshot = jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow');
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'catchup-session'),
        );

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(open)),
        ));

        expect(buildSnapshot).not.toHaveBeenCalled();
        expect(pair.transcript).toHaveLength(0);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({
            activeSession: { mode: 'ordered_catchup', sessionId: 'catchup-session' },
            orderedCatchupClientSessionId: 'catchup-session',
        });
    });

    it('rejects stale-window neg_msg and unknown-session ops_req frames', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        const getByIds = jest.spyOn(protocolNode.store, 'getByIds');
        const writesBefore = pair.transcript.length;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'neg_msg',
                sessionId: open.sessionId,
                windowId: 'stale-window',
                frame: 'invalid-frame-must-not-be-decoded',
            })),
        ));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ops_req',
                sessionId: 'unknown-session',
                windowId: open.windowId,
                ids: [hash('a')],
            })),
        ));

        expect(getByIds).not.toHaveBeenCalled();
        expect(pair.transcript).toHaveLength(writesBefore);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });
    });

    it('reprocesses repeated framed neg_open for the existing window without replacing its session', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen([operation]);
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey } = attachPeer(protocolNode, { mode: 'framed' });
        const createEngine = jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot');
        const framedOpen = encodeFramedMessage(JSON.stringify(open));

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, framedOpen),
        );
        const firstSession = protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        );
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, framedOpen),
        );

        expect(createEngine).toHaveBeenCalledTimes(2);
        expect(firstSession).toEqual({ mode: 'negentropy', sessionId: open.sessionId });
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual(firstSession);
    });

    it('ignores an unknown framed message type without disconnecting the peer', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({ type: 'future_protocol_message', data: 'ignored' })),
        ));

        expect(pair.transcript).toHaveLength(0);
        expect(destroySpy).not.toHaveBeenCalled();
        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
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

    it.each(['snapshot rebuild', 'initiator reconciliation'] as const)(
        'does not open a stale window after its session is replaced during %s',
        async boundary => {
            const protocolNode = await createNode();
            const initialPeer = attachPeer(protocolNode, { mode: 'framed' });
            let noteAwaitStarted!: () => void;
            const awaitStarted = new Promise<void>(resolve => {
                noteAwaitStarted = resolve;
            });
            let releaseAwait!: () => void;
            const awaitBlocked = new Promise<void>(resolve => {
                releaseAwait = resolve;
            });
            if (boundary === 'snapshot rebuild') {
                const buildSnapshot = protocolNode.adapter.buildSnapshotForWindow.bind(protocolNode.adapter);
                jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow').mockImplementationOnce(async window => {
                    noteAwaitStarted();
                    await awaitBlocked;
                    return buildSnapshot(window);
                });
            }
            else {
                const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
                jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
                    const engine = createEngine(snapshot);
                    const initiate = engine.initiate.bind(engine);
                    jest.spyOn(engine, 'initiate').mockImplementationOnce(async () => {
                        noteAwaitStarted();
                        await awaitBlocked;
                        return initiate();
                    });
                    return engine;
                });
            }

            const start = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(initialPeer.peerKey),
            );
            let oldSessionId: unknown;
            let replacementState: Record<string, unknown> | null = null;
            let replacementMessages: Record<string, unknown>[] = [];
            try {
                await awaitStarted;
                oldSessionId = (protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.getConnectionState(initialPeer.peerKey),
                )?.activeSession as { sessionId?: unknown } | null)?.sessionId;
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
                );
                const replacementPeer = attachPeer(protocolNode, { mode: 'framed' });
                protocolNode.node.run(() => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                    replacementPeer.peerKey,
                    'replacement-session',
                ));

                releaseAwait();
                await start;
                replacementState = protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.getConnectionState(replacementPeer.peerKey),
                );
                replacementMessages = decodeWrites(replacementPeer.pair);
            }
            finally {
                releaseAwait();
                await start.catch(() => undefined);
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
                );
            }

            expect(typeof oldSessionId).toBe('string');
            expect(replacementState?.activeSession).toEqual({
                mode: 'ordered_catchup',
                sessionId: 'replacement-session',
            });
            expect(replacementMessages.some(message => message.sessionId === oldSessionId)).toBe(false);
        },
    );

    it.each(['count', 'countOrdered'] as const)(
        'does not start sync on a replacement connection after awaiting %s',
        async method => {
            const operations = method === 'countOrdered' ? await makeOperations(1) : [];
            const protocolNode = await createNode({
                maxRecords: 1,
                env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
            });
            if (operations.length > 0) {
                await protocolNode.store.upsertMany([{
                    id: operations[0].signature!.hash,
                    ts: Math.floor(Date.parse(operations[0].signature!.signed) / 1000),
                    syncOrder: 1,
                    operation: operations[0],
                }]);
            }
            const peerOperationCount = method === 'count' ? 1 : 0;
            const initialPeer = attachPeer(protocolNode, {
                mode: 'framed',
                overrides: {
                    capabilities: compatibleCapabilities({
                        orderedCatchup: true,
                        orderedCatchupVersion: 1,
                        orderedCatchupReady: true,
                        operationCount: peerOperationCount,
                        orderedOperationCount: peerOperationCount,
                    }),
                },
            });
            const original = protocolNode.store[method].bind(protocolNode.store);
            let noteStarted!: () => void;
            const started = new Promise<void>(resolve => {
                noteStarted = resolve;
            });
            let release!: () => void;
            const blocked = new Promise<void>(resolve => {
                release = resolve;
            });
            jest.spyOn(protocolNode.store, method).mockImplementationOnce(async () => {
                noteStarted();
                await blocked;
                return original();
            });

            const start = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(initialPeer.peerKey),
            );
            let replacementState: Record<string, unknown> | null = null;
            let replacementMessages: Record<string, unknown>[] = [];
            try {
                await started;
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
                );
                const replacement = attachPeer(protocolNode, { mode: 'framed' });
                release();
                await start;
                replacementState = protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.getConnectionState(replacement.peerKey),
                );
                replacementMessages = decodeWrites(replacement.pair);
            }
            finally {
                release();
                await start.catch(() => undefined);
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
                );
            }

            expect(replacementState).toMatchObject({
                syncMode: 'unknown',
                syncStarted: false,
                activeSession: null,
                orderedCatchupServerPendingSince: 0,
                orderedCatchupServerPendingReason: null,
            });
            expect(replacementMessages).toHaveLength(0);
        },
    );

    it('recovers from a missing background snapshot with the queued rebuild', async () => {
        const operations = await makeOperations(2);
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        const buildSnapshot = protocolNode.adapter.buildSnapshotForWindow.bind(protocolNode.adapter);
        let buildCalls = 0;
        let markFirstBuildStarted!: () => void;
        const firstBuildStarted = new Promise<void>(resolve => {
            markFirstBuildStarted = resolve;
        });
        let releaseFirstBuild!: () => void;
        const firstBuildBlocked = new Promise<void>(resolve => {
            releaseFirstBuild = resolve;
        });
        let markSecondBuildFinished!: () => void;
        const secondBuildFinished = new Promise<void>(resolve => {
            markSecondBuildFinished = resolve;
        });
        jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow').mockImplementation(async window => {
            const call = ++buildCalls;
            if (call === 1) {
                markFirstBuildStarted();
                await firstBuildBlocked;
                return null as never;
            }

            try {
                return await buildSnapshot(window);
            }
            finally {
                if (call === 2) {
                    markSecondBuildFinished();
                }
            }
        });
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now());

        try {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({ type: 'batch', data: [operations[0]] })),
            ));
            await firstBuildStarted;
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({ type: 'batch', data: [operations[1]] })),
            ));
            await eventually(async () => (await protocolNode.store.count()) === 2);
            await nextTurn();

            releaseFirstBuild();
            await eventually(() => buildCalls >= 2);
            await secondBuildFinished;
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
            );

            expect(buildCalls).toBe(2);
            expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(true);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toEqual(expect.objectContaining({ mode: 'negentropy' }));
        }
        finally {
            releaseFirstBuild();
            nowSpy.mockRestore();
        }
    });

    it.each(['responder snapshot', 'frame reconciliation'] as const)(
        'does not send stale traffic after replacement during %s',
        async boundary => {
            const operations = await makeOperations(1);
            const open = await createRemoteOpen(operations);
            const protocolNode = await createNode({ keyByte: 0x33 });
            const initialPeer = attachPeer(protocolNode, { mode: 'framed' });
            const remoteOpen = open as any;
            const probeSnapshot = await protocolNode.adapter.buildSnapshotForWindow(remoteOpen.window);
            const probeEngine = protocolNode.adapter.createEngineForSnapshot(probeSnapshot);
            const probeOutcome = await probeEngine.reconcile(decodeNegentropyFrame(remoteOpen.frame));
            const reconciliationWouldRespond = probeOutcome.nextMsg !== null;
            let noteStarted!: () => void;
            const started = new Promise<void>(resolve => {
                noteStarted = resolve;
            });
            let release!: () => void;
            const blocked = new Promise<void>(resolve => {
                release = resolve;
            });
            const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);

            if (boundary === 'responder snapshot') {
                const buildSnapshot = protocolNode.adapter.buildSnapshotForWindow.bind(protocolNode.adapter);
                jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow').mockImplementationOnce(async window => {
                    noteStarted();
                    await blocked;
                    return buildSnapshot(window);
                });
            }
            else {
                jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
                    const engine = createEngine(snapshot);
                    const reconcile = engine.reconcile.bind(engine);
                    jest.spyOn(engine, 'reconcile').mockImplementationOnce(async frame => {
                        noteStarted();
                        await blocked;
                        return reconcile(frame);
                    });
                    return engine;
                });
            }

            const inbound = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.receiveMsg(initialPeer.peerKey, open),
            );
            let oldSessionId: unknown;
            let replacementState: Record<string, unknown> | null = null;
            let replacementMessages: Record<string, unknown>[] = [];
            try {
                await started;
                oldSessionId = (protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.getConnectionState(initialPeer.peerKey),
                )?.activeSession as { sessionId?: unknown } | null)?.sessionId;
                const replacement = replaceWithOrderedSession(protocolNode, initialPeer.peerKey);
                release();
                await inbound;
                replacementState = protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.getConnectionState(replacement.peerKey),
                );
                replacementMessages = decodeWrites(replacement.pair);
            }
            finally {
                release();
                await inbound.catch(() => undefined);
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
                );
            }

            expect(typeof oldSessionId).toBe('string');
            expect(reconciliationWouldRespond).toBe(true);
            expect(replacementState?.activeSession).toEqual({
                mode: 'ordered_catchup',
                sessionId: 'replacement-session',
            });
            expect(replacementMessages.some(message => message.sessionId === oldSessionId)).toBe(false);
        },
    );

    it('does not send a stale ops_push after replacement during operation lookup', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const initialPeer = attachPeer(protocolNode, { mode: 'framed' });
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(initialPeer.peerKey),
        );
        const open = decodeWrites(initialPeer.pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        const getByIds = protocolNode.store.getByIds.bind(protocolNode.store);
        let noteLookupStarted!: () => void;
        const lookupStarted = new Promise<void>(resolve => {
            noteLookupStarted = resolve;
        });
        let releaseLookup!: () => void;
        const lookupBlocked = new Promise<void>(resolve => {
            releaseLookup = resolve;
        });
        jest.spyOn(protocolNode.store, 'getByIds').mockImplementationOnce(async ids => {
            noteLookupStarted();
            await lookupBlocked;
            return getByIds(ids);
        });

        const request = protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            initialPeer.peerKey,
            {
                type: 'ops_req',
                sessionId: open.sessionId,
                windowId: open.windowId,
                ids: [operation.signature!.hash],
            },
        ));
        let replacementState: Record<string, unknown> | null = null;
        let replacementMessages: Record<string, unknown>[] = [];
        try {
            await lookupStarted;
            const replacement = replaceWithOrderedSession(protocolNode, initialPeer.peerKey);
            releaseLookup();
            await request;
            replacementState = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(replacement.peerKey),
            );
            replacementMessages = decodeWrites(replacement.pair);
        }
        finally {
            releaseLookup();
            await request.catch(() => undefined);
            protocolNode.node.run(
                () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
            );
        }

        expect(replacementState?.activeSession).toEqual({
            mode: 'ordered_catchup',
            sessionId: 'replacement-session',
        });
        expect(replacementMessages.some(message => message.type === 'ops_push')).toBe(false);
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

    it.each(['ops_req', 'neg_close'] as const)(
        'closes an incomplete session when sending %s fails and permits repair',
        async failedType => {
            const [operation] = await makeOperations(1);
            const protocolNode = await createNode();
            const peerNode = await createNode({ keyByte: 0x33 });
            if (failedType === 'neg_close') {
                await protocolNode.store.upsertMany([{
                    id: operation.signature!.hash,
                    ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                    operation,
                }]);
            }
            await peerNode.store.upsertMany([{
                id: operation.signature!.hash,
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                operation,
            }]);
            const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
            );
            const open = decodeWrites(pair).find(message => message.type === 'neg_open');
            if (!open) {
                throw new Error('expected local neg_open');
            }
            const peerSnapshot = await peerNode.adapter.buildSnapshotForWindow(open.window as any);
            const peerEngine = peerNode.adapter.createEngineForSnapshot(peerSnapshot);
            const peerOutcome = await peerEngine.reconcile(decodeNegentropyFrame(open.frame as any));
            if (peerOutcome.nextMsg === null) {
                throw new Error(`expected peer response before ${failedType}`);
            }
            const write = jest.spyOn(pair.connectionA, 'write').mockImplementationOnce(() => {
                throw new Error(`${failedType} write failed`);
            });

            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'neg_msg',
                    sessionId: open.sessionId,
                    windowId: open.windowId,
                    frame: encodeNegentropyFrame(peerOutcome.nextMsg!),
                })),
            ));

            const attemptedChunk = write.mock.calls[0]?.[0] as Uint8Array;
            expect(JSON.parse(
                decodeUnknownTransportMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
            )).toMatchObject({ type: failedType, sessionId: open.sessionId });
            await expectFailedNegentropySessionCanRetry(protocolNode, peerKey, pair, open.sessionId);
        },
    );

    it('closes an incomplete session when sending neg_msg fails and permits repair', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen([operation]);
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        const write = jest.spyOn(pair.connectionA, 'write').mockImplementationOnce(() => {
            throw new Error('neg_msg write failed');
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(open)),
        ));

        const attemptedChunk = write.mock.calls[0]?.[0] as Uint8Array;
        expect(JSON.parse(
            decodeUnknownTransportMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
        )).toMatchObject({ type: 'neg_msg', sessionId: open.sessionId });
        await expectFailedNegentropySessionCanRetry(protocolNode, peerKey, pair, open.sessionId);
    });

    it('closes an incomplete session when sending ops_push fails and permits repair', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        const write = jest.spyOn(pair.connectionA, 'write').mockImplementationOnce(() => {
            throw new Error('ops_push write failed');
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ops_req',
                sessionId: open.sessionId,
                windowId: open.windowId,
                ids: [operation.signature!.hash],
            })),
        ));

        const attemptedChunk = write.mock.calls[0]?.[0] as Uint8Array;
        expect(JSON.parse(
            decodeUnknownTransportMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
        )).toMatchObject({ type: 'ops_push', sessionId: open.sessionId });
        await expectFailedNegentropySessionCanRetry(protocolNode, peerKey, pair, open.sessionId);
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

    it('starts periodic Negentropy after an expected catch-up request expires', async () => {
        const operations = await makeOperations(5);
        const protocolNode = await createNode({
            keyByte: 0x11,
            maxRecords: 4,
            env: {
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        await protocolNode.store.upsertMany(operations.map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
            mode: 'framed',
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                    operationCount: 1,
                    orderedOperationCount: 1,
                }),
            },
        });
        const now = Date.now();
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        let expiredState: Record<string, unknown> | null = null;

        try {
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
            );
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey, 'periodic'),
            );
            expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(false);

            const pendingState = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
            );
            const pendingUntil = pendingState?.orderedCatchupServerPendingUntil;
            expect(pendingState).toMatchObject({
                orderedCatchupServerPendingReason: 'enabled',
                orderedCatchupServerPendingGap: 4,
            });
            expect(typeof pendingUntil).toBe('number');

            nowSpy.mockReturnValue((pendingUntil as number) + 1);
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey, 'periodic'),
            );
            expiredState = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
            );
        }
        finally {
            nowSpy.mockRestore();
        }

        expect(pair.transcript.filter(entry => entry.messageType === 'neg_open')).toHaveLength(1);
        expect(expiredState).toMatchObject({
            orderedCatchupServerPendingUntil: 0,
            orderedCatchupServerPendingReason: null,
            orderedCatchupServerPendingGap: 0,
            activeSession: { mode: 'negentropy' },
        });
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

    it('closes without a continuation when a remote round cap cannot split the window', async () => {
        const protocolNode = await createNode({ maxRecords: 1 });
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'neg_close',
                sessionId: open.sessionId,
                windowId: open.windowId,
                reason: 'max_rounds_reached',
            })),
        ));

        expect(decodeWrites(pair).filter(message => message.type === 'neg_open')).toHaveLength(1);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('waits for the initiator close after responder-side terminal completion', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, { mode: 'framed' });
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [],
            });
            return engine;
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(open)),
        ));

        expect(pair.transcript).toHaveLength(0);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'neg_close',
                sessionId: open.sessionId,
                windowId: open.windowId,
                reason: 'complete',
            })),
        ));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
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

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendOrderedCatchupPage(peerKey, {
            type: 'ordered_catchup_req',
            sessionId: 'terminal-session',
            cursor: push?.cursor,
        } as any));
        expect(decodeWrites(pair).at(-1)).toMatchObject({
            type: 'ordered_catchup_done',
            sessionId: 'terminal-session',
        });
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({
            orderedCatchupServerSessionId: null,
            orderedCatchupServerLastActivity: 0,
        });

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

    it('closes ordered catch-up clients when request sends fail', async () => {
        const initialNode = await createNode({
            keyByte: 0x33,
            maxRecords: 4,
            env: {
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const initialPeer = attachPeer(initialNode, {
            peerKeyByte: 0x22,
            mode: 'framed',
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                    operationCount: 5,
                    orderedOperationCount: 5,
                }),
            },
        });
        const initialWrite = jest.spyOn(initialPeer.pair.connectionA, 'write').mockImplementation(() => {
            throw new Error('initial request write failed');
        });

        await initialNode.node.run(
            () => initialNode.node.mediator.__test.maybeStartPeerSync(initialPeer.peerKey),
        );
        expect(initialWrite).toHaveBeenCalledTimes(1);
        expect(initialNode.node.run(
            () => initialNode.node.mediator.__test.getConnectionState(initialPeer.peerKey),
        )).toMatchObject({
            activeSession: null,
            orderedCatchupClientSessionId: null,
        });

        const continuationNode = await createNode({
            keyByte: 0x33,
            env: {
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const continuationPeer = attachPeer(continuationNode, {
            peerKeyByte: 0x22,
            mode: 'framed',
        });
        continuationNode.node.run(
            () => continuationNode.node.mediator.__test.createOrderedCatchupClientSession(
                continuationPeer.peerKey,
                'continuation-session',
            ),
        );
        const continuationWrite = jest.spyOn(continuationPeer.pair.connectionA, 'write').mockImplementation(() => {
            throw new Error('continuation request write failed');
        });

        await continuationNode.node.run(() => continuationNode.node.mediator.__test.processInboundPeerData(
            continuationPeer.peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'continuation-session',
                cursor: { syncOrder: 1, id: hash('a') },
                hasMore: true,
                data: [],
            })),
        ));
        expect(continuationWrite).toHaveBeenCalledTimes(1);
        expect(continuationNode.node.run(
            () => continuationNode.node.mediator.__test.getConnectionState(continuationPeer.peerKey),
        )).toMatchObject({
            activeSession: null,
            orderedCatchupClientSessionId: null,
        });
        await nextTurn();
        expect(initialNode.node.gatekeeperClient.exportIndex).not.toHaveBeenCalled();
        expect(continuationNode.node.gatekeeperClient.exportIndex).not.toHaveBeenCalled();
    });

    it.each(['ordered_catchup_push', 'ordered_catchup_done'] as const)(
        'clears ordered catch-up server state when sending %s fails',
        async failedType => {
            const operations = failedType === 'ordered_catchup_push' ? await makeOperations(1) : [];
            const protocolNode = await createNode({
                env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
            });
            if (operations.length > 0) {
                await protocolNode.store.upsertMany([{
                    id: operations[0].signature!.hash,
                    ts: Math.floor(Date.parse(operations[0].signature!.signed) / 1000),
                    syncOrder: 1,
                    operation: operations[0],
                }]);
            }
            const { peerKey, pair } = attachPeer(protocolNode, {
                mode: 'framed',
                overrides: {
                    capabilities: compatibleCapabilities({
                        orderedCatchup: true,
                        orderedCatchupVersion: 1,
                        orderedCatchupReady: true,
                    }),
                },
            });
            const write = jest.spyOn(pair.connectionA, 'write').mockImplementation(() => {
                throw new Error(`${failedType} write failed`);
            });

            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_req',
                    sessionId: 'send-failure-session',
                })),
            ));

            expect(write).toHaveBeenCalledTimes(1);
            const attemptedChunk = write.mock.calls[0]?.[0] as Uint8Array;
            expect(JSON.parse(
                decodeUnknownTransportMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
            )).toMatchObject({ type: failedType, sessionId: 'send-failure-session' });
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
            )).toMatchObject({
                activeSession: null,
                orderedCatchupServerSessionId: null,
                orderedCatchupServerLastActivity: 0,
            });
            await nextTurn();
            expect(protocolNode.node.gatekeeperClient.exportIndex).not.toHaveBeenCalled();
        },
    );

    it('coalesces duplicate ordered catch-up post-import continuations', async () => {
        const protocolNode = await createNode({
            keyByte: 0x33,
            env: {
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
            mode: 'framed',
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                }),
            },
        });
        const exportIndex = protocolNode.node.gatekeeperClient.exportIndex;
        const exportIndexImplementation = exportIndex.getMockImplementation();
        if (!exportIndexImplementation) {
            throw new Error('Gatekeeper exportIndex implementation is unavailable');
        }
        const applySyncPage = jest.spyOn(protocolNode.store, 'applySyncPage');
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        exportIndex.mockImplementationOnce(async request => {
            markStarted();
            await blocked;
            return exportIndexImplementation(request);
        });

        try {
            protocolNode.node.run(
                () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                    peerKey,
                    'first-complete-session',
                ),
            );
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_done',
                    sessionId: 'first-complete-session',
                })),
            ));
            await started;

            protocolNode.node.run(
                () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                    peerKey,
                    'duplicate-complete-session',
                ),
            );
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_done',
                    sessionId: 'duplicate-complete-session',
                })),
            ));
            await nextTurn();

            expect(exportIndex).toHaveBeenCalledTimes(1);
            expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(false);

            release();
            await eventually(() => applySyncPage.mock.calls.length === 1);
            await nextTurn();
            expect(exportIndex).toHaveBeenCalledTimes(1);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toBeNull();
        }
        finally {
            release();
        }
    });

    it('does not start Negentropy when ordered catch-up index sync fails', async () => {
        const protocolNode = await createNode({
            keyByte: 0x11,
            env: {
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
            mode: 'framed',
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                }),
            },
        });
        const applySyncPage = jest.spyOn(protocolNode.store, 'applySyncPage');
        const exportIndex = protocolNode.node.gatekeeperClient.exportIndex;
        exportIndex.mockRejectedValueOnce(new Error('index sync failed'));
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                peerKey,
                'failed-index-session',
            ),
        );

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_done',
                sessionId: 'failed-index-session',
            })),
        ));
        await eventually(() => exportIndex.mock.calls.length === 1);
        await Promise.allSettled(exportIndex.mock.results.map(result => result.value));
        await nextTurn();

        expect(applySyncPage).not.toHaveBeenCalled();
        expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it.each(['status lookup', 'page lookup'] as const)(
        'does not send an ordered catch-up response on a replacement connection after %s',
        async boundary => {
            const [operation] = await makeOperations(1);
            const protocolNode = await createNode({
                env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
            });
            await protocolNode.store.upsertMany([{
                id: operation.signature!.hash,
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                syncOrder: boundary === 'page lookup' ? 1 : undefined,
                operation,
            }]);
            const initialPeer = attachPeer(protocolNode, {
                mode: 'framed',
                overrides: {
                    capabilities: compatibleCapabilities({
                        orderedCatchup: true,
                        orderedCatchupVersion: 1,
                        orderedCatchupReady: true,
                    }),
                },
            });
            let noteStarted!: () => void;
            const started = new Promise<void>(resolve => {
                noteStarted = resolve;
            });
            let release!: () => void;
            const blocked = new Promise<void>(resolve => {
                release = resolve;
            });

            if (boundary === 'status lookup') {
                const count = protocolNode.store.count.bind(protocolNode.store);
                jest.spyOn(protocolNode.store, 'count').mockImplementationOnce(async () => {
                    noteStarted();
                    await blocked;
                    return count();
                });
            }
            else {
                const iterateOrdered = protocolNode.store.iterateOrdered.bind(protocolNode.store);
                jest.spyOn(protocolNode.store, 'iterateOrdered').mockImplementationOnce(async options => {
                    noteStarted();
                    await blocked;
                    return iterateOrdered(options);
                });
            }

            const request = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.sendOrderedCatchupPage(initialPeer.peerKey, {
                    type: 'ordered_catchup_req',
                    sessionId: 'stale-server-session',
                } as any),
            );
            let replacementState: Record<string, unknown> | null = null;
            let replacementMessages: Record<string, unknown>[] = [];
            try {
                await started;
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
                );
                const replacement = attachPeer(protocolNode, { mode: 'framed' });
                release();
                await request;
                replacementState = protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.getConnectionState(replacement.peerKey),
                );
                replacementMessages = decodeWrites(replacement.pair);
            }
            finally {
                release();
                await request.catch(() => undefined);
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey),
                );
            }

            expect(replacementState).toMatchObject({
                orderedCatchupServerSessionId: null,
                activeSession: null,
            });
            expect(replacementMessages).toHaveLength(0);
        },
    );

    it.each([256, 257])('serves an ordered catch-up history of %i operations without gaps', async count => {
        const operations = await makeOperations(count);
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
                }),
            },
        });
        const request = {
            type: 'ordered_catchup_req',
            sessionId: `page-${count}`,
        };

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(request)),
        ));
        let pushes = decodeWrites(pair).filter(message => message.type === 'ordered_catchup_push');
        expect((pushes[0].data as Operation[])).toHaveLength(Math.min(count, 256));
        expect(pushes[0].hasMore).toBe(count > 256);

        if (count === 257) {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify(request)),
            ));
            pushes = decodeWrites(pair).filter(message => message.type === 'ordered_catchup_push');
            expect(pushes[1]).toMatchObject({
                cursor: pushes[0].cursor,
                hasMore: true,
            });
            expect((pushes[1].data as Operation[]).map(operation => operation.signature!.hash)).toStrictEqual(
                (pushes[0].data as Operation[]).map(operation => operation.signature!.hash),
            );

            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({ ...request, cursor: pushes[0].cursor })),
            ));
            pushes = decodeWrites(pair).filter(message => message.type === 'ordered_catchup_push');
            expect(pushes[2]).toMatchObject({
                hasMore: false,
                cursor: { syncOrder: 257, id: operations[256].signature!.hash },
            });
        }

        const delivered = count === 257
            ? [...pushes[0].data as Operation[], ...pushes[2].data as Operation[]]
            : pushes[0].data as Operation[];
        expect(delivered.map(operation => operation.signature!.hash)).toStrictEqual(
            operations.map(operation => operation.signature!.hash),
        );
    });

    it('limits an ordered catch-up page by encoded operation bytes', async () => {
        const operations = await makeLargeAssetOperations(10, 55_000);
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
                }),
            },
        });
        const request = { type: 'ordered_catchup_req', sessionId: 'byte-page' };

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(request)),
        ));
        let pushes = decodeWrites(pair).filter(message => message.type === 'ordered_catchup_push');
        const firstPage = pushes[0].data as Operation[];
        const firstPageBytes = firstPage.reduce((total, operation) => total + estimateOperationBytes(operation), 0);
        expect(firstPage.length).toBeLessThan(256);
        expect(firstPageBytes).toBeLessThanOrEqual(512 * 1024);
        expect(firstPageBytes + estimateOperationBytes(operations[firstPage.length])).toBeGreaterThan(512 * 1024);
        expect(pushes[0].hasMore).toBe(true);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({ ...request, cursor: pushes[0].cursor })),
        ));
        pushes = decodeWrites(pair).filter(message => message.type === 'ordered_catchup_push');
        expect(pushes[1].hasMore).toBe(false);
        expect([
            ...firstPage,
            ...pushes[1].data as Operation[],
        ].map(operation => operation.signature!.hash)).toStrictEqual(
            operations.map(operation => operation.signature!.hash),
        );
    });

    it('persists deferred asset dependencies when a later ordered page supplies the controller', async () => {
        const [controller, asset, update, deletion] = await makeDependencyChain();
        const protocolNode = await createNode({
            keyByte: 0x33,
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        const { peerKey } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
            mode: 'framed',
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                }),
            },
        });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'dependency-session'),
        );

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'dependency-session',
                cursor: { syncOrder: 1, id: asset.signature!.hash },
                hasMore: true,
                data: [asset],
            })),
        ));
        await eventually(() => protocolNode.node.gatekeeperClient.processEvents.mock.calls.length >= 1);
        expect(await protocolNode.store.count()).toBe(0);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'dependency-session',
                cursor: { syncOrder: 2, id: controller.signature!.hash },
                hasMore: true,
                data: [controller],
            })),
        ));
        await eventually(() => protocolNode.node.gatekeeperClient.processEvents.mock.calls.length >= 2);
        await eventually(async () => (await protocolNode.store.count()) === 2);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'dependency-session',
                cursor: { syncOrder: 3, id: update.signature!.hash },
                hasMore: true,
                data: [update],
            })),
        ));
        await eventually(async () => (await protocolNode.store.count()) === 3);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'dependency-session',
                cursor: { syncOrder: 4, id: deletion.signature!.hash },
                hasMore: false,
                data: [deletion],
            })),
        ));
        await eventually(async () => (await protocolNode.store.count()) === 4);

        expect((await protocolNode.store.iterateSorted({ limit: 10 })).map(row => row.id).sort()).toStrictEqual(
            [controller, asset, update, deletion].map(operation => operation.signature!.hash).sort(),
        );
    });

    it.each([
        ['equal', { syncOrder: 2, id: hash('b') }, { syncOrder: 2, id: hash('b') }],
        ['regressing', { syncOrder: 2, id: hash('b') }, { syncOrder: 1, id: hash('a') }],
        ['missing', { syncOrder: 2, id: hash('b') }, undefined],
    ])('closes an ordered catch-up session on a %s cursor', async (_case, firstCursor, nextCursor) => {
        const operations = await makeOperations(2);
        const protocolNode = await createNode({
            keyByte: 0x33,
            env: { KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true' },
        });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22, mode: 'framed' });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'cursor-session'),
        );
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'cursor-session',
                cursor: firstCursor,
                hasMore: true,
                data: [operations[0]],
            })),
        ));
        await eventually(async () => await protocolNode.store.has(operations[0].signature!.hash));
        const writesBefore = pair.transcript.length;
        const importsBefore = protocolNode.node.gatekeeperClient.importBatch.mock.calls.length;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'cursor-session',
                cursor: nextCursor,
                hasMore: true,
                data: [operations[1]],
            })),
        ));
        await nextTurn();

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(pair.transcript).toHaveLength(writesBefore);
        expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(importsBefore);
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
