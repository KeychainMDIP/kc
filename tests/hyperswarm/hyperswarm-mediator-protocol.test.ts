import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { Operation } from '@mdip/gatekeeper/types';
import { jest } from '@jest/globals';

import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import { HYPR_INDEX_SYNC_STATE_KEYS } from '../../services/mediators/hyperswarm/src/bootstrap.ts';
import NegentropyAdapter, {
    type ReconciliationWindow,
} from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import {
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    normalizePeerCapabilities,
} from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import {
    buildInitialHistoryWindow,
    buildNextHistoryPage,
    buildRoundCapSplitWindow,
    makeWindowId,
    MDIP_EPOCH_SECONDS,
} from '../../services/mediators/hyperswarm/src/negentropy/windows.ts';
import { estimateOperationBytes } from '../../services/mediators/hyperswarm/src/negentropy/transfer.ts';
import { mapOperationToSyncKey } from '../../services/mediators/hyperswarm/src/sync-mapping.ts';
import {
    decodeFramedMessages,
    encodeFramedMessage as encodeTransportFrame,
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

const NEGENTROPY_VERSION = 2;
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
        relays: [],
        peers: [],
        capabilities: {
            negentropy: true,
            negentropyVersion: NEGENTROPY_VERSION,
        },
        transportFramingVersion: 1,
        ...overrides,
    };
}

function encodeFramedMessage(payload: string | Uint8Array): Buffer {
    if (typeof payload !== 'string') {
        return encodeTransportFrame(payload);
    }
    let value: unknown;
    try {
        value = JSON.parse(payload);
    }
    catch {
        return encodeTransportFrame(payload);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return encodeTransportFrame(payload);
    }
    const message = value as Record<string, unknown>;
    return encodeTransportFrame(JSON.stringify({
        time: new Date().toISOString(),
        node: 'peer',
        relays: [],
        round: 0,
        ...message,
    }));
}

function decodeWrites(pair: RecordingDuplexPair): Array<Record<string, unknown>> {
    return pair.transcript.flatMap(entry => {
        const decoded = decodeFramedMessages(entry.raw);
        return decoded.messages.map(message => JSON.parse(message.toString('utf8')) as Record<string, unknown>);
    });
}

function requestedOpsPush(
    pair: RecordingDuplexPair,
    data: Operation[],
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    const request = decodeWrites(pair).filter(message => message.type === 'ops_req').at(-1);
    if (!request) {
        throw new Error('expected an active ops_req');
    }
    return {
        type: 'ops_push',
        sessionId: request.sessionId,
        windowId: request.windowId,
        round: request.round,
        requestId: request.requestId,
        page: 0,
        hasMore: false,
        data,
        ...overrides,
    };
}

async function deliverAuthorizedPush(
    protocolNode: ProtocolNode,
    peerKey: string,
    pair: RecordingDuplexPair,
    open: Record<string, unknown>,
    data: Operation[],
): Promise<void> {
    const ids = data.map(operation => operation.signature!.hash);
    let request = decodeWrites(pair).filter(message => (
        message.type === 'ops_req'
        && Array.isArray(message.ids)
        && ids.every(id => (message.ids as string[]).includes(id))
    )).at(-1);
    if (!request) {
        const offerId = decodeWrites(pair).filter(message => message.type === 'ops_req' && message.offerId !== undefined).length;
        const round = Number(decodeWrites(pair).filter(message => message.type === 'neg_msg').at(-1)?.round ?? 1);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_offer',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round,
            offerId,
            ids,
        }));
        request = decodeWrites(pair).filter(message => message.type === 'ops_req').at(-1);
    }
    if (!request) {
        throw new Error('expected an authorized ops_req');
    }
    await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
        peerKey,
        requestedOpsPush(pair, data),
    ));
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

async function makeLegacyUpdateWithoutPrevid(): Promise<Operation> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-protocol-legacy-update-fixture'),
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const keys = cipher.generateRandomJwk();
    const create = await helper.createAgentOp(keys, { registry: 'hyperswarm' });
    const did = await gatekeeper.createDID(create);
    const document = await gatekeeper.resolveDID(did);
    document.didDocumentData = { legacy: true };
    return helper.createUpdateOp(keys, did, document, { excludePrevid: true });
}

async function makeModernUpdateWithMissingPredecessor(): Promise<Operation> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-protocol-modern-missing-predecessor-fixture'),
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const keys = cipher.generateRandomJwk();
    const create = await helper.createAgentOp(keys, { registry: 'hyperswarm' });
    const did = await gatekeeper.createDID(create);
    const document = await gatekeeper.resolveDID(did);
    document.didDocumentData = { modern: true };
    return helper.createUpdateOp(keys, did, document);
}

