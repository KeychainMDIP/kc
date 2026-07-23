import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { Operation } from '@mdip/gatekeeper/types';
import { jest } from '@jest/globals';

import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import { encodeNegentropyFrame } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
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
    type TrackedHyperswarm,
} from './hyperswarm-mediator-harness.ts';
import {
    createRecordingDuplexPair,
    type RecordingDuplexPair,
} from './recording-duplex.ts';

installMediatorMocks();

const FRAMING_VERSION = 1;
const NEGENTROPY_VERSION = 1;

interface RunningNode {
    node: MediatorNode;
    store: InMemoryOperationSyncStore;
    startSpy: jest.SpiedFunction<InMemoryOperationSyncStore['start']>;
    stopSpy: jest.SpiedFunction<InMemoryOperationSyncStore['stop']>;
}

interface ConnectedPeer {
    pair: RecordingDuplexPair;
    peerKey: string;
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

async function settle(turns = 5): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) {
        await nextTurn();
    }
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

async function makeOperations(count: number): Promise<Operation[]> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-lifecycle-fixtures'),
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

describe('hyperswarm mediator startup and lifecycle characterization', () => {
    const nodes: MediatorNode[] = [];
    const pairs: RecordingDuplexPair[] = [];
    let fakeTimersActive = false;
    let nodeNumber = 0;

    async function createRunningNode(options: {
        keyByte?: number;
        env?: Record<string, string | undefined>;
        beforeStart?: (node: MediatorNode, store: InMemoryOperationSyncStore) => Promise<void>;
    } = {}): Promise<RunningNode> {
        const node = await createMediatorNode({
            name: `lifecycle-node-${++nodeNumber}`,
            publicKey: Buffer.alloc(32, options.keyByte ?? 0x11),
            env: {
                KC_HYPR_NEGENTROPY_ENABLE: 'true',
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'false',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'true',
                KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW: '16',
                KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION: '8',
                KC_HYPR_NEGENTROPY_INTERVAL: '1',
                KC_HYPR_EXPORT_INTERVAL: '2',
                ...options.env,
            },
        });
        nodes.push(node);

        const store = new InMemoryOperationSyncStore();
        const startSpy = jest.spyOn(store, 'start');
        const stopSpy = jest.spyOn(store, 'stop');
        node.run(() => {
            getMediatorNodeContext().syncStore = store;
        });
        await options.beforeStart?.(node, store);

        const systemTime = Date.now();
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        jest.setSystemTime(systemTime);
        fakeTimersActive = true;
        await node.run(() => node.mediator.runMediator({ syncStore: store }));

        return { node, store, startSpy, stopSpy };
    }

    function emitConnection(
        running: RunningNode,
        peerKeyByte: number,
    ): ConnectedPeer {
        const publicKeyB = Buffer.alloc(32, peerKeyByte);
        const peerKey = publicKeyB.toString('hex');
        const pair = createRecordingDuplexPair({
            publicKeyA: running.node.publicKey,
            publicKeyB,
            receiveAtA: async () => undefined,
            receiveAtB: async () => undefined,
        });
        pairs.push(pair);
        const swarm = running.node.swarms.at(-1);
        if (!swarm) {
            throw new Error('expected running mediator swarm');
        }
        running.node.run(() => swarm.emit('connection', pair.connectionA));
        return { pair, peerKey };
    }

    async function attachConnection(
        running: RunningNode,
        peerKeyByte: number,
    ): Promise<ConnectedPeer> {
        const peer = emitConnection(running, peerKeyByte);
        const { pair } = peer;
        await eventually(() => pair.transcript.some(entry => entry.messageType === 'ping'));
        return peer;
    }

    async function strikeMalformedFramedPeer(
        running: RunningNode,
        peer: ConnectedPeer,
    ): Promise<void> {
        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
            type: 'neg_close',
            sessionId: 'stale-session',
            windowId: 'stale-window',
            reason: 'test',
        })));
        await peer.pair.pumpUntilIdle();
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        )).toMatchObject({ inboundTransportMode: 'framed' });

        peer.pair.connectionB.write(Buffer.alloc(4));
        await peer.pair.pumpUntilIdle();
        await settle();
        expect(peer.pair.connectionA.destroyed).toBe(true);
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        )).toBeNull();
    }

    async function sendPeerMessage(peer: ConnectedPeer, message: Record<string, unknown>): Promise<void> {
        peer.pair.connectionB.write(Buffer.from(JSON.stringify(message)));
        await peer.pair.pumpUntilIdle();
    }

    afterEach(async () => {
        for (const pair of pairs.splice(0).reverse()) {
            await pair.destroy();
        }
        await settle();
        if (fakeTimersActive) {
            jest.clearAllTimers();
        }
        for (const node of nodes.splice(0).reverse()) {
            await node.dispose();
        }
        if (fakeTimersActive) {
            jest.useRealTimers();
            fakeTimersActive = false;
        }
        jest.restoreAllMocks();
    });

    it('starts with an in-memory store and leaves IPFS clients disabled', async () => {
        const running = await createRunningNode();
        const swarm = running.node.swarms[0];

        expect(running.startSpy).toHaveBeenCalledTimes(1);
        expect(running.node.gatekeeperClient.connect).toHaveBeenCalledTimes(1);
        expect(running.node.keymasterClient.connect).not.toHaveBeenCalled();
        expect(running.node.kuboClient.connect).not.toHaveBeenCalled();
        expect(running.node.kuboClient.resetPeeringPeers).not.toHaveBeenCalled();
        expect(running.node.swarms).toHaveLength(1);
        expect(swarm.join).toHaveBeenCalledWith(expect.any(Buffer), { client: true, server: true });
        expect(swarm.destroyed).toBe(false);
        expect(running.node.run(() => getMediatorNodeContext().shutdownHook)).toEqual(expect.any(Function));
        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(2);
    });

    it('handles real swarm connection, close, error, and malformed-data events', async () => {
        const running = await createRunningNode();
        const closedPeer = await attachConnection(running, 0x22);

        expect(closedPeer.pair.transcript[0]).toMatchObject({
            direction: 'a-to-b',
            messageType: 'ping',
            transportMode: 'legacy',
        });
        await sendPeerMessage(closedPeer, peerPing());
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(closedPeer.peerKey),
        )).toMatchObject({ transportMode: 'framed', activeSession: { mode: 'negentropy' } });

        running.node.run(() => closedPeer.pair.connectionA.emit('close'));
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(closedPeer.peerKey),
        )).toBeNull();

        const erroredPeer = await attachConnection(running, 0x33);
        running.node.run(() => erroredPeer.pair.connectionA.emit('error', new Error('connection failed')));
        await settle();
        expect(erroredPeer.pair.connectionA.destroyed).toBe(true);
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(erroredPeer.peerKey),
        )).toBeNull();

        const malformedPeer = await attachConnection(running, 0x44);
        malformedPeer.pair.connectionB.write(Buffer.alloc(4));
        await malformedPeer.pair.pumpUntilIdle();
        await settle();
        expect(malformedPeer.pair.connectionA.destroyed).toBe(true);
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(malformedPeer.peerKey),
        )).toBeNull();
    });

    it('cools down malformed framed connections and accepts them after expiry', async () => {
        const running = await createRunningNode({
            env: {
                KC_HYPR_EXPORT_INTERVAL: '3600',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const peerKeyByte = 0x44;

        for (let strike = 0; strike < 3; strike += 1) {
            await strikeMalformedFramedPeer(running, await attachConnection(running, peerKeyByte));
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const rejected = emitConnection(running, peerKeyByte);
            await eventually(() => rejected.pair.connectionA.destroyed);
            expect(rejected.pair.transcript.filter(entry => entry.direction === 'a-to-b')).toHaveLength(0);
            expect(running.node.run(
                () => running.node.mediator.__test.getConnectionState(rejected.peerKey),
            )).toBeNull();
        }

        running.node.run(() => jest.setSystemTime(Date.now() + (5 * 60 * 1_000) + 1));
        const accepted = await attachConnection(running, peerKeyByte);
        expect(accepted.pair.connectionA.destroyed).toBe(false);
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(accepted.peerKey),
        )).not.toBeNull();
    });

    it('clears malformed-peer strikes after a valid framed ping', async () => {
        const running = await createRunningNode({
            env: {
                KC_HYPR_EXPORT_INTERVAL: '3600',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const peerKeyByte = 0x55;

        await strikeMalformedFramedPeer(running, await attachConnection(running, peerKeyByte));

        const cleared = await attachConnection(running, peerKeyByte);
        cleared.pair.connectionB.write(encodeFramedMessage(JSON.stringify(peerPing())));
        await cleared.pair.pumpUntilIdle();
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(cleared.peerKey),
        )).toMatchObject({ inboundTransportMode: 'framed' });
        cleared.pair.connectionB.write(Buffer.alloc(4));
        await cleared.pair.pumpUntilIdle();
        await settle();
        expect(cleared.pair.connectionA.destroyed).toBe(true);
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(cleared.peerKey),
        )).toBeNull();

        await strikeMalformedFramedPeer(running, await attachConnection(running, peerKeyByte));

        const accepted = emitConnection(running, peerKeyByte);
        await eventually(() => (
            accepted.pair.connectionA.destroyed
            || accepted.pair.transcript.some(entry => entry.messageType === 'ping')
        ));
        expect(accepted.pair.connectionA.destroyed).toBe(false);
        expect(accepted.pair.transcript.some(entry => entry.messageType === 'ping')).toBe(true);
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(accepted.peerKey),
        )).not.toBeNull();
    });

    it('recreates the swarm from the connection loop when no peers remain', async () => {
        const running = await createRunningNode({
            env: { KC_HYPR_EXPORT_INTERVAL: '3600' },
        });
        const firstSwarm = running.node.swarms[0];

        await running.node.run(() => jest.advanceTimersByTimeAsync(60_000));

        expect(firstSwarm.destroyed).toBe(true);
        expect(running.node.swarms).toHaveLength(2);
        expect(running.node.swarms[1].destroyed).toBe(false);
        expect(running.node.swarms[1].join).toHaveBeenCalledTimes(1);
    });

    it('starts periodic repair from the recurring connection loop', async () => {
        const running = await createRunningNode({
            env: { KC_HYPR_EXPORT_INTERVAL: '3600' },
        });
        const peer = await attachConnection(running, 0x22);
        await sendPeerMessage(peer, peerPing());
        const negOpenEntries = () => peer.pair.transcript.filter(
            entry => entry.direction === 'a-to-b' && entry.messageType === 'neg_open',
        );
        const initialOpenEntry = negOpenEntries().at(-1);
        if (!initialOpenEntry) {
            throw new Error('expected initial neg_open');
        }
        const [initialOpenPayload] = decodeUnknownTransportMessages(initialOpenEntry.raw).messages;
        const initialOpen = JSON.parse(initialOpenPayload.toString('utf8')) as {
            sessionId?: unknown;
            windowId?: unknown;
        };
        if (typeof initialOpen.sessionId !== 'string' || typeof initialOpen.windowId !== 'string') {
            throw new Error('initial neg_open is missing session or window ID');
        }
        const initialNegOpenCount = negOpenEntries().length;

        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
            type: 'neg_close',
            sessionId: initialOpen.sessionId,
            windowId: initialOpen.windowId,
            reason: 'interrupted',
        })));
        await peer.pair.pumpUntilIdle();
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey)?.activeSession,
        )).toBeNull();
        expect(negOpenEntries()).toHaveLength(initialNegOpenCount);

        await running.node.run(() => jest.advanceTimersByTimeAsync(60_000));
        await eventually(() => {
            const state = running.node.run(
                () => running.node.mediator.__test.getConnectionState(peer.peerKey),
            );
            const sessionId = (state?.activeSession as { sessionId?: string } | null)?.sessionId;
            return typeof sessionId === 'string'
                && sessionId !== initialOpen.sessionId
                && negOpenEntries().length > initialNegOpenCount;
        });

        const repairedState = running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        );
        const repairedSessionId = (repairedState?.activeSession as { sessionId?: string } | null)?.sessionId;
        expect(repairedSessionId).toEqual(expect.any(String));
        expect(repairedSessionId).not.toBe(initialOpen.sessionId);
        expect(negOpenEntries()).toHaveLength(initialNegOpenCount + 1);
        expect(negOpenEntries().at(-1)).toMatchObject({ transportMode: 'framed' });
    });

    it('refreshes idle activity for cached progress but not exact duplicates', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const running = await createRunningNode({
            env: {
                KC_HYPR_EXPORT_INTERVAL: '3600',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const adapter = await NegentropyAdapter.create({
            syncStore: running.store,
            maxRecordsPerWindow: 16,
            maxRoundsPerSession: 8,
            deferInitialBuild: true,
        });
        running.node.run(() => {
            getMediatorNodeContext().negentropyAdapter = adapter;
            running.node.mediator.__test.setNegentropyAdapter(adapter);
        });
        const createEngine = adapter.createEngineForSnapshot.bind(adapter);
        jest.spyOn(adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile')
                .mockResolvedValueOnce({
                    nextMsg: 'first-response',
                    haveIds: [],
                    needIds: [operationId],
                })
                .mockResolvedValueOnce({
                    nextMsg: 'second-response',
                    haveIds: [],
                    needIds: [operationId],
                });
            return engine;
        });

        const peer = await attachConnection(running, 0x22);
        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify(peerPing())));
        await peer.pair.pumpUntilIdle();
        await eventually(() => peer.pair.transcript.some(entry => entry.messageType === 'neg_open'));
        const openEntry = peer.pair.transcript.find(entry => entry.messageType === 'neg_open')!;
        const [openPayload] = decodeUnknownTransportMessages(openEntry.raw).messages;
        const open = JSON.parse(openPayload.toString('utf8')) as {
            sessionId: string;
            windowId: string;
        };
        const messages = () => peer.pair.transcript.flatMap(entry => (
            decodeUnknownTransportMessages(entry.raw).messages.map(message => (
                JSON.parse(message.toString('utf8')) as { type?: string }
            ))
        ));
        const sendFramed = async (message: Record<string, unknown>): Promise<void> => {
            peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify(message)));
            await peer.pair.pumpUntilIdle();
            await settle();
        };

        await sendFramed({
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('first-round'),
        });
        await eventually(() => messages().filter(message => message.type === 'ops_req').length === 1);
        await sendFramed({
            type: 'ops_push',
            sessionId: open.sessionId,
            windowId: open.windowId,
            data: [operation],
        });
        await eventually(() => running.store.has(operationId));
        await sendFramed({
            type: 'neg_msg',
            sessionId: open.sessionId,
            windowId: open.windowId,
            frame: encodeNegentropyFrame('second-round'),
        });
        await eventually(() => messages().filter(message => message.type === 'ops_req').length === 2);

        await running.node.run(() => jest.advanceTimersByTimeAsync(119_000));
        await sendFramed({
            type: 'ops_push',
            sessionId: open.sessionId,
            windowId: open.windowId,
            data: [operation],
        });
        await running.node.run(() => jest.advanceTimersByTimeAsync(2_000));
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });

        await sendFramed({
            type: 'ops_push',
            sessionId: open.sessionId,
            windowId: open.windowId,
            data: [operation],
        });
        await running.node.run(() => jest.advanceTimersByTimeAsync(60_000));
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey)?.activeSession,
        )).toEqual({ mode: 'negentropy', sessionId: open.sessionId });

        await running.node.run(() => jest.advanceTimersByTimeAsync(60_000));
        await eventually(() => running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey)?.activeSession === null,
        ));
    });

    it('keeps two ordered catch-up batches queued behind the current import', async () => {
        const operations = await makeOperations(4);
        const running = await createRunningNode({
            keyByte: 0x33,
            env: {
                KC_HYPR_EXPORT_INTERVAL: '3600',
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        const peer = await attachConnection(running, 0x22);
        await sendPeerMessage(peer, peerPing({
            capabilities: { negentropy: false },
        }));
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        )).toMatchObject({ transportMode: 'framed', inboundTransportMode: 'framed' });

        const processEvents = running.node.gatekeeperClient.processEvents;
        const processEventsImplementation = processEvents.getMockImplementation();
        if (!processEventsImplementation) {
            throw new Error('Gatekeeper processEvents implementation is unavailable');
        }
        let markFirstStarted!: () => void;
        const firstStarted = new Promise<void>(resolve => {
            markFirstStarted = resolve;
        });
        let releaseFirst!: () => void;
        const firstBlocked = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        let markSecondStarted!: () => void;
        const secondStarted = new Promise<void>(resolve => {
            markSecondStarted = resolve;
        });
        let releaseSecond!: () => void;
        const secondBlocked = new Promise<void>(resolve => {
            releaseSecond = resolve;
        });
        let markThirdStarted!: () => void;
        const thirdStarted = new Promise<void>(resolve => {
            markThirdStarted = resolve;
        });
        processEvents
            .mockImplementationOnce(async () => {
                markFirstStarted();
                await firstBlocked;
                return processEventsImplementation();
            })
            .mockImplementationOnce(async () => {
                markSecondStarted();
                await secondBlocked;
                return processEventsImplementation();
            })
            .mockImplementationOnce(async () => {
                markThirdStarted();
                return processEventsImplementation();
            });

        running.node.run(
            () => running.node.mediator.__test.createOrderedCatchupClientSession(peer.peerKey, 'buffered-session'),
        );
        for (const [index, operation] of operations.slice(0, 3).entries()) {
            peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'buffered-session',
                cursor: { syncOrder: index + 1, id: operation.signature!.hash },
                hasMore: true,
                data: [operation],
            })));
        }

        try {
            await peer.pair.pumpUntilIdle();
            await firstStarted;
            const requestCount = () => peer.pair.transcript.filter(entry => (
                entry.direction === 'a-to-b' && entry.messageType === 'ordered_catchup_req'
            )).length;
            await eventually(() => requestCount() === 2);
            expect(processEvents).toHaveBeenCalledTimes(1);
            expect(await running.store.has(operations[1].signature!.hash)).toBe(false);
            expect(await running.store.has(operations[2].signature!.hash)).toBe(false);

            releaseFirst();
            await secondStarted;
            await eventually(() => requestCount() === 3);
            peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
                type: 'ordered_catchup_push',
                sessionId: 'buffered-session',
                cursor: { syncOrder: 4, id: operations[3].signature!.hash },
                hasMore: false,
                data: [operations[3]],
            })));
            await peer.pair.pumpUntilIdle();
            expect(processEvents).toHaveBeenCalledTimes(2);
            expect(await running.store.has(operations[3].signature!.hash)).toBe(false);
            expect(running.node.run(
                () => running.node.mediator.__test.getConnectionState(peer.peerKey)?.activeSession,
            )).toEqual({ mode: 'ordered_catchup', sessionId: 'buffered-session' });

            releaseSecond();
            await thirdStarted;
            await eventually(async () => {
                const stored = await Promise.all(operations.map(
                    operation => running.store.has(operation.signature!.hash),
                ));
                return stored.every(Boolean);
            });
            await eventually(() => running.node.run(
                () => running.node.mediator.__test.getConnectionState(peer.peerKey)?.activeSession === null,
            ));
            expect(processEvents).toHaveBeenCalledTimes(4);
        }
        finally {
            releaseFirst();
            releaseSecond();
        }
    });

    it('expires an idle ordered catch-up server session without closing its connection', async () => {
        const operations = await makeOperations(301);
        const running = await createRunningNode({
            keyByte: 0x33,
            env: {
                KC_HYPR_EXPORT_INTERVAL: '3600',
                KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
                KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
            },
        });
        await running.store.upsertMany(operations.map((operation, index) => ({
            id: operation.signature!.hash,
            ts: Math.floor(Date.parse(operation.signature!.signed) / 1000),
            syncOrder: index + 1,
            operation,
        })));
        const peer = await attachConnection(running, 0x22);
        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify(peerPing({
            capabilities: {
                negentropy: true,
                negentropyVersion: NEGENTROPY_VERSION,
                orderedCatchup: true,
                orderedCatchupVersion: 1,
                orderedCatchupReady: true,
                operationCount: 0,
                orderedOperationCount: 0,
            },
        }))));
        await peer.pair.pumpUntilIdle();

        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
            type: 'ordered_catchup_req',
            sessionId: 'idle-server-session',
        })));
        await peer.pair.pumpUntilIdle();

        const pushEntry = peer.pair.transcript.find(entry => (
            entry.direction === 'a-to-b' && entry.messageType === 'ordered_catchup_push'
        ));
        if (!pushEntry) {
            throw new Error('expected an ordered catch-up push');
        }
        const [pushPayload] = decodeUnknownTransportMessages(pushEntry.raw).messages;
        expect(JSON.parse(pushPayload.toString('utf8'))).toMatchObject({
            type: 'ordered_catchup_push',
            sessionId: 'idle-server-session',
            hasMore: true,
        });
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        )).toMatchObject({
            orderedCatchupServerSessionId: 'idle-server-session',
            orderedCatchupServerLastActivity: expect.any(Number),
        });

        await running.node.run(() => jest.advanceTimersByTimeAsync(3 * 60 * 1_000));
        await eventually(() => running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey)
                ?.orderedCatchupServerSessionId === null,
        ));

        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        )).toMatchObject({
            activeSession: null,
            orderedCatchupServerSessionId: null,
            orderedCatchupServerLastActivity: 0,
        });
        expect(peer.pair.connectionA.destroyed).toBe(false);
    });

    it('flushes Gatekeeper queue entries on the recurring export loop', async () => {
        const [operation] = await makeOperations(1);
        const running = await createRunningNode();
        const peer = await attachConnection(running, 0x22);
        await sendPeerMessage(peer, peerPing());
        running.node.gatekeeperClient.getQueue.mockResolvedValueOnce([operation]);

        await running.node.run(() => jest.advanceTimersByTimeAsync(2_000));
        await eventually(async () => await running.store.has(operation.signature!.hash));

        expect(running.node.gatekeeperClient.clearQueue).toHaveBeenCalledWith(
            'hyperswarm',
            [operation.signature!.hash],
        );
        expect(peer.pair.transcript).toEqual(expect.arrayContaining([
            expect.objectContaining({ messageType: 'queue', transportMode: 'framed' }),
        ]));
    });

    it('prunes retained persistence retries after an index backfill', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        let persistenceFailed = false;
        const running = await createRunningNode({
            beforeStart: async (node, store) => {
                const upsertMany = store.upsertMany.bind(store);
                jest.spyOn(store, 'upsertMany').mockImplementation(async records => {
                    if (!persistenceFailed && records.some(record => record.id === operationId)) {
                        persistenceFailed = true;
                        throw new Error('transient sync-store failure');
                    }
                    return upsertMany(records);
                });
                node.gatekeeperClient.getQueue
                    .mockResolvedValueOnce([operation])
                    .mockResolvedValue([]);
            },
        });

        expect(persistenceFailed).toBe(true);
        expect(await running.store.has(operationId)).toBe(false);

        await running.node.gatekeeper.createDID(operation);
        const getByIds = jest.spyOn(running.store, 'getByIds');
        await running.node.run(() => jest.advanceTimersByTimeAsync(2_000));
        await eventually(async () => await running.store.has(operationId));

        expect(getByIds).toHaveBeenCalledWith([operationId]);
    });

    it('prunes active-session unresolved operations after an index backfill', async () => {
        const [operation] = await makeOperations(1);
        const operationId = operation.signature!.hash;
        const running = await createRunningNode({
            keyByte: 0x33,
            env: { KC_HYPR_LEGACY_SYNC_ENABLE: 'false' },
        });
        const adapter = await NegentropyAdapter.create({
            syncStore: running.store,
            maxRecordsPerWindow: 16,
            maxRoundsPerSession: 8,
            deferInitialBuild: true,
        });
        running.node.run(() => {
            getMediatorNodeContext().negentropyAdapter = adapter;
            running.node.mediator.__test.setNegentropyAdapter(adapter);
        });
        const createEngine = adapter.createEngineForSnapshot.bind(adapter);
        jest.spyOn(adapter, 'createEngineForSnapshot').mockImplementationOnce(snapshot => {
            const engine = createEngine(snapshot);
            jest.spyOn(engine, 'reconcile').mockResolvedValueOnce({
                nextMsg: null,
                haveIds: [],
                needIds: [],
            });
            return engine;
        });

        const peer = await attachConnection(running, 0x22);
        await sendPeerMessage(peer, peerPing());
        const window = {
            name: 'index-backfill',
            fromTs: 0,
            toTs: Math.floor(Date.now() / 1_000),
            maxRecords: 16,
            order: 0,
        };
        const sessionId = 'index-backfill-session';
        const windowId = 'index-backfill-window';
        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
            type: 'neg_open',
            sessionId,
            windowId,
            round: 0,
            window,
            frame: encodeNegentropyFrame('index-backfill-open'),
        })));
        await peer.pair.pumpUntilIdle();

        running.node.gatekeeperClient.importBatch.mockImplementationOnce(async events => ({
            queued: 0,
            processed: 0,
            rejected: events.length,
            total: 0,
            rejectedIndices: events.map((_, index) => index),
        }));
        const getByIds = jest.spyOn(running.store, 'getByIds');
        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
            type: 'ops_push',
            sessionId,
            windowId,
            data: [operation],
        })));
        await peer.pair.pumpUntilIdle();
        expect(await running.store.has(operationId)).toBe(false);
        getByIds.mockClear();

        await running.node.gatekeeper.createDID(operation);
        await running.node.run(() => jest.advanceTimersByTimeAsync(2_000));
        await eventually(async () => await running.store.has(operationId));
        expect(getByIds).toHaveBeenCalledWith([operationId]);
        getByIds.mockClear();

        peer.pair.connectionB.write(encodeFramedMessage(JSON.stringify({
            type: 'neg_close',
            sessionId,
            windowId,
            reason: 'complete',
        })));
        await peer.pair.pumpUntilIdle();
        await settle();

        expect(getByIds).not.toHaveBeenCalled();
        expect(peer.pair.connectionA.destroyed).toBe(false);
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey)?.activeSession,
        )).toBeNull();
        expect(running.node.run(
            () => running.node.mediator.__test.getSyncStatsSnapshot(),
        )).toMatchObject({
            negentropy: {
                sessionsCompleted: 1,
                sessionsFailed: 0,
            },
        });
    });

    it('bounds failed persistence retries and backfills an evicted operation', async () => {
        const [oldestOperation] = await makeOperations(1);
        const fillerOperations: Operation[] = Array.from({ length: 1_000 }, (_, index) => {
            const signed = new Date(Date.now() - ((1_001 - index) * 1_000)).toISOString();
            return {
                type: 'create',
                created: signed,
                mdip: {
                    version: 1,
                    type: 'agent',
                    registry: 'hyperswarm',
                },
                signature: {
                    signed,
                    hash: (index + 1).toString(16).padStart(64, '0'),
                    value: `test-${index}`,
                },
            };
        });
        const operations = [oldestOperation, ...fillerOperations];
        const newestOperation = operations.at(-1)!;
        let persistenceFailed = false;
        let upsertMany!: jest.SpiedFunction<InMemoryOperationSyncStore['upsertMany']>;
        const running = await createRunningNode({
            beforeStart: async (node, store) => {
                const persist = store.upsertMany.bind(store);
                upsertMany = jest.spyOn(store, 'upsertMany')
                    .mockImplementation(async records => {
                        if (!persistenceFailed && records.length === operations.length) {
                            persistenceFailed = true;
                            throw new Error('persistent sync-store failure');
                        }
                        return persist(records);
                    });
                node.gatekeeperClient.getQueue
                    .mockResolvedValueOnce(operations)
                    .mockResolvedValue([]);
                node.gatekeeperClient.importBatch.mockImplementation(async events => ({
                    queued: 0,
                    processed: events.length,
                    rejected: 0,
                    total: events.length,
                    rejectedIndices: [],
                }));
                node.gatekeeperClient.processEvents.mockResolvedValue({
                    added: 0,
                    merged: 0,
                    rejected: 0,
                    pending: 0,
                    acceptedHashes: [],
                    acceptedEvents: [],
                });
            },
        });
        expect(persistenceFailed).toBe(true);
        const callsAfterFailure = upsertMany.mock.calls.length;

        const peer = await attachConnection(running, 0x22);
        const queueMessage = (operation: Operation) => ({
            type: 'queue',
            time: new Date().toISOString(),
            node: 'peer',
            relays: [],
            data: [operation],
        });

        await sendPeerMessage(peer, queueMessage(oldestOperation));
        await eventually(() => running.node.gatekeeperClient.processEvents.mock.calls.length >= 1);
        await settle();
        expect(upsertMany).toHaveBeenCalledTimes(callsAfterFailure);

        await sendPeerMessage(peer, queueMessage(newestOperation));
        await eventually(() => upsertMany.mock.calls.length > callsAfterFailure);
        expect(upsertMany.mock.calls[callsAfterFailure][0].map(record => record.id)).toStrictEqual([
            newestOperation.signature!.hash,
        ]);

        await running.node.gatekeeper.createDID(oldestOperation);
        await running.node.run(() => jest.advanceTimersByTimeAsync(2_000));
        await eventually(async () => await running.store.has(oldestOperation.signature!.hash));
    });

    it('resets synchronized state and restarts peer sync after a Gatekeeper epoch change', async () => {
        const [oldOperation, newOperation] = await makeOperations(2);
        let resetSpy: jest.SpiedFunction<InMemoryOperationSyncStore['reset']>;
        const running = await createRunningNode({
            beforeStart: async (node, store) => {
                resetSpy = jest.spyOn(store, 'reset');
                await node.gatekeeper.createDID(oldOperation);
            },
        });
        const peer = await attachConnection(running, 0x22);
        await sendPeerMessage(peer, peerPing());
        const firstState = running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        );
        const firstSessionId = (firstState?.activeSession as { sessionId?: string } | null)?.sessionId;
        const negOpenCount = () => peer.pair.transcript.filter(
            entry => entry.direction === 'a-to-b' && entry.messageType === 'neg_open',
        ).length;
        const initialNegOpenCount = negOpenCount();
        expect(firstSessionId).toEqual(expect.any(String));
        expect(initialNegOpenCount).toBeGreaterThan(0);
        expect(await running.store.has(oldOperation.signature!.hash)).toBe(true);

        await running.node.gatekeeper.resetDb();
        await running.node.gatekeeper.createDID(newOperation);
        await running.node.run(() => jest.advanceTimersByTimeAsync(2_000));
        await eventually(async () => await running.store.has(newOperation.signature!.hash));
        await eventually(() => {
            const state = running.node.run(
                () => running.node.mediator.__test.getConnectionState(peer.peerKey),
            );
            const sessionId = (state?.activeSession as { sessionId?: string } | null)?.sessionId;
            return typeof sessionId === 'string'
                && sessionId !== firstSessionId
                && negOpenCount() > initialNegOpenCount;
        });

        expect(resetSpy!).toHaveBeenCalledTimes(1);
        expect(await running.store.has(oldOperation.signature!.hash)).toBe(false);
        const resetState = running.node.run(
            () => running.node.mediator.__test.getConnectionState(peer.peerKey),
        );
        const resetSessionId = (resetState?.activeSession as { sessionId?: string } | null)?.sessionId;
        expect(resetSessionId).toEqual(expect.any(String));
        expect(resetSessionId).not.toBe(firstSessionId);
        expect(negOpenCount()).toBeGreaterThan(initialNegOpenCount);
    });

    it('defers legacy inbound and outbound work until active Negentropy finishes', async () => {
        const [operation] = await makeOperations(1);
        const running = await createRunningNode({
            beforeStart: async node => {
                await node.gatekeeper.createDID(operation);
            },
        });
        const negentropyPeer = await attachConnection(running, 0x22);
        await sendPeerMessage(negentropyPeer, peerPing());
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(negentropyPeer.peerKey)?.activeSession,
        )).toEqual(expect.objectContaining({ mode: 'negentropy' }));

        const legacyPeer = await attachConnection(running, 0x33);
        await sendPeerMessage(legacyPeer, peerPing({
            capabilities: undefined,
            transportFramingVersion: undefined,
        }));
        await sendPeerMessage(legacyPeer, {
            type: 'sync',
            time: new Date().toISOString(),
            node: 'legacy-peer',
            relays: [],
        });
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(legacyPeer.peerKey),
        )).toMatchObject({
            syncMode: 'legacy',
            activeSession: null,
        });
        const sentByMediator = (messageType: string) => legacyPeer.pair.transcript.some(
            entry => entry.direction === 'a-to-b' && entry.messageType === messageType,
        );
        expect(sentByMediator('sync')).toBe(false);
        expect(sentByMediator('batch')).toBe(false);

        running.node.run(() => negentropyPeer.pair.connectionA.emit('close'));
        await eventually(() => sentByMediator('sync'));
        await eventually(() => sentByMediator('batch'));

        expect(legacyPeer.pair.transcript.filter(entry => entry.direction === 'a-to-b'
            && ['sync', 'batch'].includes(entry.messageType ?? ''))).toEqual(expect.arrayContaining([
            expect.objectContaining({ messageType: 'sync', transportMode: 'legacy' }),
            expect.objectContaining({ messageType: 'batch', transportMode: 'legacy' }),
        ]));
        expect(running.node.run(
            () => running.node.mediator.__test.getConnectionState(legacyPeer.peerKey),
        )).toMatchObject({ activeSession: { mode: 'legacy' } });
    });

    it('destroys the active swarm and stops the injected store during graceful shutdown', async () => {
        const running = await createRunningNode();
        const swarm: TrackedHyperswarm = running.node.swarms[0];
        const shutdown = running.node.run(() => getMediatorNodeContext().shutdownHook);
        if (!shutdown) {
            throw new Error('expected graceful shutdown callback');
        }

        await running.node.run(() => shutdown());

        expect(swarm.destroyed).toBe(true);
        expect(running.stopSpy).toHaveBeenCalledTimes(1);
        running.node.run(() => {
            getMediatorNodeContext().shutdownHook = null;
        });
    });
});