function makeStructurallyRejectedOperation(): Operation {
    const cipher = new CipherNode();
    const unsignedOperation: Operation = {
        type: 'create',
        created: '2026-01-01T00:00:00.000Z',
        mdip: {
            version: 1,
            type: 'agent',
            registry: 'hyperswarm',
        },
    };
    const hashValue = cipher.hashJSON(unsignedOperation);
    return {
        ...unsignedOperation,
        signature: {
            hash: hashValue,
            signed: '2026-01-01T00:00:00.000Z',
            value: 'invalid-signature',
        },
    };
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
            signed: new Date(Date.parse(operation.created!) + index + 1).toISOString(),
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

        protocolNode.node.run(() => protocolNode.node.mediator.__test.addConnection(peerKey, {
            connection: pair.connectionA,
            capabilities: compatibleCapabilities(),
            initialPingReceived: true,
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
        const peer = attachPeer(source, {});
        await source.node.run(() => source.node.mediator.__test.maybeStartPeerSync(peer.peerKey));
        const open = decodeWrites(peer.pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected remote neg_open fixture');
        }
        return open;
    }

    function mockTerminalResponder(protocolNode: ProtocolNode): void {
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementation(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [],
            });
            return engine;
        });
    }

    function replaceWithOrderedSession(
        protocolNode: ProtocolNode,
        peerKey: string,
        sessionId = 'replacement-session',
    ): AttachedPeer {
        protocolNode.node.run(() => protocolNode.node.mediator.__test.disconnectPeer(peerKey));
        const replacement = attachPeer(protocolNode, {});
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

    it('frames the initial ping and advertises always-on sync capabilities', async () => {
        const protocolNode = await createNode({
            env: {
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'false',
            },
        });
        const [operation] = await makeOperations(1);
        const latestSignedTimestamp = Math.floor(Date.parse(operation.signature!.signed) / 1000);
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: latestSignedTimestamp,
            operation,
        }]);
        const { peerKey, pair } = attachPeer(protocolNode);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendPingToPeer(peerKey));
        expect(pair.transcript).toHaveLength(1);
        expect(pair.transcript[0]).toMatchObject({ messageType: 'ping', framed: true });
        expect(decodeWrites(pair)[0]).toMatchObject({
            transportFramingVersion: 1,
            capabilities: {
                negentropy: true,
                negentropyVersion: 2,
                orderedCatchup: true,
                orderedCatchupVersion: 1,
                orderedCatchupReady: false,
                latestSignedTimestamp,
            },
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(peerPing())),
        ));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.sendPingToPeer(peerKey));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({
            syncMode: 'negentropy',
            activeSession: { mode: 'negentropy' },
        });
        expect(pair.transcript.map(entry => entry.messageType)).toEqual(
            expect.arrayContaining(['neg_open', 'ping']),
        );
        expect(pair.transcript.every(entry => entry.framed)).toBe(true);
    });

    it.each([
        ['the wall clock when both stores end earlier', null, null],
        ['the local latest timestamp when it is in the future', 1_800_000_000, null],
        ['the peer latest timestamp when it is in the future', null, 1_800_000_000],
    ])('sets the initial window upper bound from %s', async (
        _case,
        localLatestSignedTimestamp,
        peerLatestSignedTimestamp,
    ) => {
        const nowMs = 1_750_000_000_000;
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
        const protocolNode = await createNode({ keyByte: 0x11 });
        if (localLatestSignedTimestamp !== null) {
            const [operation] = await makeOperations(1);
            operation.signature!.signed = new Date(localLatestSignedTimestamp * 1000).toISOString();
            await protocolNode.store.upsertMany([{
                id: operation.signature!.hash,
                ts: localLatestSignedTimestamp,
                operation,
            }]);
        }
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        const capabilities = {
            negentropy: true,
            negentropyVersion: NEGENTROPY_VERSION,
            ...(peerLatestSignedTimestamp === null ? {} : { latestSignedTimestamp: peerLatestSignedTimestamp }),
        };

        try {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, peerPing({
                capabilities,
            })));
        }
        finally {
            nowSpy.mockRestore();
        }

        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        expect((open?.window as { toTs?: number } | undefined)?.toTs).toBe(
            Math.max(
                Math.floor(nowMs / 1000),
                localLatestSignedTimestamp ?? 0,
                peerLatestSignedTimestamp ?? 0,
            ),
        );
    });

    it.each([
        ['missing capabilities', undefined],
        ['version mismatch', { negentropy: true, negentropyVersion: 1 }],
    ])('closes a peer with %s', async (
        _case,
        capabilities,
    ) => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, peerPing({
            capabilities,
        })));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(pair.transcript).toHaveLength(0);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { negentropyVersionIncompatibilityClosures: 1 } });
    });

    it('ignores removed full-store sync messages', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            Buffer.concat([
                encodeFramedMessage(JSON.stringify({ type: 'sync', node: 'removed-peer' })),
                encodeFramedMessage(JSON.stringify({ type: 'batch', data: [operation] })),
            ]),
        ));

        expect(protocolNode.node.gatekeeperClient.getDIDs).not.toHaveBeenCalled();
        expect(protocolNode.node.gatekeeperClient.exportBatch).not.toHaveBeenCalled();
        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
        expect(await protocolNode.store.count()).toBe(0);
        expect(pair.transcript).toHaveLength(0);
    });

    it.each([
        ['lower local key initiates', 0x11, 0x22, true],
        ['higher local key waits', 0x33, 0x22, false],
    ])('%s', async (_case, localKeyByte, peerKeyByte, shouldInitiate) => {
        const protocolNode = await createNode({ keyByte: localKeyByte });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte });

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
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.syncMode,
        )).toBe('unknown');
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            pingFrame.subarray(3),
        ));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.syncMode,
        )).toBe('negentropy');

        const coalesced = Buffer.concat(operations.map(operation => encodeFramedMessage(JSON.stringify({
            type: 'queue',
            relays: [],
            data: [operation],
        }))));
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, coalesced),
        );
        await eventually(async () => (await protocolNode.store.count()) === 2);
        expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['raw ping without a framing version', false, undefined, true],
        ['framed ping without a framing version', true, undefined, false],
        ['framed ping with an unsupported framing version', true, 2, false],
    ])('closes a %s without starting synchronization', async (
        _case,
        framed,
        transportFramingVersion,
        punitive,
    ) => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');
        const ping = peerPing({ transportFramingVersion });
        const payload = Buffer.from(JSON.stringify(ping));

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                framed ? encodeFramedMessage(payload) : payload,
            ),
        );

        expect(destroySpy).toHaveBeenCalledTimes(1);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            transport: {
                protocolViolationCooldowns: punitive ? 1 : 0,
                transportFramingIncompatibilityClosures: punitive ? 0 : 1,
            },
        });
    });

    it('quarantines framed protocol traffic received before a compatible ping', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {
            overrides: { peerTransportFramingVersion: null, initialPingReceived: false },
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_req',
                    sessionId: 'unverified-session',
                    cursor: null,
                })),
            ),
        );

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(pair.transcript).toHaveLength(0);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 1 } });
    });

    it('ignores frames coalesced after an incompatible ping', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);
        const payload = Buffer.concat([
            encodeFramedMessage(JSON.stringify(peerPing({
                transportFramingVersion: undefined,
            }))),
            encodeFramedMessage(JSON.stringify(peerPing())),
        ]);

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, payload),
        );

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(pair.transcript).toHaveLength(0);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { transportFramingIncompatibilityClosures: 1 } });
    });

    it('terminates a peer that sends a fragmented raw ping', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');
        const rawPing = Buffer.from(JSON.stringify(peerPing()));

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                rawPing.subarray(0, 3),
            ),
        );
        expect(destroySpy).not.toHaveBeenCalled();

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                rawPing.subarray(3),
            ),
        );

        expect(destroySpy).toHaveBeenCalledTimes(1);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            transport: {
                protocolViolationCooldowns: 1,
            },
        });
    });

    it('rejects an unframed non-ping as the initial message', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                Buffer.from(JSON.stringify({ type: 'queue', data: [], relays: [] })),
            ),
        );

        expect(destroySpy).toHaveBeenCalled();
        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
    });

    it('terminates a peer after a malformed framed header', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(peerKey, Buffer.alloc(4)),
        );

        expect(destroySpy).toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('preserves an incomplete frame without terminating the peer', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
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

    it.each([
        ['window range', (open: Record<string, unknown>) => ({
            ...open,
            sessionId: 'invalid-window',
            window: { ...(open.window as Record<string, unknown>), fromTs: 2, toTs: 1 },
        })],
        ['window ID', (open: Record<string, unknown>) => ({
            ...open,
            sessionId: 'invalid-window-id',
            windowId: '',
        })],
        ['window identity', (open: Record<string, unknown>) => ({
            ...open,
            sessionId: 'mismatched-window-id',
            windowId: 'does-not-match-the-window',
        })],
    ])('rejects an invalid framed neg_open %s', async (_case, makeInvalidMessage) => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');
        const buildSnapshot = jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow');
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(makeInvalidMessage(open))),
        ));

        expect(buildSnapshot).not.toHaveBeenCalled();
        expect(pair.transcript).toHaveLength(0);
        expect(destroySpy).toHaveBeenCalledTimes(1);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it.each([
        ['neg_msg frame', (open: Record<string, unknown>) => ({
            type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId,
            frame: { encoding: 'unsupported', data: '' },
        })],
        ['ops_req IDs', (open: Record<string, unknown>) => ({
            type: 'ops_req', sessionId: open.sessionId, windowId: open.windowId, ids: ['invalid'],
        })],
        ['ops_push page', (open: Record<string, unknown>) => ({
            type: 'ops_push', sessionId: open.sessionId, windowId: open.windowId, data: 'invalid',
        })],
        ['neg_close progress', (open: Record<string, unknown>) => ({
            type: 'neg_close', sessionId: open.sessionId, windowId: open.windowId,
            windowProgress: { cappedByRecords: 'true' },
        })],
    ])('rejects an invalid current %s', async (_case, makeInvalidMessage) => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            makeInvalidMessage(open),
        ));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 1 } });
    });

    it('quarantines a peer whose bounded Negentropy frame cannot be decoded', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementation(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockRejectedValueOnce(new Error('invalid frame'));
            return engine;
        });
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 1,
            frame: { encoding: 'utf8', data: 'malformed-negentropy-frame' },
        }));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 1 } });
    });

    it('rejects queue gossip whose operation ID does not match its content', async () => {
        const [operation] = await makeOperations(1);
        const forged = {
            ...operation,
            signature: { ...operation.signature!, hash: 'f'.repeat(64) },
        };
        const protocolNode = await createNode();
        const { peerKey } = attachPeer(protocolNode, {});

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'queue',
            data: [forged],
        }));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(await protocolNode.store.has(forged.signature.hash)).toBe(false);
    });

    it('rejects framed neg_open while ordered catch-up is active', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({
            keyByte: 0x33,
        });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const buildSnapshot = jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow');
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'catchup-session'),
        );

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(open)),
        ));

        expect(buildSnapshot).not.toHaveBeenCalled();
        expect(decodeWrites(pair)).toEqual([
            expect.objectContaining({
                type: 'neg_close',
                sessionId: open.sessionId,
                windowId: open.windowId,
                reason: 'ordered_catchup_active',
            }),
        ]);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({
            activeSession: { mode: 'ordered_catchup', sessionId: 'catchup-session' },
            orderedCatchupClientSessionId: 'catchup-session',
        });
    });

    it('retries Negentropy on the next periodic pass after an ordered catch-up rejection', async () => {
        const protocolNode = await createNode({ keyByte: 0x11 });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now());

        try {
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
            );
            const firstOpen = decodeWrites(pair).find(message => message.type === 'neg_open');
            expect(firstOpen).toMatchObject({
                sessionId: expect.any(String),
                windowId: expect.any(String),
            });

            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                type: 'neg_close',
                sessionId: firstOpen!.sessionId,
                windowId: firstOpen!.windowId,
                reason: 'ordered_catchup_active',
            }));
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey, 'periodic'),
            );

            const opens = decodeWrites(pair).filter(message => message.type === 'neg_open');
            expect(opens).toHaveLength(2);
            expect(opens[1].sessionId).not.toBe(firstOpen!.sessionId);
        }
        finally {
            nowSpy.mockRestore();
        }
    });

    it('does not retry Negentropy after a peer advertises incompatible capabilities', async () => {
        const protocolNode = await createNode({ keyByte: 0x11 });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const firstOpen = decodeWrites(pair).find(message => message.type === 'neg_open');
        expect(firstOpen).toMatchObject({
            sessionId: expect.any(String),
            windowId: expect.any(String),
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: firstOpen!.sessionId,
            windowId: firstOpen!.windowId,
            reason: 'ordered_catchup_active',
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, peerPing({
            capabilities: {
                negentropy: true,
                negentropyVersion: 1,
            },
        })));
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey, 'periodic'),
        );

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(decodeWrites(pair).filter(message => message.type === 'neg_open')).toHaveLength(1);
    });

    it('ignores unknown sessions and rejects an unrecognized current-session window', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
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
                type: 'ops_req',
                sessionId: 'unknown-session',
                windowId: open.windowId,
                round: 0,
                requestId: 0,
                ids: [hash('a')],
            })),
        ));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'neg_msg',
                sessionId: open.sessionId,
                windowId: 'unrecognized-window',
                round: 1,
                frame: 'invalid-frame-must-not-be-decoded',
            })),
        ));

        expect(getByIds).not.toHaveBeenCalled();
        expect(pair.transcript).toHaveLength(writesBefore);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 1 } });
    });

    it('ignores a stale repeated neg_open without replacing its session', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen([operation]);
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey } = attachPeer(protocolNode, {});
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

        expect(createEngine).toHaveBeenCalledTimes(1);
        expect(firstSession).toEqual({ mode: 'negentropy', sessionId: open.sessionId });
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual(firstSession);
    });

    it('disconnects a peer that sends an unknown framed message type', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const destroySpy = jest.spyOn(pair.connectionA, 'destroy');

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({ type: 'future_protocol_message', data: 'ignored' })),
        ));

        expect(pair.transcript).toHaveLength(0);
        expect(destroySpy).toHaveBeenCalledTimes(1);
        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 1 } });
    });

    it('keeps the active Negentropy session when the peer opens another', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
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
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...open,
            sessionId: 'remote-session',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });
        expect(decodeWrites(pair).filter(message => (
            message.type === 'neg_close'
            && message.sessionId === 'remote-session'
            && message.reason === 'sync_busy'
        ))).toEqual([expect.objectContaining({
            type: 'neg_close',
            sessionId: 'remote-session',
            reason: 'sync_busy',
        })]);

        const writesBefore = pair.transcript.length;
        const importsBefore = protocolNode.node.gatekeeperClient.importBatch.mock.calls.length;
        for (const message of [
            { type: 'neg_msg', sessionId: 'stale', windowId: open.windowId, frame: open.frame },
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
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'remote_closed',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it.each(['sync_busy', 'ordered_catchup_active'])(
        'applies the inbound repair delay when the initiator closes with %s',
        async reason => {
            const open = await createRemoteOpen();
            const protocolNode = await createNode({ keyByte: 0x33 });
            const { peerKey, pair } = attachPeer(protocolNode, {});
            mockTerminalResponder(protocolNode);

            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                type: 'neg_close',
                sessionId: open.sessionId,
                windowId: open.windowId,
                round: 1,
                reason,
            }));
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                ...open,
                sessionId: 'retry-before-deadline',
            }));

            expect(pair.connectionA.destroyed).toBe(false);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toBeNull();
            expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
                type: 'neg_close',
                sessionId: 'retry-before-deadline',
                reason: 'sync_busy',
            }));
        },
    );

    it('rejects a same-session open that conflicts with the local initiator role', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));

        expect(pair.connectionA.destroyed).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('serves one bounded requested page per matching acknowledgement', async () => {
        const operations = await makeOperations(301);
        const protocolNode = await createNode({ maxRecords: operations.length });
        await protocolNode.store.upsertMany(operations.map(operation => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        })));
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: operations.map(operation => operation.signature!.hash),
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('offer-page'),
        }));
        const offer = decodeWrites(pair).find(message => message.type === 'ops_offer')!;
        const lookupSizes: number[] = [];
        const getByIds = protocolNode.store.getByIds.bind(protocolNode.store);
        jest.spyOn(protocolNode.store, 'getByIds').mockImplementation(async ids => {
            lookupSizes.push(ids.length);
            return getByIds(ids);
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            offerId: offer.offerId,
            ids: offer.ids,
        }));

        let pushes = decodeWrites(pair).filter(message => message.type === 'ops_push');
        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({ page: 0, hasMore: true });
        expect((pushes[0].data as Operation[])).toHaveLength(300);
        expect(Math.max(...lookupSizes)).toBeLessThanOrEqual(32);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_ack',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            page: 0,
        }));
        pushes = decodeWrites(pair).filter(message => message.type === 'ops_push');
        expect(pushes).toHaveLength(2);
        expect(pushes[1]).toMatchObject({ page: 1, hasMore: false });
        expect((pushes[1].data as Operation[])).toHaveLength(1);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_ack',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            page: 0,
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects the next reconciliation frame while a transfer is outstanding', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'next-frame',
                haveIds: [operation.signature!.hash],
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('first-round'),
        }));
        expect(decodeWrites(pair).some(message => message.type === 'ops_offer')).toBe(true);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 2,
            frame: encodeNegentropyFrame('early-next-round'),
        }));

        expect(pair.connectionA.destroyed).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects a round-cap close while a transfer is outstanding', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'next-frame',
                haveIds: [operation.signature!.hash],
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('first-round'),
        }));
        expect(decodeWrites(pair).some(message => message.type === 'ops_offer')).toBe(true);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'max_rounds_reached',
        }));

        expect(pair.connectionA.destroyed).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('requests the same needed operation only once per window', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile')
                .mockResolvedValueOnce({
                    nextMsg: 'next-frame',
                    haveIds: [],
                    needIds: [operationId],
                })
                .mockResolvedValueOnce({
                    nextMsg: null,
                    haveIds: [],
                    needIds: [operationId],
                });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('first-round'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('second-round'),
        }));

        expect(decodeWrites(pair).filter(message => message.type === 'ops_req')).toHaveLength(1);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'complete',
        }));
    });

    it('rejects operation data outside the active request', async () => {
        const [requested, unsolicited] = await makeOperations(2);
        const protocolNode = await createNode();
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [requested.signature!.hash],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('request-operation'),
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [unsolicited]),
        ));

        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects an operation page for the wrong request', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operation.signature!.hash],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('wrong-request'),
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [operation], { requestId: 1 }),
        ));

        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects a non-final page that delivered every requested operation', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operation.signature!.hash],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('false-continuation'),
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [operation], { hasMore: true }),
        ));

        expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('fails a missing final requested operation without quarantining the peer', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operation.signature!.hash],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('missing-operation'),
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, []),
        ));

        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'missing_requested_operations',
        }));
        expect(pair.connectionA.destroyed).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 0 } });
    });

    it('accepts a deferred empty offer response and closes the window incomplete', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [operation.signature!.hash],
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('deferred-offer'),
        }));
        const offer = decodeWrites(pair).find(message => message.type === 'ops_offer')!;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            offerId: offer.offerId,
            ids: [],
            deferred: true,
        }));

        expect(decodeWrites(pair).some(message => message.type === 'ops_push')).toBe(false);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'incomplete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('serves a partial deferred offer response before closing incomplete', async () => {
        const operations = await makeOperations(2);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany(operations.map(operation => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        })));
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: operations.map(operation => operation.signature!.hash),
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('partial-deferred-offer'),
        }));
        const offer = decodeWrites(pair).find(message => message.type === 'ops_offer')!;
        const requestedId = (offer.ids as string[])[0];

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            offerId: offer.offerId,
            ids: [requestedId],
            deferred: true,
        }));
        const push = decodeWrites(pair).find(message => message.type === 'ops_push')!;
        expect(push).toMatchObject({ page: 0, hasMore: false });
        expect((push.data as Operation[]).map(operation => operation.signature!.hash)).toEqual([requestedId]);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_ack',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            page: 0,
        }));

        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'incomplete',
        }));
    });

    it('closes incomplete when a requested page acknowledgement reports backpressure', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [operation.signature!.hash],
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('deferred-ack'),
        }));
        const offer = decodeWrites(pair).find(message => message.type === 'ops_offer')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            offerId: offer.offerId,
            ids: offer.ids,
        }));
        const push = decodeWrites(pair).find(message => message.type === 'ops_push')!;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_ack',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: push.round,
            requestId: push.requestId,
            page: push.page,
            deferred: true,
        }));

        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'incomplete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('rejects an offer response containing an ID outside the offer', async () => {
        const [offered, unsolicited] = await makeOperations(2);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany([{
            id: offered.signature!.hash,
            ts: Math.floor(Date.parse(offered.signature!.signed) / 1000),
            operation: offered,
        }]);
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [offered.signature!.hash],
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('invalid-offer-subset'),
        }));
        const offer = decodeWrites(pair).find(message => message.type === 'ops_offer')!;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: offer.round,
            requestId: 0,
            offerId: offer.offerId,
            ids: [unsolicited.signature!.hash],
        }));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects repeated offered IDs after acknowledging the first offer', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        mockTerminalResponder(protocolNode);
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_offer',
            sessionId: open.sessionId,
            windowId: open.windowId,
            offerId: 0,
            ids: [operation.signature!.hash],
        }));
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'ops_req',
            offerId: 0,
            ids: [],
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_offer',
            sessionId: open.sessionId,
            windowId: open.windowId,
            offerId: 1,
            ids: [operation.signature!.hash],
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('notifies the offering peer when checking an operation fails', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        mockTerminalResponder(protocolNode);
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        jest.spyOn(protocolNode.store, 'getByIds').mockRejectedValueOnce(new Error('lookup failed'));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_offer',
            sessionId: open.sessionId,
            windowId: open.windowId,
            offerId: 0,
            ids: [hash('a')],
        }));

        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'ops_offer_lookup_failed',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('bounds cumulative offers within the active window', async () => {
        const operations = await makeOperations(2);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33, maxRecords: 1 });
        mockTerminalResponder(protocolNode);
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_offer',
            sessionId: open.sessionId,
            windowId: open.windowId,
            offerId: 0,
            ids: [operations[0].signature!.hash],
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [operations[0]]),
        ));
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({ type: 'ops_ack', page: 0 }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_offer',
            sessionId: open.sessionId,
            windowId: open.windowId,
            offerId: 1,
            ids: [operations[1].signature!.hash],
        }));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('bounds cumulative direct requests within the active window', async () => {
        const operations = await makeOperations(2);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33, maxRecords: 1 });
        await protocolNode.store.upsertMany(operations.map(operation => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        })));
        mockTerminalResponder(protocolNode);
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            requestId: 0,
            ids: [operations[0].signature!.hash],
        }));
        const firstPush = decodeWrites(pair).find(message => message.type === 'ops_push')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_ack',
            sessionId: open.sessionId,
            windowId: open.windowId,
            requestId: 0,
            page: firstPush.page,
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            requestId: 1,
            ids: [operations[1].signature!.hash],
        }));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects a direct operation request sent to the session initiator', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            requestId: 0,
            ids: [hash('a')],
        }));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('blocks every new inbound session until the repair delay expires', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        mockTerminalResponder(protocolNode);
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'incomplete',
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'sync_busy',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();

        const nextOpen = { ...open, sessionId: 'new-session-after-repair' };
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
        try {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, nextOpen));
        }
        finally {
            nowSpy.mockRestore();
        }

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: nextOpen.sessionId });
    });

    it('ignores stale control rounds and quarantines a future round', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey));
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: 'stale-window',
            round: 0,
            frame: { encoding: 'utf8', data: 'ignored-stale-frame' },
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 2,
            frame: open.frame,
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('admits one inbound session globally and sends one busy response per slot generation', async () => {
        const openA = await createRemoteOpen();
        const openB = { ...await createRemoteOpen(), sessionId: 'second-remote-session' };
        const protocolNode = await createNode({ keyByte: 0x33 });
        mockTerminalResponder(protocolNode);
        const peerA = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        const peerB = attachPeer(protocolNode, { peerKeyByte: 0x11 });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerA.peerKey, openA),
        );
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerB.peerKey, openB),
        );
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerB.peerKey, openB),
        );

        expect(decodeWrites(peerB.pair).filter(message => (
            message.type === 'neg_close' && message.reason === 'sync_busy'
        ))).toHaveLength(1);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerB.peerKey)?.activeSession,
        )).toBeNull();

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerA.peerKey, {
            type: 'neg_close',
            sessionId: openA.sessionId,
            windowId: openA.windowId,
            reason: 'remote_closed',
        }));
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerB.peerKey, openB),
        );

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerB.peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: openB.sessionId });
    });

    it('releases the global slot when an inbound snapshot build fails', async () => {
        const openA = await createRemoteOpen();
        const openB = { ...await createRemoteOpen(), sessionId: 'session-after-snapshot-failure' };
        const protocolNode = await createNode({ keyByte: 0x33 });
        jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow')
            .mockRejectedValueOnce(new Error('snapshot failed'));
        const peerA = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        const peerB = attachPeer(protocolNode, { peerKeyByte: 0x11 });

        await expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerA.peerKey, openA),
        )).rejects.toThrow('snapshot failed');
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerA.peerKey)?.activeSession,
        )).toBeNull();

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerB.peerKey, openB),
        );
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerB.peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: openB.sessionId });
    });

    it('offers periodic synchronization opportunities in peer-key order and advances past a disconnect', async () => {
        const protocolNode = await createNode({ keyByte: 0x11 });
        const ready = {
            syncMode: 'negentropy',
            syncStarted: true,
            lastNegentropyAttemptAt: 0,
            negentropySynced: false,
        };
        const first = attachPeer(protocolNode, { peerKeyByte: 0x22, overrides: ready });
        const second = attachPeer(protocolNode, { peerKeyByte: 0x33, overrides: ready });
        const third = attachPeer(protocolNode, { peerKeyByte: 0x44, overrides: ready });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.schedulePreferredSyncs(),
        );
        const firstOpen = decodeWrites(first.pair).find(message => message.type === 'neg_open')!;
        expect(firstOpen).toBeDefined();

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(first.peerKey, {
            type: 'neg_close',
            sessionId: firstOpen.sessionId,
            windowId: firstOpen.windowId,
            reason: 'remote_closed',
        }));
        await eventually(() => decodeWrites(second.pair).some(message => message.type === 'neg_open'));

        protocolNode.node.run(() => protocolNode.node.mediator.__test.disconnectPeer(second.peerKey));
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.schedulePreferredSyncs(),
        );
        await eventually(() => decodeWrites(third.pair).some(message => message.type === 'neg_open'));
    });

    it.each(['snapshot rebuild', 'initiator reconciliation'] as const)(
        'does not open a stale window after its session is replaced during %s',
        async boundary => {
            const protocolNode = await createNode();
            const initialPeer = attachPeer(protocolNode, {});
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
                const replacementPeer = attachPeer(protocolNode, {});
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
                const replacement = attachPeer(protocolNode, {});
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
        const { peerKey, pair } = attachPeer(protocolNode, {});
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
                encodeFramedMessage(JSON.stringify({ type: 'queue', relays: [], data: [operations[0]] })),
            ));
            await firstBuildStarted;
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({ type: 'queue', relays: [], data: [operations[1]] })),
            ));
            await eventually(async () => (await protocolNode.store.count()) === 2);
            await nextTurn();

            releaseFirstBuild();
            await eventually(() => buildCalls >= 2);
            await secondBuildFinished;
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
            );

            expect(buildCalls).toBe(3);
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

    it('defers a queued background rebuild until ordered catch-up completes', async () => {
        const operations = await makeOperations(3);
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
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
        let markFirstBuildFinished!: () => void;
        const firstBuildFinished = new Promise<void>(resolve => {
            markFirstBuildFinished = resolve;
        });
        let lastBuiltRecordCount = 0;
        jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow').mockImplementation(async window => {
            buildCalls += 1;
            const call = buildCalls;
            if (call === 1) {
                markFirstBuildStarted();
                await firstBuildBlocked;
            }
            const snapshot = await buildSnapshot(window);
            lastBuiltRecordCount = snapshot.stats.loaded;
            if (call === 1) {
                markFirstBuildFinished();
            }
            return snapshot;
        });

        const send = async (message: Record<string, unknown>) => protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerKey, message),
        );

        try {
            await send({ type: 'queue', relays: [], data: [operations[0]] });
            await firstBuildStarted;
            protocolNode.node.run(
                () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'deferred-build-session'),
            );
            await send({
                type: 'ordered_catchup_push',
                sessionId: 'deferred-build-session',
                cursor: { syncOrder: 1, id: operations[1].signature!.hash },
                hasMore: true,
                data: [operations[1]],
            });
            await eventually(() => protocolNode.store.has(operations[1].signature!.hash));

            releaseFirstBuild();
            await firstBuildFinished;
            await nextTurn();
            expect(buildCalls).toBe(1);

            await send({
                type: 'ordered_catchup_push',
                sessionId: 'deferred-build-session',
                cursor: { syncOrder: 2, id: operations[2].signature!.hash },
                hasMore: false,
                data: [operations[2]],
            });
            await eventually(() => decodeWrites(pair).some(message => message.type === 'neg_open'));

            expect(buildCalls).toBe(2);
            expect(lastBuiltRecordCount).toBe(3);
        }
        finally {
            releaseFirstBuild();
        }
    });

    it.each(['responder snapshot', 'frame reconciliation'] as const)(
        'does not send stale traffic after replacement during %s',
        async boundary => {
            const operations = await makeOperations(1);
            const open = await createRemoteOpen(operations);
            const protocolNode = await createNode({ keyByte: 0x33 });
            const initialPeer = attachPeer(protocolNode, {});
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

    it.each(['completes', 'fails'] as const)(
        'does not send a stale transfer message when operation lookup %s after replacement',
        async lookupOutcome => {
            const [operation] = await makeOperations(1);
            const protocolNode = await createNode();
            await protocolNode.store.upsertMany([{
                id: operation.signature!.hash,
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                operation,
            }]);
            const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
            jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
                const engine = createEngine(snapshot);
                jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                    nextMsg: null,
                    haveIds: [operation.signature!.hash],
                    needIds: [],
                });
                return engine;
            });
            const initialPeer = attachPeer(protocolNode, {});
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(initialPeer.peerKey),
            );
            const open = decodeWrites(initialPeer.pair).find(message => message.type === 'neg_open');
            if (!open) {
                throw new Error('expected local neg_open');
            }
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(initialPeer.peerKey, {
                type: 'neg_msg',
                sessionId: open.sessionId,
                windowId: open.windowId,
                frame: encodeNegentropyFrame('offer-operation'),
            }));
            const offer = decodeWrites(initialPeer.pair).find(message => message.type === 'ops_offer');
            if (!offer) {
                throw new Error('expected local ops_offer');
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
                if (lookupOutcome === 'fails') {
                    throw new Error('lookup failed');
                }
                return getByIds(ids);
            });

            const request = protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
                initialPeer.peerKey,
                {
                    type: 'ops_req',
                    sessionId: open.sessionId,
                    windowId: open.windowId,
                    round: offer.round,
                    requestId: 0,
                    offerId: offer.offerId,
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
            expect(replacementMessages.some(message => message.sessionId === open.sessionId)).toBe(false);
        },
    );

    it('keeps rejected push lookups linear', async () => {
        const cipher = new CipherNode();
        const operations = Array.from({ length: 1_001 }, (_, index) => {
            const unsigned = {
                type: 'create' as const,
                created: '2026-01-01T00:00:00.000Z',
                mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
                data: index,
            };
            return {
                ...unsigned,
                signature: {
                    hash: cipher.hashJSON(unsigned),
                    signed: '2026-01-01T00:00:00.000Z',
                    value: 'signature',
                },
            } as Operation;
        });
        const requestedIds = operations.map(operation => operation.signature!.hash);
        const protocolNode = await createNode({ maxRecords: requestedIds.length });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: requestedIds,
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockImplementation(async events => ({
            queued: 0,
            processed: 0,
            rejected: events.length,
            total: 0,
            rejectedIndices: events.map((_, index) => index),
        }));
        const getByIds = protocolNode.store.getByIds.bind(protocolNode.store);
        const lookupSizes: number[] = [];
        jest.spyOn(protocolNode.store, 'getByIds').mockImplementation(async ids => {
            lookupSizes.push(ids.length);
            return getByIds(ids);
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('persistence-confirmation'),
        }));

        let offset = 0;
        while (offset < operations.length) {
            const request = decodeWrites(pair).filter(message => message.type === 'ops_req').at(-1)!;
            const requested = request.ids as string[];
            for (let page = 0; page * 300 < requested.length; page += 1) {
                const count = Math.min(300, requested.length - (page * 300));
                const data = operations.slice(offset, offset + count);
                offset += count;
                await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                    ...requestedOpsPush(pair, data),
                    requestId: request.requestId,
                    page,
                    hasMore: ((page + 1) * 300) < requested.length,
                }));
            }
        }

        expect(lookupSizes.length).toBeGreaterThan(0);
        expect(Math.max(...lookupSizes)).toBeLessThanOrEqual(300);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });
        expect(decodeWrites(pair).filter(message => message.type === 'neg_open')).toHaveLength(2);
        expect(decodeWrites(pair).some(message => (
            message.type === 'neg_close' && message.reason === 'complete'
        ))).toBe(false);
    });

    it('persists terminal Gatekeeper rejects after accepted history and completes the session', async () => {
        const [acceptedOperation, rejectedOperation] = await makeOperations(2);
        const acceptedId = acceptedOperation.signature!.hash;
        const rejectedId = rejectedOperation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [acceptedId, rejectedId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 2,
            processed: 0,
            rejected: 0,
            total: 2,
            rejectedIndices: [],
        });
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            added: 1,
            merged: 0,
            rejected: 1,
            pending: 0,
            acceptedHashes: [acceptedId],
            acceptedEvents: [],
            rejectedOperations: [rejectedOperation],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('terminal-reject'),
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [acceptedOperation, rejectedOperation]),
        ));

        const records = await protocolNode.store.getByIds([acceptedId, rejectedId]);
        expect(records).toHaveLength(2);
        expect(records.find(record => record.id === acceptedId)?.syncOrder).toBeUndefined();
        expect(records.find(record => record.id === rejectedId)?.syncOrder).toBe(Number.MAX_SAFE_INTEGER);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('terminally indexes an unresolved pre-v0.5 update without previd at final completion', async () => {
        const operation = await makeLegacyUpdateWithoutPrevid();
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 1,
            processed: 0,
            rejected: 0,
            total: 1,
            rejectedIndices: [],
        });
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            added: 0,
            merged: 0,
            rejected: 0,
            pending: 1,
            acceptedHashes: [],
            acceptedEvents: [],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('legacy-without-previd'),
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [operation]),
        ));

        expect((await protocolNode.store.getByIds([operationId]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));
    });

    it('completes when terminal work finds an unresolved operation already stored normally', async () => {
        const operation = await makeLegacyUpdateWithoutPrevid();
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 1,
            processed: 0,
            rejected: 0,
            total: 1,
            rejectedIndices: [],
        });
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            added: 0,
            merged: 0,
            rejected: 0,
            pending: 1,
            acceptedHashes: [],
            acceptedEvents: [],
        });
        const getByIds = protocolNode.store.getByIds.bind(protocolNode.store);
        let operationLookups = 0;
        jest.spyOn(protocolNode.store, 'getByIds').mockImplementation(async ids => {
            if (ids.includes(operationId) && ++operationLookups === 2) {
                await protocolNode.store.upsertMany([{
                    id: operationId,
                    signedTs: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                    operation,
                }]);
                return [];
            }
            return getByIds(ids);
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('normally-stored-terminal-candidate'),
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [operation]),
        ));

        expect(operationLookups).toBe(3);
        expect((await getByIds([operationId]))[0].syncOrder).toBeUndefined();
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('leaves a modern update with an unknown predecessor unresolved', async () => {
        const operation = await makeModernUpdateWithMissingPredecessor();
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 1,
            processed: 0,
            rejected: 0,
            total: 1,
            rejectedIndices: [],
        });
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            added: 0,
            merged: 0,
            rejected: 0,
            pending: 1,
            acceptedHashes: [],
            acceptedEvents: [],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('modern-missing-predecessor'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);

        expect(await protocolNode.store.has(operationId)).toBe(false);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'unresolved_operations',
        }));
    });

    it('fails a session before retained unresolved operation bytes exceed the limit', async () => {
        const cipher = new CipherNode();
        const operations = Array.from({ length: 5 }, (_, index) => {
            const created = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index).toISOString();
            const unsigned: Operation = {
                type: 'create',
                created,
                mdip: {
                    version: 1,
                    type: 'asset',
                    registry: 'hyperswarm',
                },
                data: `${index}:${'x'.repeat(430 * 1024)}`,
            };
            return {
                ...unsigned,
                signature: {
                    signed: created,
                    hash: cipher.hashJSON(unsigned),
                    value: 'test-signature',
                },
            } as Operation;
        });
        const ids = operations.map(operation => operation.signature!.hash);
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: ids,
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockImplementation(async events => ({
            queued: events.length,
            processed: 0,
            rejected: 0,
            total: events.length,
            rejectedIndices: [],
        }));
        protocolNode.node.gatekeeperClient.processEvents.mockImplementation(async () => ({
            added: 0,
            merged: 0,
            rejected: 0,
            pending: 1,
            acceptedHashes: [],
            acceptedEvents: [],
        }));

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('large-unresolved-operations'),
        }));

        for (const [page, operation] of operations.entries()) {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
                peerKey,
                requestedOpsPush(pair, [operation], {
                    page,
                    hasMore: page < operations.length - 1,
                }),
            ));
        }

        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'unresolved_limit_exceeded',
        }));
        expect(decodeWrites(pair).filter(message => message.type === 'ops_ack')).toHaveLength(4);
    });

    it('fails a session before retaining more than 1,000 unresolved operations', async () => {
        const cipher = new CipherNode();
        const operations = Array.from({ length: 1_001 }, (_, index) => {
            const created = new Date(Date.parse('2026-01-01T00:00:00.000Z') + index).toISOString();
            const unsigned: Operation = {
                type: 'create',
                created,
                mdip: {
                    version: 1,
                    type: 'asset',
                    registry: 'hyperswarm',
                },
                data: index,
            };
            const operation: Operation = {
                ...unsigned,
                signature: {
                    signed: created,
                    hash: cipher.hashJSON(unsigned),
                    value: 'test-signature',
                },
            };
            return operation;
        });
        const ids = operations.map(operation => operation.signature!.hash);
        const protocolNode = await createNode({ maxRecords: operations.length });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: ids,
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockImplementation(async events => ({
            queued: events.length,
            processed: 0,
            rejected: 0,
            total: events.length,
            rejectedIndices: [],
        }));
        protocolNode.node.gatekeeperClient.processEvents.mockImplementation(async () => ({
            added: 0,
            merged: 0,
            rejected: 0,
            pending: 1,
            acceptedHashes: [],
            acceptedEvents: [],
        }));

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('many-unresolved-operations'),
        }));

        for (let offset = 0, page = 0; offset < 1_000; offset += 300, page += 1) {
            const data = operations.slice(offset, Math.min(offset + 300, 1_000));
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
                peerKey,
                requestedOpsPush(pair, data, {
                    page,
                    hasMore: offset + data.length < 1_000,
                }),
            ));
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(
            peerKey,
            requestedOpsPush(pair, [operations[1_000]]),
        ));

        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'unresolved_limit_exceeded',
        }));
        expect(decodeWrites(pair).filter(message => message.type === 'ops_ack')).toHaveLength(4);
    });

    it('closes a Negentropy session as incomplete after Gatekeeper backpressure', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 0,
            processed: 0,
            rejected: 0,
            total: 0,
            rejectedIndices: [],
            processedIndices: [],
            capacityDeferred: 1,
            capacityDeferredIndices: [0],
        });
        const processEvents = protocolNode.node.gatekeeperClient.processEvents;

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('capacity-backpressure'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);

        expect(processEvents).not.toHaveBeenCalled();
        expect(await protocolNode.store.has(operationId)).toBe(false);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'ops_ack',
            page: 0,
            deferred: true,
        }));
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'incomplete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('does not split an incomplete window after a remote round cap', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'next-frame',
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 0,
            processed: 0,
            rejected: 0,
            total: 0,
            rejectedIndices: [],
            processedIndices: [],
            capacityDeferred: 1,
            capacityDeferredIndices: [0],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('capacity-before-round-cap'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'max_rounds_reached',
        }));

        expect(decodeWrites(pair).filter(message => message.type === 'neg_open')).toHaveLength(1);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'incomplete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('does not split an incomplete window after reaching the local round cap', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode({ maxRounds: 1 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'next-frame',
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 0,
            processed: 0,
            rejected: 0,
            total: 0,
            rejectedIndices: [],
            processedIndices: [],
            capacityDeferred: 1,
            capacityDeferredIndices: [0],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('capacity-before-local-round-cap'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 2,
            frame: encodeNegentropyFrame('local-round-cap'),
        }));

        expect(decodeWrites(pair).filter(message => message.type === 'neg_open')).toHaveLength(1);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'incomplete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('does not accept remote completion after responder-side Gatekeeper backpressure', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        mockTerminalResponder(protocolNode);
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 0,
            processed: 0,
            rejected: 0,
            total: 0,
            rejectedIndices: [],
            processedIndices: [],
            capacityDeferred: 1,
            capacityDeferredIndices: [0],
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));

        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'ops_ack',
            deferred: true,
        }));
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'incomplete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: {
                sessionsCompleted: 0,
                sessionsFailed: 1,
            },
        });
    });

    it('closes a backpressured Negentropy session when its close message cannot be sent', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 0,
            processed: 0,
            rejected: 0,
            total: 0,
            rejectedIndices: [],
            processedIndices: [],
            capacityDeferred: 1,
            capacityDeferredIndices: [0],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('capacity-backpressure-send-failure'),
        }));
        jest.spyOn(pair.connectionA, 'write').mockImplementation(() => {
            throw new Error('write failed');
        });
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('uses a previously deferred operation rejected by a later batch as a terminal fork root', async () => {
        const [trigger, , root, child] = await makeDependencyChain();
        const rootId = root.signature!.hash;
        const childId = child.signature!.hash;
        const triggerId = trigger.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [rootId, childId, triggerId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch
            .mockResolvedValueOnce({
                queued: 2,
                processed: 0,
                rejected: 0,
                total: 2,
                rejectedIndices: [],
            })
            .mockResolvedValueOnce({
                queued: 1,
                processed: 0,
                rejected: 0,
                total: 1,
                rejectedIndices: [],
            });
        protocolNode.node.gatekeeperClient.processEvents
            .mockResolvedValueOnce({
                added: 0,
                merged: 0,
                rejected: 0,
                pending: 2,
                acceptedHashes: [],
                acceptedEvents: [],
            })
            .mockResolvedValueOnce({
                added: 1,
                merged: 0,
                rejected: 1,
                pending: 1,
                acceptedHashes: [triggerId],
                acceptedEvents: [],
                rejectedOperations: [root],
            });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('delayed-terminal-root'),
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...requestedOpsPush(pair, [root, child]),
            hasMore: true,
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...requestedOpsPush(pair, [trigger]),
            page: 1,
        }));

        expect((await protocolNode.store.getByIds([rootId]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        expect((await protocolNode.store.getByIds([childId]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        expect(await protocolNode.store.has(triggerId)).toBe(true);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));
    });

    it.each([
        ['deferred', { added: 0, merged: 0, rejected: 0, pending: 1 }],
        ['processed but unproven', { added: 0, merged: 0, rejected: 0, pending: 0 }],
        ['legacy rejection count without operations', { added: 0, merged: 0, rejected: 1, pending: 0 }],
    ])('does not persist %s operations as terminal rejects', async (_case, processResult) => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [operationId],
            });
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 1,
            processed: 0,
            rejected: 0,
            total: 1,
            rejectedIndices: [],
        });
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            ...processResult,
            acceptedHashes: [],
            acceptedEvents: [],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('non-terminal-reject'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);

        expect(await protocolNode.store.has(operationId)).toBe(false);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'unresolved_operations',
        }));
    });

    it('terminally indexes a structurally rejected operation and completes the final window', async () => {
        const rejectedOperation = makeStructurallyRejectedOperation();
        const rejectedId = rejectedOperation.signature!.hash;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [rejectedId],
            });
            return engine;
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('rejected-final-window'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [rejectedOperation]);

        expect((await protocolNode.store.getByIds([rejectedId]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('does not let a structural reject reserve a mismatched operation ID', async () => {
        const [legitimateOperation] = await makeOperations(1);
        const legitimateId = legitimateOperation.signature!.hash;
        const malformedOperation = { ...legitimateOperation };
        delete malformedOperation.publicJwk;
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [legitimateId],
            });
            return engine;
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('mismatched-operation-id'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [malformedOperation]);

        expect(await protocolNode.store.has(legitimateId)).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 1 } });
        expect(decodeWrites(pair)).not.toContainEqual(expect.objectContaining({ type: 'neg_close' }));
        expect(await protocolNode.node.gatekeeper.getDIDs()).toHaveLength(0);
    });

    it('advances past a terminal structural rejection across capped windows', async () => {
        const [localA, localB, rejectedOperation] = await makeOperations(3);
        const rejectedId = rejectedOperation.signature!.hash;
        const protocolNode = await createNode({ maxRecords: 1 });
        await protocolNode.store.upsertMany([localA, localB].map(operation => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        })));
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        const outcomes = [
            { nextMsg: null, haveIds: [], needIds: [rejectedId] },
            { nextMsg: null, haveIds: [], needIds: [] },
            { nextMsg: null, haveIds: [], needIds: [] },
        ];
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementation(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce(outcomes.shift()!);
            return engine;
        });
        protocolNode.node.gatekeeperClient.importBatch.mockImplementationOnce(async events => ({
            queued: 0,
            processed: 0,
            rejected: events.length,
            total: 0,
            rejectedIndices: events.map((_, index) => index),
        }));

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const firstOpen = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!firstOpen) {
            throw new Error('expected first neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: firstOpen.sessionId,
            windowId: firstOpen.windowId,
            frame: encodeNegentropyFrame('rejected-capped-window'),
        }));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, firstOpen, [rejectedOperation]);

        const opens = decodeWrites(pair).filter(message => message.type === 'neg_open');
        expect(opens).toHaveLength(2);
        expect(opens[1]).toMatchObject({
            sessionId: firstOpen.sessionId,
            window: { order: 1, after: expect.any(Object) },
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: opens[1].sessionId,
            windowId: opens[1].windowId,
            frame: encodeNegentropyFrame('second-capped-window'),
        }));

        const finalOpen = decodeWrites(pair).filter(message => message.type === 'neg_open')[2];
        expect(finalOpen).toMatchObject({
            sessionId: firstOpen.sessionId,
            window: { order: 2, after: expect.any(Object) },
        });
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: finalOpen.sessionId,
            windowId: finalOpen.windowId,
            frame: encodeNegentropyFrame('final-window-after-terminal-reject'),
        }));

        expect((await protocolNode.store.getByIds([rejectedId]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            sessionId: firstOpen.sessionId,
            windowId: finalOpen.windowId,
            reason: 'complete',
        }));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('reuses capped history windows but always rebuilds the dynamic tail', async () => {
        const operations = await makeOperations(13);
        const protocolNode = await createNode({ maxRecords: 2 });
        await protocolNode.store.upsertMany(operations.map(operation => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        })));
        const buildSnapshot = jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow');
        mockTerminalResponder(protocolNode);

        const completeSession = async ({ peerKey, pair }: AttachedPeer): Promise<number> => {
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
            );

            let completedWindows = 0;
            while (protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )) {
                const open = decodeWrites(pair)
                    .filter(message => message.type === 'neg_open')[completedWindows];
                if (!open) {
                    throw new Error('expected next negentropy window');
                }
                completedWindows += 1;
                await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                    type: 'neg_msg',
                    sessionId: open.sessionId,
                    windowId: open.windowId,
                    frame: encodeNegentropyFrame(`complete-window-${completedWindows}`),
                }));
            }
            return completedWindows;
        };

        const firstPeer = attachPeer(protocolNode);
        expect(await completeSession(firstPeer)).toBe(7);
        expect(buildSnapshot).toHaveBeenCalledTimes(7);

        protocolNode.node.run(() => protocolNode.node.mediator.__test.disconnectPeer(firstPeer.peerKey));
        const secondPeer = attachPeer(protocolNode);
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
        try {
            expect(await completeSession(secondPeer)).toBe(7);
        }
        finally {
            nowSpy.mockRestore();
        }
        expect(buildSnapshot).toHaveBeenCalledTimes(8);

        protocolNode.node.run(() => protocolNode.node.mediator.__test.disconnectPeer(secondPeer.peerKey));
        const thirdPeer = attachPeer(protocolNode);
        const [newOperation] = await makeOperations(1);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(thirdPeer.peerKey, {
            type: 'queue',
            time: new Date().toISOString(),
            node: 'peer',
            relays: [],
            data: [newOperation],
        }));
        await eventually(() => protocolNode.store.has(newOperation.signature!.hash));

        expect(await completeSession(thirdPeer)).toBe(7);
        expect(buildSnapshot).toHaveBeenCalledTimes(15);
    });

    it('retains only canonical responder history windows', async () => {
        const operations = await makeOperations(13);
        const protocolNode = await createNode({ maxRecords: 2 });
        await protocolNode.store.upsertMany(operations.map(operation => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        })));
        const buildSnapshot = jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow');
        mockTerminalResponder(protocolNode);
        const { peerKey } = attachPeer(protocolNode);
        const toTs = Math.floor(Date.now() / 1000);
        const windows = [buildInitialHistoryWindow(MDIP_EPOCH_SECONDS, toTs, 2)];
        for (let order = 1; order < 7; order += 1) {
            const operation = operations[(order * 2) - 1];
            windows.push(buildNextHistoryPage(windows[order - 1], {
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                id: operation.signature!.hash,
            }, order));
        }
        const sendWindows = async (sessionId: string, selected = windows): Promise<void> => {
            for (const [round, window] of selected.entries()) {
                await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                    type: 'neg_open',
                    sessionId,
                    windowId: makeWindowId(window),
                    window,
                    round,
                    frame: encodeNegentropyFrame(`${sessionId}-${window.order}`),
                }));
            }
            const lastWindow = selected.at(-1);
            if (lastWindow) {
                await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                    type: 'neg_close',
                    sessionId,
                    windowId: makeWindowId(lastWindow),
                    reason: 'complete',
                }));
            }
        };

        await sendWindows('canonical-first');
        expect(buildSnapshot).toHaveBeenCalledTimes(7);

        await sendWindows('canonical-second');
        expect(buildSnapshot).toHaveBeenCalledTimes(8);

        const arbitraryWindow = { ...windows[0], order: 100 };
        await sendWindows('arbitrary-first', [arbitraryWindow]);
        await sendWindows('arbitrary-second', [arbitraryWindow]);
        expect(buildSnapshot).toHaveBeenCalledTimes(10);

        await sendWindows('canonical-third');
        expect(buildSnapshot).toHaveBeenCalledTimes(11);
    });

    it('closes a session when sending neg_open throws', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
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
            const { peerKey, pair } = attachPeer(protocolNode, {});
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
                    round: 1,
                    frame: encodeNegentropyFrame(peerOutcome.nextMsg!),
                })),
            ));

            const attemptedChunk = write.mock.calls[0]?.[0] as Uint8Array;
            expect(JSON.parse(
                decodeFramedMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
            )).toMatchObject({ type: failedType, sessionId: open.sessionId });
            await expectFailedNegentropySessionCanRetry(protocolNode, peerKey, pair, open.sessionId);
        },
    );

    it('closes an incomplete session when sending neg_msg fails and permits repair', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen([operation]);
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const write = jest.spyOn(pair.connectionA, 'write').mockImplementationOnce(() => {
            throw new Error('neg_msg write failed');
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(open)),
        ));

        const attemptedChunk = write.mock.calls[0]?.[0] as Uint8Array;
        expect(JSON.parse(
            decodeFramedMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
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
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [operation.signature!.hash],
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open');
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('offer-for-failed-push'),
        }));
        const offer = decodeWrites(pair).find(message => message.type === 'ops_offer')!;
        const write = jest.spyOn(pair.connectionA, 'write').mockImplementationOnce(() => {
            throw new Error('ops_push write failed');
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ops_req',
                sessionId: open.sessionId,
                windowId: open.windowId,
                round: offer.round,
                requestId: 0,
                offerId: offer.offerId,
                ids: [operation.signature!.hash],
            })),
        ));

        const attemptedChunk = write.mock.calls[0]?.[0] as Uint8Array;
        expect(JSON.parse(
            decodeFramedMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
        )).toMatchObject({ type: 'ops_push', sessionId: open.sessionId });
        await expectFailedNegentropySessionCanRetry(protocolNode, peerKey, pair, open.sessionId);
    });

    it('starts eligible periodic repair without requiring a timer loop', async () => {
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {
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

    it('uses Negentropy for a one-window gap between mature stores', async () => {
        const protocolNode = await createNode({
            maxRecords: 25_000,
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                    operationCount: 275_000,
                    orderedOperationCount: 275_000,
                }),
            },
        });
        jest.spyOn(protocolNode.store, 'count').mockResolvedValue(250_000);
        jest.spyOn(protocolNode.store, 'countOrdered').mockResolvedValue(250_000);

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );

        const messages = decodeWrites(pair);
        expect(messages.filter(message => message.type === 'ordered_catchup_req')).toHaveLength(0);
        expect(messages.filter(message => message.type === 'neg_open')).toHaveLength(1);
    });

    it('serializes peer sync decisions while a store count is pending', async () => {
        const protocolNode = await createNode({
            maxRecords: 4,
        });
        const firstPeer = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
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
        const secondPeer = attachPeer(protocolNode, {
            peerKeyByte: 0x33,
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
        const originalCount = protocolNode.store.count.bind(protocolNode.store);
        let markCountStarted!: () => void;
        const countStarted = new Promise<void>(resolve => {
            markCountStarted = resolve;
        });
        let releaseCount!: () => void;
        const countBlocked = new Promise<void>(resolve => {
            releaseCount = resolve;
        });
        const count = jest.spyOn(protocolNode.store, 'count').mockImplementationOnce(async () => {
            markCountStarted();
            await countBlocked;
            return originalCount();
        });

        const firstStart = protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(firstPeer.peerKey),
        );

        try {
            await countStarted;
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(secondPeer.peerKey),
            );
            expect(count).toHaveBeenCalledTimes(1);
            expect(decodeWrites(firstPeer.pair)).toHaveLength(0);
            expect(decodeWrites(secondPeer.pair)).toHaveLength(0);

            releaseCount();
            await firstStart;

            expect(decodeWrites(firstPeer.pair).filter(
                message => message.type === 'ordered_catchup_req',
            )).toHaveLength(1);
            expect(decodeWrites(secondPeer.pair)).toHaveLength(0);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(firstPeer.peerKey)?.activeSession,
            )).toEqual(expect.objectContaining({ mode: 'ordered_catchup' }));
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(secondPeer.peerKey),
            )).toMatchObject({
                syncMode: 'negentropy',
                syncStarted: false,
                activeSession: null,
            });
        }
        finally {
            releaseCount();
            await firstStart.catch(() => undefined);
        }
    });

    it('does not restart Negentropy when an older store count resumes after completion', async () => {
        const remoteOpen = await createRemoteOpen();
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const count = protocolNode.store.count.bind(protocolNode.store);
        let markCountStarted!: () => void;
        const countStarted = new Promise<void>(resolve => {
            markCountStarted = resolve;
        });
        let releaseCount!: () => void;
        const countBlocked = new Promise<void>(resolve => {
            releaseCount = resolve;
        });
        jest.spyOn(protocolNode.store, 'count').mockImplementationOnce(async () => {
            markCountStarted();
            await countBlocked;
            return count();
        });
        mockTerminalResponder(protocolNode);
        const createEngine = jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot');

        const staleStart = protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        try {
            await countStarted;
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, remoteOpen));
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                type: 'neg_close',
                sessionId: remoteOpen.sessionId,
                windowId: remoteOpen.windowId,
                reason: 'complete',
            }));
            const engineCount = createEngine.mock.calls.length;
            releaseCount();
            await staleStart;

            expect(decodeWrites(pair).filter(message => message.type === 'neg_open')).toHaveLength(0);
            expect(createEngine).toHaveBeenCalledTimes(engineCount);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
            )).toMatchObject({ activeSession: null });
        }
        finally {
            releaseCount();
            await staleStart.catch(() => undefined);
        }
    });

    it('does not replace an ordered session when an older store count resumes', async () => {
        const protocolNode = await createNode({
            maxRecords: 4,
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
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
        const count = protocolNode.store.count.bind(protocolNode.store);
        let markCountStarted!: () => void;
        const countStarted = new Promise<void>(resolve => {
            markCountStarted = resolve;
        });
        let releaseCount!: () => void;
        const countBlocked = new Promise<void>(resolve => {
            releaseCount = resolve;
        });
        jest.spyOn(protocolNode.store, 'count').mockImplementationOnce(async () => {
            markCountStarted();
            await countBlocked;
            return count();
        });
        const staleStart = protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        try {
            await countStarted;
            protocolNode.node.run(
                () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                    peerKey,
                    'replacement-session',
                ),
            );
            releaseCount();
            await staleStart;

            expect(decodeWrites(pair).filter(message => message.type === 'ordered_catchup_req')).toHaveLength(0);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toEqual({ mode: 'ordered_catchup', sessionId: 'replacement-session' });
        }
        finally {
            releaseCount();
            await staleStart.catch(() => undefined);
        }
    });

    it('does not start ordered catch-up when an older store count resumes after completion', async () => {
        const remoteOpen = await createRemoteOpen();
        const protocolNode = await createNode({
            maxRecords: 4,
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
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
        const count = protocolNode.store.count.bind(protocolNode.store);
        let markCountStarted!: () => void;
        const countStarted = new Promise<void>(resolve => {
            markCountStarted = resolve;
        });
        let releaseCount!: () => void;
        const countBlocked = new Promise<void>(resolve => {
            releaseCount = resolve;
        });
        jest.spyOn(protocolNode.store, 'count').mockImplementationOnce(async () => {
            markCountStarted();
            await countBlocked;
            return count();
        });
        mockTerminalResponder(protocolNode);

        const staleStart = protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        try {
            await countStarted;
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, remoteOpen));
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
                type: 'neg_close',
                sessionId: remoteOpen.sessionId,
                windowId: remoteOpen.windowId,
                reason: 'complete',
            }));
            releaseCount();
            await staleStart;

            expect(decodeWrites(pair).filter(message => message.type === 'ordered_catchup_req')).toHaveLength(0);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
            )).toMatchObject({ activeSession: null });
        }
        finally {
            releaseCount();
            await staleStart.catch(() => undefined);
        }
    });

    it('starts periodic Negentropy after an expected catch-up request expires', async () => {
        const operations = await makeOperations(5);
        const remoteOpen = await createRemoteOpen();
        const protocolNode = await createNode({
            keyByte: 0x11,
            maxRecords: 4,
        });
        await protocolNode.store.upsertMany(operations.map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
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
        const createEngine = jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot');
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
                orderedCatchupServerPendingReason: 'cold_start',
                orderedCatchupServerPendingGap: 4,
            });
            expect(typeof pendingUntil).toBe('number');
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify(remoteOpen)),
            ));
            expect(decodeWrites(pair)).toEqual([
                expect.objectContaining({
                    type: 'neg_close',
                    sessionId: remoteOpen.sessionId,
                    windowId: remoteOpen.windowId,
                    reason: 'ordered_catchup_active',
                }),
            ]);
            expect(createEngine).not.toHaveBeenCalled();
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toBeNull();

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
        const protocolNode = await createNode({ maxRecords: 1, maxRounds: 1 });
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'continue',
                haveIds: [],
                needIds: [],
            });
            return engine;
        });
        const { peerKey, pair } = attachPeer(protocolNode, {});

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey),
        );
        const open = decodeWrites(pair).find(message => message.type === 'neg_open') as any;
        if (!open) {
            throw new Error('expected local neg_open');
        }
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 1,
            frame: encodeNegentropyFrame('first-round'),
        }));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 2,
            frame: encodeNegentropyFrame('second-round'),
        }));

        expect(decodeWrites(pair).filter(message => message.type === 'neg_close').at(-1)).toMatchObject({
            reason: 'max_rounds_reached',
        });
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
    });

    it('closes without a continuation when a remote round cap cannot split the window', async () => {
        const protocolNode = await createNode({ maxRecords: 1 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
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
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const getByIds = jest.spyOn(protocolNode.store, 'getByIds');
        mockTerminalResponder(protocolNode);

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
                round: 1,
                reason: 'complete',
            })),
        ));
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(getByIds).not.toHaveBeenCalled();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: {
                sessionsStarted: 1,
                sessionsCompleted: 1,
                sessionsFailed: 0,
            },
        });
    });

    it('accepts completion after the responder sends its final reconciliation frame', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'continue',
                haveIds: [],
                needIds: [],
            });
            return engine;
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));

        expect(pair.connectionA.destroyed).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: { sessionsCompleted: 1, sessionsFailed: 0 },
            transport: { protocolViolationCooldowns: 0 },
        });
    });

    it('rejects a continuation that abandons an unfinished responder window', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'continue',
                haveIds: [],
                needIds: [],
            });
            return engine;
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        const continuationWindow = {
            ...(open.window as ReconciliationWindow),
            order: 1,
        };
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...open,
            windowId: makeWindowId(continuationWindow),
            round: 1,
            window: continuationWindow,
        }));

        expect(pair.connectionA.destroyed).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects a continuation after serving less than a complete history window', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'continue',
                haveIds: [],
                needIds: [],
            });
            return engine;
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_req',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 1,
            requestId: 0,
            ids: [operation.signature!.hash],
        }));
        const push = decodeWrites(pair).find(message => message.type === 'ops_push')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'ops_ack',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 1,
            requestId: 0,
            page: push.page,
        }));

        const continuationWindow = buildNextHistoryPage(
            open.window as ReconciliationWindow,
            {
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                id: operation.signature!.hash,
            },
            1,
        );
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...open,
            windowId: makeWindowId(continuationWindow),
            round: 1,
            window: continuationWindow,
        }));

        expect(pair.connectionA.destroyed).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('rejects a round-cap split before the responder reaches its round cap', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: 'continue',
                haveIds: [],
                needIds: [],
            });
            return engine;
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        const splitWindow = buildRoundCapSplitWindow(open.window as ReconciliationWindow)!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...open,
            windowId: makeWindowId(splitWindow),
            round: 1,
            window: splitWindow,
        }));

        expect(pair.connectionA.destroyed).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('accepts the matching split after the responder reaches its round cap', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33, maxRounds: 1 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const createEngine = protocolNode.adapter.createEngineForSnapshot.bind(protocolNode.adapter);
        let window = 0;
        jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot').mockImplementation(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce(window++ === 0
                ? { nextMsg: 'continue', haveIds: [], needIds: [] }
                : { nextMsg: null, haveIds: [], needIds: [] });
            return engine;
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            round: 1,
            frame: encodeNegentropyFrame('round-cap'),
        }));
        expect(decodeWrites(pair)).toContainEqual(expect.objectContaining({
            type: 'neg_close',
            reason: 'max_rounds_reached',
        }));

        const splitWindow = buildRoundCapSplitWindow(open.window as ReconciliationWindow)!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...open,
            windowId: makeWindowId(splitWindow),
            round: 1,
            window: splitWindow,
        }));

        expect(pair.connectionA.destroyed).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });
    });

    it('rejects an arbitrary continuation after a responder window completes', async () => {
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        mockTerminalResponder(protocolNode);

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        const continuationWindow = {
            ...(open.window as ReconciliationWindow),
            order: 1,
        };
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            ...open,
            windowId: makeWindowId(continuationWindow),
            round: 1,
            window: continuationWindow,
        }));

        expect(pair.connectionA.destroyed).toBe(true);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
    });

    it('accepts remote completion after terminally indexing a pre-v0.5 update without previd', async () => {
        const operation = await makeLegacyUpdateWithoutPrevid();
        const operationId = operation.signature!.hash;
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        mockTerminalResponder(protocolNode);
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 1,
            processed: 0,
            rejected: 0,
            total: 1,
            rejectedIndices: [],
        });
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            added: 0,
            merged: 0,
            rejected: 0,
            pending: 1,
            acceptedHashes: [],
            acceptedEvents: [],
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));

        expect((await protocolNode.store.getByIds([operationId]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        expect(pair.connectionA.destroyed).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: {
                sessionsCompleted: 1,
                sessionsFailed: 0,
            },
        });
    });

    it('retains a terminal structural rejection across responder continuation windows', async () => {
        const [rejectedOperation] = await makeOperations(1);
        const fillerOperations = await makeOperations(2);
        const rejectedId = rejectedOperation.signature!.hash;
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33, maxRecords: 1 });
        const fillerRecords = fillerOperations.map(operation => {
            const mapped = mapOperationToSyncKey(operation);
            if (!mapped.ok) {
                throw new Error(mapped.reason);
            }
            return {
                id: mapped.value.idHex,
                ts: mapped.value.ts,
                operation,
            };
        }).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
        await protocolNode.store.upsertMany(fillerRecords);
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const getByIds = jest.spyOn(protocolNode.store, 'getByIds');
        mockTerminalResponder(protocolNode);
        protocolNode.node.gatekeeperClient.importBatch.mockImplementationOnce(async events => ({
            queued: 0,
            processed: 0,
            rejected: events.length,
            total: 0,
            rejectedIndices: events.map((_, index) => index),
        }));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [rejectedOperation]);

        const remoteOpen = open as any;
        const continuationWindow = {
            ...remoteOpen.window,
            order: Number(remoteOpen.window.order) + 1,
            after: {
                ts: fillerRecords[0].ts,
                id: fillerRecords[0].id,
            },
        };
        const continuation = {
            ...remoteOpen,
            windowId: makeWindowId(continuationWindow),
            round: 1,
            window: continuationWindow,
        };
        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(peerKey, continuation),
        );
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: continuation.windowId,
            reason: 'complete',
        }));

        expect(getByIds.mock.calls.filter(([ids]) => ids.includes(rejectedId))).toHaveLength(2);
        expect((await protocolNode.store.getByIds([rejectedId]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(pair.connectionA.destroyed).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: {
                sessionsStarted: 1,
                sessionsCompleted: 1,
                sessionsFailed: 0,
            },
        });
    });

    it('accepts remote completion after an unresolved responder operation is backfilled', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        mockTerminalResponder(protocolNode);
        protocolNode.node.gatekeeperClient.importBatch.mockImplementationOnce(async events => ({
            queued: events.length,
            processed: 0,
            rejected: 0,
            total: events.length,
            rejectedIndices: [],
        }));
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            added: 0,
            merged: 0,
            rejected: 1,
            pending: 0,
            acceptedHashes: [],
            acceptedEvents: [],
        });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);
        await protocolNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'complete',
        }));

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: {
                sessionsStarted: 1,
                sessionsCompleted: 1,
                sessionsFailed: 0,
            },
        });
    });

    it('fails a responder session without acknowledging a retryable push', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {});
        mockTerminalResponder(protocolNode);
        protocolNode.node.gatekeeperClient.importBatch.mockRejectedValueOnce(new Error('temporary import failure'));

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, open));
        await deliverAuthorizedPush(protocolNode, peerKey, pair, open, [operation]);

        expect(await protocolNode.store.has(operation.signature!.hash)).toBe(false);
        expect(decodeWrites(pair).some(message => message.type === 'ops_ack')).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: {
                sessionsCompleted: 0,
                sessionsFailed: 1,
            },
        });
    });

    it('does not let a delayed responder completion audit close a replacement session', async () => {
        const [operation] = await makeOperations(1);
        const open = await createRemoteOpen();
        const protocolNode = await createNode({ keyByte: 0x33 });
        const initialPeer = attachPeer(protocolNode, {});
        mockTerminalResponder(protocolNode);
        protocolNode.node.gatekeeperClient.importBatch.mockImplementationOnce(async events => ({
            queued: events.length,
            processed: 0,
            rejected: 0,
            total: events.length,
            rejectedIndices: [],
        }));
        protocolNode.node.gatekeeperClient.processEvents.mockResolvedValueOnce({
            added: 0,
            merged: 0,
            rejected: 1,
            pending: 0,
            acceptedHashes: [],
            acceptedEvents: [],
        });

        await protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(initialPeer.peerKey, open),
        );
        await deliverAuthorizedPush(protocolNode, initialPeer.peerKey, initialPeer.pair, open, [operation]);

        const getByIds = protocolNode.store.getByIds.bind(protocolNode.store);
        let noteLookupStarted!: () => void;
        const lookupStarted = new Promise<void>(resolve => {
            noteLookupStarted = resolve;
        });
        let releaseLookup!: () => void;
        const lookupBlocked = new Promise<void>(resolve => {
            releaseLookup = resolve;
        });
        jest.spyOn(protocolNode.store, 'getByIds').mockImplementation(async ids => {
            noteLookupStarted();
            await lookupBlocked;
            return getByIds(ids);
        });

        const closing = protocolNode.node.run(
            () => protocolNode.node.mediator.__test.receiveMsg(initialPeer.peerKey, {
                type: 'neg_close',
                sessionId: open.sessionId,
                windowId: open.windowId,
                reason: 'complete',
            }),
        );
        let replacement: AttachedPeer | null = null;
        try {
            await lookupStarted;
            replacement = replaceWithOrderedSession(protocolNode, initialPeer.peerKey);
            releaseLookup();
            await closing;
        }
        finally {
            releaseLookup();
            await closing.catch(() => undefined);
        }

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(initialPeer.peerKey)?.activeSession,
        )).toEqual({
            mode: 'ordered_catchup',
            sessionId: 'replacement-session',
        });
        expect(replacement).not.toBeNull();
    });

    it('imports queue gossip, suppresses relays, and filters known operations', async () => {
        const [knownOperation, newOperation] = await makeOperations(2);
        const protocolNode = await createNode({ keyByte: 0x44 });
        const source = attachPeer(protocolNode, { peerKeyByte: 0x11 });
        const excluded = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        const recipient = attachPeer(protocolNode, { peerKeyByte: 0x33 });

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
            type: 'queue',
            relays: [],
            data: [knownOperation, newOperation],
        }));
        await eventually(async () => await protocolNode.store.has(newOperation.signature!.hash));

        const lastImport = protocolNode.node.gatekeeperClient.importBatch.mock.calls.at(-1)?.[0] ?? [];
        expect(lastImport.map(event => event.operation.signature?.hash)).toEqual([newOperation.signature!.hash]);
        expect(await protocolNode.store.count()).toBe(2);
    });

    it('serves ordered catch-up pages and validates request cursors', async () => {
        const operations = await makeOperations(2);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany(operations.map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const { peerKey, pair } = attachPeer(protocolNode, {
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

    it('requests an ordered catch-up continuation while the current page imports', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode({
            keyByte: 0x33,
        });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        const processEvents = protocolNode.node.gatekeeperClient.processEvents;
        const processEventsImplementation = processEvents.getMockImplementation();
        if (!processEventsImplementation) {
            throw new Error('Gatekeeper processEvents implementation is unavailable');
        }
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        processEvents.mockImplementationOnce(async () => {
            markStarted();
            await blocked;
            return processEventsImplementation();
        });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'paced-session'),
        );

        const delivery = protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'paced-session',
                cursor: { syncOrder: 1, id: operation.signature!.hash },
                hasMore: true,
                data: [operation],
            })),
        ));

        try {
            await started;
            expect(decodeWrites(pair)).toEqual([
                expect.objectContaining({
                    type: 'ordered_catchup_req',
                    sessionId: 'paced-session',
                    cursor: { syncOrder: 1, id: operation.signature!.hash },
                }),
            ]);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toEqual({ mode: 'ordered_catchup', sessionId: 'paced-session' });
            expect(await protocolNode.store.has(operation.signature!.hash)).toBe(false);

            release();
            await delivery;

            await eventually(() => protocolNode.store.has(operation.signature!.hash));
            expect(decodeWrites(pair)).toEqual([
                expect.objectContaining({
                    type: 'ordered_catchup_req',
                    sessionId: 'paced-session',
                    cursor: { syncOrder: 1, id: operation.signature!.hash },
                }),
            ]);
        }
        finally {
            release();
            await delivery.catch(() => undefined);
        }
    });

    it('falls back after Gatekeeper backpressure and later restarts without skipping refused data', async () => {
        const operations = await makeOperations(2);
        const protocolNode = await createNode({
            keyByte: 0x11,
            env: { KC_HYPR_NEGENTROPY_INTERVAL: '1' },
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                    operationCount: 2,
                    orderedOperationCount: 2,
                }),
            },
        });
        protocolNode.node.gatekeeperClient.importBatch.mockResolvedValueOnce({
            queued: 1,
            processed: 0,
            rejected: 0,
            total: 1,
            rejectedIndices: [],
            processedIndices: [],
            capacityDeferred: 1,
            capacityDeferredIndices: [1],
        });
        const processEvents = protocolNode.node.gatekeeperClient.processEvents;
        processEvents.mockResolvedValueOnce({
            added: 1,
            merged: 0,
            rejected: 0,
            pending: 0,
            acceptedHashes: [operations[0].signature!.hash],
            acceptedEvents: [{
                registry: 'hyperswarm',
                time: operations[0].created!,
                operation: operations[0],
            }],
            hasMore: false,
        });
        const startedAt = Date.now();
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'capacity-session'),
        );

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'capacity-session',
                cursor: { syncOrder: 2, id: operations[1].signature!.hash },
                hasMore: true,
                data: operations,
            })),
        ));
        await eventually(() => protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.orderedCatchupClientSessionId === null,
        ));
        await eventually(() => decodeWrites(pair).some(message => message.type === 'neg_open'));

        expect(processEvents).toHaveBeenCalledTimes(1);
        expect(await protocolNode.store.has(operations[0].signature!.hash)).toBe(true);
        expect(await protocolNode.store.has(operations[1].signature!.hash)).toBe(false);
        const capacityState = protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        );
        expect(capacityState).toMatchObject({
            orderedCatchupRetryAfter: expect.any(Number),
            activeSession: expect.objectContaining({ mode: 'negentropy' }),
        });
        expect(capacityState!.orderedCatchupRetryAfter).toBeGreaterThanOrEqual(startedAt + 1_000);

        const open = decodeWrites(pair).find(message => message.type === 'neg_open')!;
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.receiveMsg(peerKey, {
            type: 'neg_close',
            sessionId: open.sessionId,
            windowId: open.windowId,
            reason: 'gatekeeper_backpressure',
        }));

        const retryAfter = capacityState!.orderedCatchupRetryAfter as number;
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(retryAfter + 1);
        try {
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(peerKey, 'periodic'),
            );
            const requests = decodeWrites(pair).filter(message => message.type === 'ordered_catchup_req');
            const retry = requests.at(-1)!;
            expect(retry).toMatchObject({ type: 'ordered_catchup_req' });
            expect(retry.cursor).toBeUndefined();
            expect(retry.sessionId).not.toBe('capacity-session');

            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_push',
                    sessionId: retry.sessionId,
                    cursor: { syncOrder: 2, id: operations[1].signature!.hash },
                    hasMore: false,
                    data: operations,
                })),
            ));
            await eventually(async () => await protocolNode.store.has(operations[1].signature!.hash));
            expect(protocolNode.node.gatekeeperClient.importBatch.mock.calls.at(-1)?.[0])
                .toHaveLength(1);
            expect(protocolNode.node.gatekeeperClient.importBatch.mock.calls.at(-1)?.[0]?.[0].operation)
                .toStrictEqual(operations[1]);
        }
        finally {
            nowSpy.mockRestore();
        }
    });

    it('ignores ordered catch-up pushes after a terminal page while its import drains', async () => {
        const [acceptedOperation, lateOperation] = await makeOperations(2);
        const protocolNode = await createNode({
            keyByte: 0x33,
        });
        const { peerKey } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
            overrides: {
                capabilities: compatibleCapabilities({ negentropy: false }),
            },
        });
        const processEvents = protocolNode.node.gatekeeperClient.processEvents;
        const processEventsImplementation = processEvents.getMockImplementation();
        if (!processEventsImplementation) {
            throw new Error('Gatekeeper processEvents implementation is unavailable');
        }
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        processEvents.mockImplementationOnce(async () => {
            markStarted();
            await blocked;
            return processEventsImplementation();
        });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'terminal-import-session'),
        );

        const finalPage = {
            type: 'ordered_catchup_push',
            sessionId: 'terminal-import-session',
            cursor: { syncOrder: 1, id: acceptedOperation.signature!.hash },
            hasMore: false,
            data: [acceptedOperation],
        };
        const sendPage = async (message: Record<string, unknown>) => protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify(message)),
            ),
        );

        try {
            await sendPage(finalPage);
            await started;
            await sendPage(finalPage);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toEqual({ mode: 'ordered_catchup', sessionId: 'terminal-import-session' });

            await sendPage({
                ...finalPage,
                cursor: { syncOrder: 2, id: lateOperation.signature!.hash },
                data: [lateOperation],
            });
            expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(1);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toEqual({ mode: 'ordered_catchup', sessionId: 'terminal-import-session' });

            release();
            await eventually(() => protocolNode.store.has(acceptedOperation.signature!.hash));
            await eventually(() => protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession === null,
            ));
            await nextTurn();

            expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(1);
            expect(await protocolNode.store.has(lateOperation.signature!.hash)).toBe(false);
        }
        finally {
            release();
        }
    });

    it('rebuilds the Negentropy adapter only after ordered catch-up imports finish', async () => {
        const operations = await makeOperations(3);
        const protocolNode = await createNode();
        const { peerKey, pair } = attachPeer(protocolNode, {});
        const buildSnapshotForWindow = protocolNode.adapter.buildSnapshotForWindow.bind(protocolNode.adapter);
        let lastBuiltRecordCount = 0;
        const buildSnapshot = jest.spyOn(protocolNode.adapter, 'buildSnapshotForWindow').mockImplementation(async window => {
            const snapshot = await buildSnapshotForWindow(window);
            lastBuiltRecordCount = snapshot.stats.loaded;
            return snapshot;
        });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'deferred-prebuild-session'),
        );

        const sendPage = async (index: number, hasMore: boolean) => protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_push',
                    sessionId: 'deferred-prebuild-session',
                    cursor: { syncOrder: index + 1, id: operations[index].signature!.hash },
                    hasMore,
                    data: [operations[index]],
                })),
            ),
        );

        await sendPage(0, true);
        await eventually(() => protocolNode.store.has(operations[0].signature!.hash));
        await sendPage(1, true);
        await eventually(() => protocolNode.store.has(operations[1].signature!.hash));
        await nextTurn();
        expect(buildSnapshot).not.toHaveBeenCalled();

        await sendPage(2, false);
        await eventually(() => decodeWrites(pair).some(message => message.type === 'neg_open'));

        expect(buildSnapshot).toHaveBeenCalledTimes(1);
        expect(lastBuiltRecordCount).toBe(3);
    });

    it('drops prefetched ordered catch-up pages after a retryable import result', async () => {
        const operations = await makeOperations(3);
        const protocolNode = await createNode({
            keyByte: 0x33,
        });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        protocolNode.node.gatekeeperClient.isReady.mockImplementationOnce(async () => {
            markStarted();
            await blocked;
            return false;
        });
        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(peerKey, 'retryable-session'),
        );

        const sendPage = async (index: number) => protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_push',
                    sessionId: 'retryable-session',
                    cursor: { syncOrder: index + 1, id: operations[index].signature!.hash },
                    hasMore: true,
                    data: [operations[index]],
                })),
            ),
        );

        try {
            await sendPage(0);
            await started;
            await sendPage(1);
            await sendPage(2);
            expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();

            release();
            await eventually(() => protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession === null,
            ));
            await nextTurn();
            await nextTurn();

            expect(protocolNode.node.gatekeeperClient.isReady).toHaveBeenCalledTimes(1);
            expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
            for (const operation of operations) {
                expect(await protocolNode.store.has(operation.signature!.hash)).toBe(false);
            }
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
            )).toMatchObject({
                activeSession: null,
                orderedCatchupClientSessionId: null,
            });

            const importsBefore = protocolNode.node.gatekeeperClient.importBatch.mock.calls.length;
            await sendPage(0);
            expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(importsBefore);
            expect(pair.transcript).toHaveLength(2);
        }
        finally {
            release();
        }
    });

    it('drops prefetched pages when a replaced ordered catch-up session returns retryable', async () => {
        const operations = await makeOperations(3);
        const protocolNode = await createNode({
            keyByte: 0x33,
        });
        const initialPeer = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        protocolNode.node.gatekeeperClient.isReady.mockImplementationOnce(async () => {
            markStarted();
            await blocked;
            return false;
        });
        protocolNode.node.run(() => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
            initialPeer.peerKey,
            'replaced-retryable-session',
        ));

        const sendPage = async (index: number) => protocolNode.node.run(
            () => protocolNode.node.mediator.__test.processInboundPeerData(
                initialPeer.peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_push',
                    sessionId: 'replaced-retryable-session',
                    cursor: { syncOrder: index + 1, id: operations[index].signature!.hash },
                    hasMore: true,
                    data: [operations[index]],
                })),
            ),
        );

        try {
            await sendPage(0);
            await started;
            await sendPage(1);
            await sendPage(2);
            const replacement = replaceWithOrderedSession(
                protocolNode,
                initialPeer.peerKey,
                'replacement-after-retryable',
            );

            release();
            await nextTurn();
            await nextTurn();

            expect(protocolNode.node.gatekeeperClient.isReady).toHaveBeenCalledTimes(1);
            expect(protocolNode.node.gatekeeperClient.importBatch).not.toHaveBeenCalled();
            for (const operation of operations) {
                expect(await protocolNode.store.has(operation.signature!.hash)).toBe(false);
            }
            expect(decodeWrites(replacement.pair)).toStrictEqual([]);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(replacement.peerKey)?.activeSession,
            )).toEqual({ mode: 'ordered_catchup', sessionId: 'replacement-after-retryable' });
        }
        finally {
            release();
        }
    });

    it('does not continue an ordered catch-up page on a replacement connection', async () => {
        const [operation] = await makeOperations(1);
        const protocolNode = await createNode({
            keyByte: 0x33,
        });
        const initialPeer = attachPeer(protocolNode, { peerKeyByte: 0x22 });
        const processEvents = protocolNode.node.gatekeeperClient.processEvents;
        const processEventsImplementation = processEvents.getMockImplementation();
        if (!processEventsImplementation) {
            throw new Error('Gatekeeper processEvents implementation is unavailable');
        }
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => {
            release = resolve;
        });
        processEvents.mockImplementationOnce(async () => {
            markStarted();
            await blocked;
            return processEventsImplementation();
        });
        protocolNode.node.run(() => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
            initialPeer.peerKey,
            'stale-import-session',
        ));
        const delivery = protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            initialPeer.peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'stale-import-session',
                cursor: { syncOrder: 1, id: operation.signature!.hash },
                hasMore: true,
                data: [operation],
            })),
        ));

        try {
            await started;
            expect(decodeWrites(initialPeer.pair)).toEqual([
                expect.objectContaining({
                    type: 'ordered_catchup_req',
                    sessionId: 'stale-import-session',
                    cursor: { syncOrder: 1, id: operation.signature!.hash },
                }),
            ]);
            protocolNode.node.run(() => protocolNode.node.mediator.__test.disconnectPeer(initialPeer.peerKey));
            const replacement = attachPeer(protocolNode, { peerKeyByte: 0x22 });
            protocolNode.node.run(() => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                replacement.peerKey,
                'replacement-session',
            ));

            release();
            await delivery;
            await eventually(() => protocolNode.store.has(operation.signature!.hash));

            expect(decodeWrites(replacement.pair)).toStrictEqual([]);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(replacement.peerKey)?.activeSession,
            )).toEqual({ mode: 'ordered_catchup', sessionId: 'replacement-session' });
        }
        finally {
            release();
            await delivery.catch(() => undefined);
        }
    });

    it('closes ordered catch-up clients when request sends fail', async () => {
        const [continuationOperation] = await makeOperations(1);
        const initialNode = await createNode({
            keyByte: 0x33,
            maxRecords: 4,
        });
        const initialPeer = attachPeer(initialNode, {
            peerKeyByte: 0x22,
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
        });
        const continuationPeer = attachPeer(continuationNode, {
            peerKeyByte: 0x22,
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
                cursor: { syncOrder: 1, id: continuationOperation.signature!.hash },
                hasMore: true,
                data: [continuationOperation],
            })),
        ));
        expect(continuationWrite).toHaveBeenCalledTimes(1);
        await eventually(() => continuationNode.store.has(continuationOperation.signature!.hash));
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
            const protocolNode = await createNode();
            if (operations.length > 0) {
                await protocolNode.store.upsertMany([{
                    id: operations[0].signature!.hash,
                    ts: Math.floor(Date.parse(operations[0].signature!.signed) / 1000),
                    syncOrder: 1,
                    operation: operations[0],
                }]);
            }
            const { peerKey, pair } = attachPeer(protocolNode, {
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
                decodeFramedMessages(Buffer.from(attemptedChunk)).messages[0].toString('utf8'),
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

    it('rejects a second ordered catch-up client during post-import transition', async () => {
        const protocolNode = await createNode({
            keyByte: 0x33,
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
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
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
            )).toMatchObject({
                orderedCatchup: {
                    sessionsStarted: 1,
                    sessionsCompleted: 0,
                    sessionsFailed: 0,
                },
            });

            release();
            await eventually(() => applySyncPage.mock.calls.length === 1);
            await eventually(() => pair.transcript.some(entry => entry.messageType === 'neg_open'));
            expect(exportIndex).toHaveBeenCalledTimes(1);
            expect(decodeWrites(pair).filter(message => message.type === 'neg_open')).toHaveLength(1);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
            )).toEqual(expect.objectContaining({ mode: 'negentropy' }));
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
            )).toMatchObject({
                orderedCatchup: {
                    sessionsStarted: 1,
                    sessionsCompleted: 1,
                    sessionsFailed: 0,
                },
            });
        }
        finally {
            release();
        }
    });

    it('records one failure when a peer disconnects during ordered catch-up post-import', async () => {
        const protocolNode = await createNode({ keyByte: 0x33 });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
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
                    'disconnect-post-import-session',
                ),
            );
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_done',
                    sessionId: 'disconnect-post-import-session',
                })),
            ));
            await started;
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
            )).toMatchObject({
                orderedCatchup: {
                    sessionsStarted: 1,
                    sessionsCompleted: 0,
                    sessionsFailed: 0,
                },
            });

            protocolNode.node.run(() => protocolNode.node.mediator.__test.disconnectPeer(peerKey));
            await eventually(() => {
                const stats = protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
                ) as { orderedCatchup: { sessionsFailed: number } };
                return stats.orderedCatchup.sessionsFailed === 1;
            });

            release();
            await Promise.allSettled(exportIndex.mock.results.map(result => result.value));
            await nextTurn();
            await nextTurn();

            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
            )).toMatchObject({
                orderedCatchup: {
                    sessionsStarted: 1,
                    sessionsCompleted: 0,
                    sessionsFailed: 1,
                },
                syncDurationMs: { sessions: 1 },
            });
            expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(false);
        }
        finally {
            release();
        }
    });

    it('blocks other peers until ordered catch-up imports and index sync hand off to Negentropy', async () => {
        const [operation] = await makeOperations(1);
        const remoteOpen = await createRemoteOpen();
        const protocolNode = await createNode({
            keyByte: 0x11,
        });
        const catchupPeer = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: true,
                    orderedCatchupVersion: 1,
                    orderedCatchupReady: true,
                }),
            },
        });
        const otherPeer = attachPeer(protocolNode, {
            peerKeyByte: 0x33,
            overrides: {
                capabilities: compatibleCapabilities({
                    orderedCatchup: false,
                    operationCount: 5,
                    orderedOperationCount: 5,
                }),
            },
        });
        const processEvents = protocolNode.node.gatekeeperClient.processEvents;
        const processEventsImplementation = processEvents.getMockImplementation();
        const exportIndex = protocolNode.node.gatekeeperClient.exportIndex;
        const exportIndexImplementation = exportIndex.getMockImplementation();
        const createEngine = jest.spyOn(protocolNode.adapter, 'createEngineForSnapshot');
        if (!processEventsImplementation || !exportIndexImplementation) {
            throw new Error('Gatekeeper client implementation is unavailable');
        }
        let markProcessStarted!: () => void;
        const processStarted = new Promise<void>(resolve => {
            markProcessStarted = resolve;
        });
        let releaseProcess!: () => void;
        const processBlocked = new Promise<void>(resolve => {
            releaseProcess = resolve;
        });
        let markExportStarted!: () => void;
        const exportStarted = new Promise<void>(resolve => {
            markExportStarted = resolve;
        });
        let releaseExport!: () => void;
        const exportBlocked = new Promise<void>(resolve => {
            releaseExport = resolve;
        });
        processEvents.mockImplementationOnce(async () => {
            markProcessStarted();
            await processBlocked;
            return processEventsImplementation();
        });
        exportIndex.mockImplementationOnce(async request => {
            markExportStarted();
            await exportBlocked;
            return exportIndexImplementation(request);
        });
        let orderedDelivery: Promise<void> | null = null;

        try {
            protocolNode.node.run(
                () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                    catchupPeer.peerKey,
                    'draining-session',
                ),
            );
            orderedDelivery = protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                catchupPeer.peerKey,
                encodeFramedMessage(JSON.stringify({
                    type: 'ordered_catchup_push',
                    sessionId: 'draining-session',
                    cursor: { syncOrder: 1, id: operation.signature!.hash },
                    hasMore: false,
                    data: [operation],
                })),
            ));
            await processStarted;

            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(otherPeer.peerKey),
            );
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                otherPeer.peerKey,
                encodeFramedMessage(JSON.stringify(remoteOpen)),
            ));
            expect(decodeWrites(otherPeer.pair)).toEqual([
                expect.objectContaining({
                    type: 'neg_close',
                    sessionId: remoteOpen.sessionId,
                    windowId: remoteOpen.windowId,
                    reason: 'ordered_catchup_active',
                }),
            ]);
            expect(createEngine).not.toHaveBeenCalled();
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(otherPeer.peerKey)?.activeSession,
            )).toBeNull();

            releaseProcess();
            await orderedDelivery;
            await exportStarted;
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(otherPeer.peerKey),
            );
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                catchupPeer.peerKey,
                encodeFramedMessage(JSON.stringify(remoteOpen)),
            ));
            expect(decodeWrites(catchupPeer.pair)).toEqual([
                expect.objectContaining({
                    type: 'neg_close',
                    sessionId: remoteOpen.sessionId,
                    windowId: remoteOpen.windowId,
                    reason: 'ordered_catchup_active',
                }),
            ]);
            expect(createEngine).not.toHaveBeenCalled();
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(catchupPeer.peerKey)?.activeSession,
            )).toBeNull();

            releaseExport();
            await eventually(() => catchupPeer.pair.transcript.some(entry => entry.messageType === 'neg_open'));

            expect(decodeWrites(catchupPeer.pair).filter(message => message.type === 'neg_open')).toHaveLength(1);
            expect(decodeWrites(otherPeer.pair).filter(message => message.type === 'neg_open')).toHaveLength(0);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(catchupPeer.peerKey)?.activeSession,
            )).toEqual(expect.objectContaining({ mode: 'negentropy' }));
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(otherPeer.peerKey, 'periodic'),
            );
            expect(decodeWrites(otherPeer.pair).filter(message => (
                message.type === 'neg_open' || message.type === 'ordered_catchup_req'
            ))).toHaveLength(0);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(otherPeer.peerKey),
            )).toMatchObject({
                syncMode: 'negentropy',
                syncStarted: false,
                activeSession: null,
            });

            protocolNode.node.run(
                () => protocolNode.node.mediator.__test.disconnectPeer(catchupPeer.peerKey),
            );
            await protocolNode.node.run(
                () => protocolNode.node.mediator.__test.maybeStartPeerSync(otherPeer.peerKey, 'periodic'),
            );
            await eventually(() => otherPeer.pair.transcript.some(entry => entry.messageType === 'neg_open'));
        }
        finally {
            releaseProcess();
            releaseExport();
            await orderedDelivery?.catch(() => undefined);
        }
    });

    it('does not start Negentropy when ordered catch-up index sync fails', async () => {
        const protocolNode = await createNode({
            keyByte: 0x11,
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
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
        await eventually(() => {
            const stats = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
            ) as { orderedCatchup: { sessionsFailed: number } };
            return stats.orderedCatchup.sessionsFailed === 1;
        });

        expect(applySyncPage).not.toHaveBeenCalled();
        expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.activeSession,
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            orderedCatchup: {
                sessionsStarted: 1,
                sessionsCompleted: 0,
                sessionsFailed: 1,
            },
            syncDurationMs: { sessions: 1 },
        });
    });

    it('applies index reset handling before completing ordered catch-up', async () => {
        const protocolNode = await createNode({ keyByte: 0x22 });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x11,
            overrides: {
                capabilities: compatibleCapabilities({ negentropyVersion: 1 }),
            },
        });
        const index = await protocolNode.node.gatekeeperDb.exportIndexSnapshot({
            limit: 500,
        });
        if (!index.indexEpoch) {
            throw new Error('Gatekeeper index epoch is unavailable');
        }
        await protocolNode.store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await protocolNode.store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '999');
        await protocolNode.store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.gatekeeperIndexEpoch, index.indexEpoch);
        const reset = jest.spyOn(protocolNode.store, 'reset');

        protocolNode.node.run(
            () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                peerKey,
                'reset-index-session',
            ),
        );
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({ syncStarted: true });

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_done',
                sessionId: 'reset-index-session',
            })),
        ));
        await eventually(() => reset.mock.calls.length === 1);
        await eventually(() => protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey)?.syncStarted,
        ) === false);

        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toMatchObject({
            syncMode: 'unknown',
            syncStarted: false,
            activeSession: null,
        });
        expect(pair.transcript.some(entry => entry.messageType === 'neg_open')).toBe(false);
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            orderedCatchup: {
                sessionsStarted: 1,
                sessionsCompleted: 0,
                sessionsFailed: 1,
            },
            syncDurationMs: { sessions: 1 },
        });
    });

    it.each(['status lookup', 'page lookup'] as const)(
        'does not send an ordered catch-up response after a Gatekeeper reset during %s',
        async boundary => {
            const [operation] = await makeOperations(1);
            const protocolNode = await createNode({ keyByte: 0x22 });
            await protocolNode.store.upsertMany([{
                id: operation.signature!.hash,
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                syncOrder: 1,
                operation,
            }]);
            const serverPeer = attachPeer(protocolNode, {
                peerKeyByte: 0x11,
                overrides: {
                    capabilities: compatibleCapabilities({
                        negentropyVersion: 1,
                        orderedCatchup: true,
                        orderedCatchupVersion: 1,
                        orderedCatchupReady: true,
                    }),
                },
            });
            const resetPeer = attachPeer(protocolNode, {
                peerKeyByte: 0x33,
                overrides: {
                    capabilities: compatibleCapabilities({
                        negentropyVersion: 1,
                        orderedCatchup: true,
                        orderedCatchupVersion: 1,
                        orderedCatchupReady: true,
                    }),
                },
            });
            const index = await protocolNode.node.gatekeeperDb.exportIndexSnapshot({
                limit: 500,
            });
            if (!index.indexEpoch) {
                throw new Error('Gatekeeper index epoch is unavailable');
            }
            await protocolNode.store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
            await protocolNode.store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '999');
            await protocolNode.store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.gatekeeperIndexEpoch, index.indexEpoch);
            const reset = jest.spyOn(protocolNode.store, 'reset');
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

            const staleRequest = protocolNode.node.run(
                () => protocolNode.node.mediator.__test.sendOrderedCatchupPage(serverPeer.peerKey, {
                    type: 'ordered_catchup_req',
                    sessionId: 'reset-stale-server-session',
                } as any),
            );
            try {
                await started;
                protocolNode.node.run(
                    () => protocolNode.node.mediator.__test.createOrderedCatchupClientSession(
                        resetPeer.peerKey,
                        'reset-trigger-session',
                    ),
                );
                await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                    resetPeer.peerKey,
                    encodeFramedMessage(JSON.stringify({
                        type: 'ordered_catchup_done',
                        sessionId: 'reset-trigger-session',
                    })),
                ));
                await eventually(() => reset.mock.calls.length === 1);
                release();
                await staleRequest;
            }
            finally {
                release();
                await staleRequest.catch(() => undefined);
            }

            expect(decodeWrites(serverPeer.pair).filter(
                message => message.sessionId === 'reset-stale-server-session',
            )).toHaveLength(0);
            expect(protocolNode.node.run(
                () => protocolNode.node.mediator.__test.getConnectionState(serverPeer.peerKey),
            )).toMatchObject({
                orderedCatchupServerSessionId: null,
                activeSession: null,
            });
        },
    );

    it.each(['status lookup', 'page lookup'] as const)(
        'does not send an ordered catch-up response on a replacement connection after %s',
        async boundary => {
            const [operation] = await makeOperations(1);
            const protocolNode = await createNode();
            await protocolNode.store.upsertMany([{
                id: operation.signature!.hash,
                ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
                syncOrder: boundary === 'page lookup' ? 1 : undefined,
                operation,
            }]);
            const initialPeer = attachPeer(protocolNode, {
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
                const replacement = attachPeer(protocolNode, {});
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

    it('continues an admitted ordered session while new rows await sync order', async () => {
        const operations = await makeOperations(302);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany(operations.slice(0, 301).map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const count = jest.spyOn(protocolNode.store, 'count');
        const countOrdered = jest.spyOn(protocolNode.store, 'countOrdered');
        const { peerKey, pair } = attachPeer(protocolNode, {
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
            sessionId: 'admitted-session',
        };

        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(request)),
        ));
        const firstPush = decodeWrites(pair).find(message => message.type === 'ordered_catchup_push');
        expect(firstPush).toMatchObject({ hasMore: true });

        await protocolNode.store.upsertMany([{
            id: operations[301].signature!.hash,
            ts: Math.floor(Date.parse(operations[301].signature!.signed) / 1000),
            operation: operations[301],
        }]);
        await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify({ ...request, cursor: firstPush?.cursor })),
        ));

        const messages = decodeWrites(pair);
        const pushes = messages.filter(message => message.type === 'ordered_catchup_push');
        expect(pushes).toHaveLength(2);
        expect(pushes[1]).toMatchObject({
            hasMore: false,
            data: [operations[300]],
        });
        expect(messages.some(message => message.type === 'ordered_catchup_done')).toBe(false);
        expect(count).toHaveBeenCalledTimes(1);
        expect(countOrdered).toHaveBeenCalledTimes(1);
    });

    it.each([300, 301])('serves an ordered catch-up history of %i operations without gaps', async count => {
        const operations = await makeOperations(count);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany(operations.map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const { peerKey, pair } = attachPeer(protocolNode, {
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
        expect((pushes[0].data as Operation[])).toHaveLength(Math.min(count, 300));
        expect(pushes[0].hasMore).toBe(count > 300);

        if (count === 301) {
            await protocolNode.node.run(() => protocolNode.node.mediator.__test.processInboundPeerData(
                peerKey,
                encodeFramedMessage(JSON.stringify({ ...request, cursor: pushes[0].cursor })),
            ));
            pushes = decodeWrites(pair).filter(message => message.type === 'ordered_catchup_push');
            expect(pushes[1]).toMatchObject({
                hasMore: false,
                cursor: { syncOrder: 301, id: operations[300].signature!.hash },
            });
        }

        const delivered = count === 301
            ? [...pushes[0].data as Operation[], ...pushes[1].data as Operation[]]
            : pushes[0].data as Operation[];
        expect(delivered.map(operation => operation.signature!.hash)).toStrictEqual(
            operations.map(operation => operation.signature!.hash),
        );
    });

    it('limits an ordered catch-up page by encoded operation bytes', async () => {
        const operations = await makeLargeAssetOperations(10, 55_000);
        const protocolNode = await createNode();
        await protocolNode.store.upsertMany(operations.map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const { peerKey, pair } = attachPeer(protocolNode, {
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
        expect(firstPage.length).toBeLessThan(operations.length);
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
        });
        const { peerKey, pair } = attachPeer(protocolNode, {
            peerKeyByte: 0x22,
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
        expect(decodeWrites(pair).at(-1)).toMatchObject({
            type: 'ordered_catchup_req',
            sessionId: 'dependency-session',
            cursor: { syncOrder: 1, id: asset.signature!.hash },
        });

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
        });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });
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
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(pair.transcript).toHaveLength(writesBefore);
        expect(protocolNode.node.gatekeeperClient.importBatch).toHaveBeenCalledTimes(importsBefore);
    });

    it('rejects unsupported ordered catch-up and finishes empty or unready requests', async () => {
        const request = {
            type: 'ordered_catchup_req',
            sessionId: 'server-session',
        } as any;
        const orderedCapabilities = compatibleCapabilities({
            orderedCatchup: true,
            orderedCatchupVersion: 1,
            orderedCatchupReady: true,
        });

        const unsupportedNode = await createNode();
        const unsupportedPeer = attachPeer(unsupportedNode, {});
        await unsupportedNode.node.run(
            () => unsupportedNode.node.mediator.__test.sendOrderedCatchupPage(unsupportedPeer.peerKey, request),
        );
        expect(unsupportedPeer.pair.transcript).toHaveLength(0);

        const emptyNode = await createNode();
        const emptyPeer = attachPeer(emptyNode, {
            overrides: { capabilities: orderedCapabilities },
        });
        await emptyNode.node.run(
            () => emptyNode.node.mediator.__test.sendOrderedCatchupPage(emptyPeer.peerKey, request),
        );
        expect(decodeWrites(emptyPeer.pair).at(-1)).toMatchObject({ type: 'ordered_catchup_done' });

        const [operation] = await makeOperations(1);
        const unorderedNode = await createNode();
        await unorderedNode.store.upsertMany([{
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            operation,
        }]);
        const unorderedPeer = attachPeer(unorderedNode, {
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
        });
        const { peerKey, pair } = attachPeer(protocolNode, { peerKeyByte: 0x22 });
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
            () => protocolNode.node.mediator.__test.getConnectionState(peerKey),
        )).toBeNull();
        expect(protocolNode.node.run(
            () => protocolNode.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({ transport: { protocolViolationCooldowns: 1 } });
    });
});
