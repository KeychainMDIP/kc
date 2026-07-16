import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import { jest } from '@jest/globals';
import { compareSyncCursor } from '../../services/mediators/hyperswarm/src/negentropy/cursor.ts';
import { mapOperationToSyncKey } from '../../services/mediators/hyperswarm/src/sync-mapping.ts';
import {
    decodeUnknownTransportMessages,
    encodeFramedMessage,
} from '../../services/mediators/hyperswarm/src/transport-framing.ts';
import TestHelper from '../gatekeeper/helper.ts';
import { installMediatorMocks } from './hyperswarm-mediator-harness.ts';
import { createMediatorDriver } from './hyperswarm-mediator-driver.ts';
import type {
    RecordingDuplexPair,
    TransportDirection,
} from './recording-duplex.ts';

installMediatorMocks();

jest.setTimeout(60_000);

const NEGENTROPY_MESSAGE_TYPES = new Set([
    'neg_open',
    'neg_msg',
    'ops_req',
    'ops_push',
    'neg_close',
]);

interface Cursor {
    ts: number;
    id: string;
}

interface WireWindow {
    name: string;
    fromTs: number;
    toTs: number;
    maxRecords: number;
    order: number;
    after?: Cursor;
}

interface WireBody {
    type: string;
    sessionId?: string;
    windowId?: string;
    window?: WireWindow;
    windowProgress?: {
        cappedByRecords?: boolean;
        lastCursor?: Cursor;
    };
    ids?: string[];
    data?: Operation[];
}

interface WireMessage {
    sequence: number;
    direction: TransportDirection;
    body: WireBody;
}

type ScenarioName =
    | 'identical'
    | 'partial overlap'
    | 'fully disjoint'
    | 'interleaved capped pages'
    | 'same-second exact cap'
    | 'same-second cap-plus-one'
    | 'local-only continuation cursor'
    | 'peer-only older history';

interface ConvergenceScenario {
    operationsA: Operation[];
    operationsB: Operation[];
    maxRecordsPerWindow: number;
    expectContinuation: boolean;
    knownOutsideId?: string;
}

interface WireKnowledge {
    operationsA: Operation[];
    operationsB: Operation[];
    expectedOperations: Operation[];
    expectLocalOnlyContinuation?: boolean;
}

function setSignedTime(operation: Operation, timestampMs: number): void {
    if (!operation.signature) {
        throw new Error('fixture operation signature is missing');
    }
    operation.signature.signed = new Date(timestampMs).toISOString();
}

async function createOperationFixtures(): Promise<{
    controllerCreate: Operation;
    controllerUpdate: Operation;
    independentCreate: Operation;
}> {
    const db = new DbJsonMemory('hyperswarm-mediator-fixtures');
    const gatekeeper = new Gatekeeper({
        db,
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const baseTime = Date.now() - (10 * 60 * 1_000);

    const controllerKeys = cipher.generateRandomJwk();
    const controllerCreate = await helper.createAgentOp(controllerKeys, {
        version: 1,
        registry: 'hyperswarm',
    });
    setSignedTime(controllerCreate, baseTime);
    const controllerDid = await gatekeeper.createDID(controllerCreate);
    const controllerDocument = await gatekeeper.resolveDID(controllerDid);
    const controllerUpdate = await helper.createUpdateOp(
        controllerKeys,
        controllerDid,
        controllerDocument,
    );
    setSignedTime(controllerUpdate, baseTime + 60_000);
    if (!await gatekeeper.updateDID(controllerUpdate)) {
        throw new Error('fixture controller update was rejected');
    }

    const independentKeys = cipher.generateRandomJwk();
    const independentCreate = await helper.createAgentOp(independentKeys, {
        version: 1,
        registry: 'hyperswarm',
    });
    setSignedTime(independentCreate, baseTime + 120_000);
    await gatekeeper.createDID(independentCreate);
    await gatekeeper.resetDb();

    return { controllerCreate, controllerUpdate, independentCreate };
}

function operationIds(operations: Operation[]): string[] {
    return Array.from(new Set(
        operations.map(operation => operation.signature!.hash.toLowerCase()),
    )).sort();
}

async function gatekeeperIds(gatekeeper: Gatekeeper): Promise<string[]> {
    const events = await gatekeeper.exportBatch();
    return operationIds(events.map(event => event.operation));
}

function operationCursor(operation: Operation): Cursor {
    const mapped = mapOperationToSyncKey(operation);
    if (!mapped.ok) {
        throw new Error(`fixture operation cannot be mapped: ${mapped.error}`);
    }
    return { ts: mapped.value.ts, id: mapped.value.idHex };
}

function cursorOrderedIds(operations: Operation[]): string[] {
    const unique = new Map<string, Cursor>();
    for (const operation of operations) {
        const cursor = operationCursor(operation);
        unique.set(cursor.id, cursor);
    }
    return Array.from(unique.values()).sort(compareSyncCursor).map(cursor => cursor.id);
}

function sameCursor(left?: Cursor, right?: Cursor): boolean {
    return left?.ts === right?.ts && left?.id === right?.id;
}

function snapshotCappedCursor(
    knownIds: Set<string>,
    expectedCursors: Iterable<Cursor>,
    window: WireWindow,
): Cursor | undefined {
    const cursors = Array.from(expectedCursors)
        .filter(cursor => (
            knownIds.has(cursor.id)
            && cursor.ts >= window.fromTs
            && cursor.ts <= window.toTs
            && (!window.after || compareSyncCursor(cursor, window.after) > 0)
        ))
        .sort(compareSyncCursor);
    return cursors.length > window.maxRecords
        ? cursors[window.maxRecords - 1]
        : undefined;
}

function decodeWire(link: RecordingDuplexPair): WireMessage[] {
    return link.transcript.flatMap(entry => {
        const decoded = decodeUnknownTransportMessages(entry.raw);
        if (decoded.error || decoded.remaining.length > 0) {
            throw new Error(`failed to decode wire write ${entry.sequence}: ${decoded.error ?? 'remaining bytes'}`);
        }
        return decoded.messages.map(raw => ({
            sequence: entry.sequence,
            direction: entry.direction,
            body: JSON.parse(raw.toString('utf8')) as WireBody,
        }));
    });
}

function assertWindowProtocol(link: RecordingDuplexPair, knowledge: WireKnowledge): WireMessage[] {
    const messages = decodeWire(link).filter(message => NEGENTROPY_MESSAGE_TYPES.has(message.body.type));
    const opens = messages.filter(message => message.body.type === 'neg_open');
    expect(opens.length).toBeGreaterThan(0);
    expect(opens[0].body.window).toMatchObject({ order: 0 });
    expect(opens[0].body.window?.after).toBeUndefined();
    const initiatorDirection = link.connectionB.remotePublicKey.compare(link.connectionA.remotePublicKey) < 0
        ? 'a-to-b'
        : 'b-to-a';
    expect(opens.every(open => open.direction === initiatorDirection)).toBe(true);

    const sessionIds = new Set(messages.map(message => message.body.sessionId));
    expect(sessionIds.size).toBe(1);
    expect(Array.from(sessionIds)[0]).toEqual(expect.any(String));

    const knownA = new Set(operationIds(knowledge.operationsA));
    const knownB = new Set(operationIds(knowledge.operationsB));
    const expectedCursors = new Map<string, Cursor>();
    for (const operation of knowledge.expectedOperations) {
        const cursor = operationCursor(operation);
        expectedCursors.set(cursor.id, cursor);
    }
    const deliveredWriteSequences = new Set(
        link.deliveries
            .filter(delivery => delivery.action !== 'dropped')
            .flatMap(delivery => delivery.writeSequences),
    );
    const seenWindowTuples = new Set<string>();
    const initiatorSnapshotCursors = new Map<string, Cursor | undefined>();
    let currentWindowId: string | null = null;
    let currentWindow: WireWindow | null = null;
    for (const message of messages) {
        expect(message.body.sessionId).toBe(opens[0].body.sessionId);
        expect(message.body.windowId).toEqual(expect.any(String));
        const windowId = message.body.windowId!;

        if (message.body.type === 'neg_open') {
            expect(message.body.window).toBeDefined();
            const nextWindow = message.body.window!;
            if (currentWindow && nextWindow.order > currentWindow.order && nextWindow.after) {
                const requiredIds = Array.from(expectedCursors.values())
                    .filter(cursor => (
                        cursor.ts >= nextWindow.fromTs
                        && cursor.ts <= nextWindow.toTs
                        && compareSyncCursor(cursor, nextWindow.after!) <= 0
                    ))
                    .map(cursor => cursor.id);
                expect(requiredIds.filter(id => !knownA.has(id))).toEqual([]);
                expect(requiredIds.filter(id => !knownB.has(id))).toEqual([]);
            }
            const tuple = JSON.stringify(nextWindow);
            expect(seenWindowTuples.has(tuple)).toBe(false);
            seenWindowTuples.add(tuple);
            initiatorSnapshotCursors.set(windowId, snapshotCappedCursor(
                message.direction === 'a-to-b' ? knownA : knownB,
                expectedCursors.values(),
                nextWindow,
            ));
            currentWindowId = windowId;
            currentWindow = nextWindow;
        }
        else {
            expect(currentWindowId).not.toBeNull();
            expect(windowId).toBe(currentWindowId);
        }

        const progress = message.body.windowProgress;
        if (progress?.cappedByRecords) {
            expect(progress.lastCursor).toBeDefined();
        }
        if (progress?.lastCursor) {
            expect(currentWindow).not.toBeNull();
            if (currentWindow!.after) {
                expect(compareSyncCursor(progress.lastCursor, currentWindow!.after)).toBeGreaterThanOrEqual(0);
            }
        }

        if (message.body.type === 'ops_push' && deliveredWriteSequences.has(message.sequence)) {
            const receiver = message.direction === 'a-to-b' ? knownB : knownA;
            for (const operation of message.body.data ?? []) {
                receiver.add(operationCursor(operation).id);
            }
        }
    }

    for (const open of opens) {
        const responseDirection = open.direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
        expect(messages.some(message => (
            message.direction === responseDirection
            && message.body.sessionId === open.body.sessionId
            && message.body.windowId === open.body.windowId
            && (message.body.type === 'neg_msg' || message.body.type === 'neg_close')
        ))).toBe(true);
    }

    let observedLocalOnlyContinuation = false;
    for (let index = 1; index < opens.length; index += 1) {
        const previous = opens[index - 1].body.window!;
        const next = opens[index].body.window!;
        expect(next.name).toBe(previous.name);
        expect(next.fromTs).toBe(previous.fromTs);
        expect(next.toTs).toBe(previous.toTs);

        if (next.order === previous.order) {
            expect(sameCursor(next.after, previous.after)).toBe(true);
            expect(next.maxRecords).toBeLessThan(previous.maxRecords);
            continue;
        }

        expect(next.order).toBe(previous.order + 1);
        expect(next.maxRecords).toBe(previous.maxRecords);
        expect(next.after).toBeDefined();
        if (previous.after) {
            expect(compareSyncCursor(next.after!, previous.after)).toBeGreaterThan(0);
        }

        const previousWindowId = opens[index - 1].body.windowId;
        const observedCursors = messages.flatMap(message => {
            if (message.sequence >= opens[index].sequence
                || message.body.windowId !== previousWindowId
                || !deliveredWriteSequences.has(message.sequence)) {
                return [];
            }
            const progressCursor = message.body.windowProgress?.lastCursor;
            const pushedCursors = message.body.type === 'ops_push'
                ? (message.body.data ?? []).map(operationCursor)
                : [];
            return [...(progressCursor ? [progressCursor] : []), ...pushedCursors];
        });
        expect(observedCursors.length).toBeGreaterThan(0);
        const matchesObservedCursor = observedCursors.some(cursor => sameCursor(cursor, next.after));
        const matchesLocalCursor = sameCursor(
            initiatorSnapshotCursors.get(previousWindowId!),
            next.after,
        );
        expect(matchesObservedCursor || matchesLocalCursor).toBe(true);
        observedLocalOnlyContinuation ||= !matchesObservedCursor && matchesLocalCursor;
    }
    if (knowledge.expectLocalOnlyContinuation) {
        expect(observedLocalOnlyContinuation).toBe(true);
    }

    return messages;
}

function assertNoOperationTransfer(link: RecordingDuplexPair): void {
    const messages = decodeWire(link);
    expect(messages.filter(message => message.body.type === 'ops_req').flatMap(message => message.body.ids ?? [])).toEqual([]);
    expect(messages.filter(message => message.body.type === 'ops_push').flatMap(message => message.body.data ?? [])).toEqual([]);
}

async function assertConverged(
    currentDriver: Awaited<ReturnType<typeof createMediatorDriver>>,
    operations: Operation[],
): Promise<void> {
    const expectedIds = operationIds(operations);
    const expectedCursorIds = cursorOrderedIds(operations);
    expect(await gatekeeperIds(currentDriver.nodeA.gatekeeper)).toStrictEqual(expectedIds);
    expect(await gatekeeperIds(currentDriver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
    expect((await currentDriver.storeA.iterateSorted({ limit: Number.MAX_SAFE_INTEGER })).map(row => row.id))
        .toStrictEqual(expectedCursorIds);
    expect((await currentDriver.storeB.iterateSorted({ limit: Number.MAX_SAFE_INTEGER })).map(row => row.id))
        .toStrictEqual(expectedCursorIds);
    expect(currentDriver.transport.pendingCount).toBe(0);
}

async function createIndependentOperations(timestamps: number[]): Promise<Operation[]> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-mediator-convergence-fixtures'),
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const operations: Operation[] = [];
    for (const timestamp of timestamps) {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk(), {
            version: 1,
            registry: 'hyperswarm',
        });
        setSignedTime(operation, timestamp);
        operations.push(operation);
    }
    await gatekeeper.resetDb();
    return operations;
}

async function createConvergenceScenario(name: ScenarioName): Promise<ConvergenceScenario> {
    const baseTime = Date.now() - (60 * 60 * 1_000);
    if (name === 'identical') {
        const operations = await createIndependentOperations([baseTime, baseTime + 1_000, baseTime + 2_000]);
        return { operationsA: operations, operationsB: operations, maxRecordsPerWindow: 8, expectContinuation: false };
    }
    if (name === 'partial overlap') {
        const operations = await createIndependentOperations([baseTime, baseTime + 1_000, baseTime + 2_000, baseTime + 3_000]);
        return { operationsA: operations.slice(0, 3), operationsB: [operations[0], operations[1], operations[3]], maxRecordsPerWindow: 8, expectContinuation: false };
    }
    if (name === 'fully disjoint') {
        const operations = await createIndependentOperations([baseTime, baseTime + 1_000, baseTime + 2_000, baseTime + 3_000]);
        return { operationsA: operations.slice(0, 2), operationsB: operations.slice(2), maxRecordsPerWindow: 8, expectContinuation: false };
    }
    if (name === 'interleaved capped pages') {
        const operations = await createIndependentOperations(Array.from({ length: 16 }, (_value, index) => baseTime + (index * 1_000)));
        return {
            operationsA: [...operations.filter((_operation, index) => index % 2 === 0), operations[11]],
            operationsB: operations.filter((_operation, index) => index % 2 === 1),
            maxRecordsPerWindow: 3,
            expectContinuation: true,
        };
    }
    if (name === 'same-second exact cap') {
        const operations = (await createIndependentOperations(Array(4).fill(baseTime))).sort((left, right) => (
            operationCursor(left).id.localeCompare(operationCursor(right).id)
        ));
        return { operationsA: operations, operationsB: [operations[1], operations[3]], maxRecordsPerWindow: 4, expectContinuation: false };
    }
    if (name === 'same-second cap-plus-one') {
        const operations = (await createIndependentOperations(Array(5).fill(baseTime))).sort((left, right) => (
            operationCursor(left).id.localeCompare(operationCursor(right).id)
        ));
        return {
            operationsA: operations,
            operationsB: [operations[0], operations[2], operations[4]],
            maxRecordsPerWindow: 4,
            expectContinuation: true,
            knownOutsideId: operationCursor(operations[4]).id,
        };
    }
    if (name === 'local-only continuation cursor') {
        const operations = (await createIndependentOperations(Array(5).fill(baseTime))).sort((left, right) => (
            operationCursor(left).id.localeCompare(operationCursor(right).id)
        ));
        return {
            operationsA: operations,
            operationsB: operations.slice(3),
            maxRecordsPerWindow: 4,
            expectContinuation: true,
        };
    }

    const operations = await createIndependentOperations(Array.from({ length: 7 }, (_value, index) => baseTime + (index * 1_000)));
    return {
        operationsA: operations.slice(5),
        operationsB: operations.slice(0, 5),
        maxRecordsPerWindow: 3,
        expectContinuation: true,
    };
}

function importedOperationIds(node: Awaited<ReturnType<typeof createMediatorDriver>>['nodeA']): string[] {
    const calls = node.gatekeeperClient.importBatch.mock.calls as unknown as Array<[GatekeeperEvent[]]>;
    return operationIds(calls.flatMap(([events]) => events.map(event => event.operation)));
}

async function waitForPersistedOperation(
    node: Awaited<ReturnType<typeof createMediatorDriver>>['nodeA'],
    store: Awaited<ReturnType<typeof createMediatorDriver>>['storeA'],
    id: string,
): Promise<void> {
    for (let turn = 0; turn < 100; turn += 1) {
        if ((await gatekeeperIds(node.gatekeeper)).includes(id) && await store.has(id)) {
            return;
        }
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error(`operation ${id} was not persisted within 100 event-loop turns`);
}

async function pumpUntilPendingMessage(
    link: RecordingDuplexPair,
    direction: TransportDirection,
    messageType: string,
): Promise<void> {
    for (let delivery = 0; delivery < 200; delivery += 1) {
        const next = link.peekNext();
        if (next?.direction === direction && next.messageTypes.includes(messageType)) {
            return;
        }
        if (!await link.deliverNext()) {
            break;
        }
    }
    throw new Error(`no ${direction} ${messageType} became pending`);
}

describe('hyperswarm mediator behavior', () => {
    let driver: Awaited<ReturnType<typeof createMediatorDriver>> | null = null;

    afterEach(async () => {
        if (driver) {
            await driver.dispose();
            driver = null;
        }
    });

    it.each([
        ['node A initiates', 0x11, 0x22],
        ['node B initiates', 0x22, 0x11],
    ])('reconciles two real mediator nodes over framed in-memory transport when %s', async (
        _scenario,
        publicKeyByteA,
        publicKeyByteB,
    ) => {
        const fixtures = await createOperationFixtures();
        const operationsA = [fixtures.controllerCreate, fixtures.controllerUpdate];
        const operationsB = [fixtures.independentCreate];
        const expectedIds = operationIds([...operationsA, ...operationsB]);
        const publicKeyA = Buffer.alloc(32, publicKeyByteA);
        const publicKeyB = Buffer.alloc(32, publicKeyByteB);
        const expectedOpenDirection = publicKeyA.compare(publicKeyB) < 0 ? 'a-to-b' : 'b-to-a';
        driver = await createMediatorDriver({ operationsA, operationsB, publicKeyA, publicKeyB });

        await driver.startSync();
        const report = await driver.driveUntilQuiescent(expectedIds);
        expect(report.stableTurns).toBe(3);

        const protocolEntries = driver.transcript;
        expect(protocolEntries.length).toBeGreaterThan(0);
        expect(protocolEntries.every(entry => entry.framed)).toBe(true);

        const messageTypes = protocolEntries.map(entry => entry.messageType);
        expect(messageTypes).toEqual(expect.arrayContaining([
            'neg_open',
            'neg_msg',
            'ops_req',
            'ops_push',
            'neg_close',
        ]));
        expect(messageTypes).not.toContain('sync');
        expect(messageTypes).not.toContain('batch');

        const opens = protocolEntries.filter(entry => entry.messageType === 'neg_open');
        expect(opens).toHaveLength(1);
        expect(opens[0].direction).toBe(expectedOpenDirection);

        expect(await gatekeeperIds(driver.nodeA.gatekeeper)).toStrictEqual(expectedIds);
        expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
        expect((await driver.storeA.iterateSorted({ limit: 100 })).map(row => row.id).sort()).toStrictEqual(expectedIds);
        expect((await driver.storeB.iterateSorted({ limit: 100 })).map(row => row.id).sort()).toStrictEqual(expectedIds);
        expect(driver.transport.pendingCount).toBe(0);

        const peerKeyA = driver.nodeA.publicKey.toString('hex');
        const peerKeyB = driver.nodeB.publicKey.toString('hex');
        expect(driver.nodeA.run(
            () => driver!.nodeA.mediator.__test.getConnectionState(peerKeyB)?.activeSession,
        )).toBeNull();
        expect(driver.nodeB.run(
            () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA)?.activeSession,
        )).toBeNull();
    });

    describe.each([
        ['node A initiates', 0x11, 0x22],
        ['node B initiates', 0x22, 0x11],
    ])('Negentropy convergence when %s', (_keyOrder, publicKeyByteA, publicKeyByteB) => {
        it.each<ScenarioName>([
            'identical',
            'partial overlap',
            'fully disjoint',
            'interleaved capped pages',
            'same-second exact cap',
            'same-second cap-plus-one',
            'local-only continuation cursor',
            'peer-only older history',
        ])('self-heals %s stores and repeats with zero transfer', async scenarioName => {
            const scenario = await createConvergenceScenario(scenarioName);
            const union = [...scenario.operationsA, ...scenario.operationsB];
            const expectedIds = operationIds(union);
            const publicKeyA = Buffer.alloc(32, publicKeyByteA);
            const publicKeyB = Buffer.alloc(32, publicKeyByteB);
            driver = await createMediatorDriver({
                ...scenario,
                publicKeyA,
                publicKeyB,
            });

            await driver.startSync();
            await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 10_000 });

            const firstLink = driver.transport;
            const firstMessages = assertWindowProtocol(firstLink, {
                operationsA: scenario.operationsA,
                operationsB: scenario.operationsB,
                expectedOperations: union,
                expectLocalOnlyContinuation: scenarioName === 'local-only continuation cursor'
                    && publicKeyA.compare(publicKeyB) < 0,
            });
            const opens = firstMessages.filter(message => message.body.type === 'neg_open');
            if (scenario.expectContinuation) {
                expect(opens.length).toBeGreaterThan(1);
            }
            if (scenarioName === 'interleaved capped pages') {
                expect(opens.length).toBeGreaterThanOrEqual(3);
            }
            if (scenarioName === 'same-second exact cap') {
                expect(opens).toHaveLength(1);
            }
            if (scenarioName === 'same-second cap-plus-one') {
                const aInitiates = publicKeyA.compare(publicKeyB) < 0;
                const responderDirection: TransportDirection = aInitiates ? 'b-to-a' : 'a-to-b';
                const responderProgress = firstMessages.flatMap(message => (
                    message.direction === responderDirection
                    && message.body.windowId === opens[0].body.windowId
                    && message.body.windowProgress
                        ? [message.body.windowProgress.cappedByRecords]
                        : []
                ));

                expect(responderProgress.length).toBeGreaterThan(0);
                expect(responderProgress.every(capped => capped === !aInitiates)).toBe(true);
            }
            if (scenarioName === 'identical') {
                assertNoOperationTransfer(firstLink);
            }
            if (scenario.knownOutsideId) {
                const pushedIds = firstMessages
                    .filter(message => message.body.type === 'ops_push')
                    .flatMap(message => message.body.data ?? [])
                    .map(operation => operationCursor(operation).id);
                expect(pushedIds).toContain(scenario.knownOutsideId);
                expect(importedOperationIds(driver.nodeA)).not.toContain(scenario.knownOutsideId);
            }
            await assertConverged(driver, union);

            await driver.reconnect();
            await driver.startSync();
            await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 10_000 });
            assertWindowProtocol(driver.transport, {
                operationsA: union,
                operationsB: union,
                expectedOperations: union,
            });
            assertNoOperationTransfer(driver.transport);
            await assertConverged(driver, union);
        });
    });

    it.each([
        ['node A initiates', 0x11, 0x22],
        ['node B initiates', 0x22, 0x11],
    ])('includes an operation arriving after stable snapshots in a later window when %s', async (
        _keyOrder,
        publicKeyByteA,
        publicKeyByteB,
    ) => {
        const baseTime = Date.now() - (60 * 60 * 1_000);
        const initial = await createIndependentOperations(Array.from({ length: 6 }, (_value, index) => (
            baseTime + (index * 1_000)
        )));
        const arriving = (await createIndependentOperations([baseTime + 10_000]))[0];
        const arrivingId = operationCursor(arriving).id;
        const operationsA = initial.filter((_operation, index) => index % 2 === 0);
        const operationsB = initial.filter((_operation, index) => index % 2 === 1);
        const union = [...initial, arriving];
        const expectedIds = operationIds(union);
        const publicKeyA = Buffer.alloc(32, publicKeyByteA);
        const publicKeyB = Buffer.alloc(32, publicKeyByteB);
        const openDirection: TransportDirection = publicKeyA.compare(publicKeyB) < 0 ? 'a-to-b' : 'b-to-a';
        driver = await createMediatorDriver({
            operationsA,
            operationsB,
            publicKeyA,
            publicKeyB,
            maxRecordsPerWindow: 2,
        });

        await driver.startSync();
        expect(await driver.transport.pumpUntil({ afterMessageType: 'neg_open' })).toBe(true);
        const messagesAfterOpen = decodeWire(driver.transport);
        const initialOpen = messagesAfterOpen.find(message => message.body.type === 'neg_open')!;
        const targetNode = openDirection === 'a-to-b' ? driver.nodeA : driver.nodeB;
        const targetStore = openDirection === 'a-to-b' ? driver.storeA : driver.storeB;
        const sourceKey = openDirection === 'a-to-b'
            ? driver.nodeB.publicKey.toString('hex')
            : driver.nodeA.publicKey.toString('hex');
        const framedQueue = encodeFramedMessage(JSON.stringify({
            type: 'queue',
            time: new Date().toISOString(),
            node: 'fixture-source',
            relays: [],
            data: [arriving],
        }));
        await targetNode.run(() => targetNode.mediator.__test.processInboundPeerData(sourceKey, framedQueue));
        await waitForPersistedOperation(targetNode, targetStore, arrivingId);

        await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 10_000 });
        const messages = assertWindowProtocol(driver.transport, {
            operationsA: openDirection === 'a-to-b' ? [...operationsA, arriving] : operationsA,
            operationsB: openDirection === 'b-to-a' ? [...operationsB, arriving] : operationsB,
            expectedOperations: union,
        });
        const pushesWithArrival = messages.filter(message => (
            message.body.type === 'ops_push'
            && (message.body.data ?? []).some(operation => operationCursor(operation).id === arrivingId)
        ));
        expect(pushesWithArrival.length).toBeGreaterThan(0);
        expect(pushesWithArrival.every(message => message.body.windowId !== initialOpen.body.windowId)).toBe(true);
        await assertConverged(driver, union);

        await driver.reconnect();
        await driver.startSync();
        await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 10_000 });
        assertWindowProtocol(driver.transport, {
            operationsA: union,
            operationsB: union,
            expectedOperations: union,
        });
        assertNoOperationTransfer(driver.transport);
    });

    it.each([
        ['node A initiates', 0x11, 0x22],
        ['node B initiates', 0x22, 0x11],
    ])('splits round-capped windows and still converges when %s', async (
        _keyOrder,
        publicKeyByteA,
        publicKeyByteB,
    ) => {
        const baseTime = Date.now() - (60 * 60 * 1_000);
        const operations = await createIndependentOperations(Array.from({ length: 128 }, (_value, index) => (
            baseTime + (index * 1_000)
        )));
        const operationsA = operations.slice(0, 96);
        const operationsB = operations.slice(32);
        const expectedIds = operationIds(operations);
        driver = await createMediatorDriver({
            operationsA,
            operationsB,
            publicKeyA: Buffer.alloc(32, publicKeyByteA),
            publicKeyB: Buffer.alloc(32, publicKeyByteB),
            maxRecordsPerWindow: 128,
            maxRoundsPerSession: 1,
            frameSizeLimit: 4096,
        });

        await driver.startSync();
        await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 30_000 });
        const messages = assertWindowProtocol(driver.transport, {
            operationsA,
            operationsB,
            expectedOperations: operations,
        });
        const windows = messages
            .filter(message => message.body.type === 'neg_open')
            .map(message => message.body.window!);
        const splitObserved = windows.some((window, index) => {
            const previous = windows[index - 1];
            return previous
                && window.order === previous.order
                && sameCursor(window.after, previous.after)
                && window.maxRecords < previous.maxRecords;
        });
        if (!splitObserved) {
            throw new Error(`round-cap split not observed: ${JSON.stringify(windows)}`);
        }
        await assertConverged(driver, operations);

        await driver.reconnect();
        await driver.startSync();
        await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 10_000 });
        assertWindowProtocol(driver.transport, {
            operationsA: operations,
            operationsB: operations,
            expectedOperations: operations,
        });
        assertNoOperationTransfer(driver.transport);
    });

    it.each([
        ['node A initiates', 0x11, 0x22],
        ['node B initiates', 0x22, 0x11],
    ])('repairs a dropped transfer after reconnect when %s', async (
        _keyOrder,
        publicKeyByteA,
        publicKeyByteB,
    ) => {
        const baseTime = Date.now() - (60 * 60 * 1_000);
        const operations = await createIndependentOperations([baseTime, baseTime + 1_000]);
        const operationsA = [operations[0]];
        const operationsB = [operations[1]];
        const unionIds = operationIds(operations);
        const publicKeyA = Buffer.alloc(32, publicKeyByteA);
        const publicKeyB = Buffer.alloc(32, publicKeyByteB);
        const initiatorIsA = publicKeyA.compare(publicKeyB) < 0;
        const droppedDirection: TransportDirection = initiatorIsA ? 'a-to-b' : 'b-to-a';
        driver = await createMediatorDriver({ operationsA, operationsB, publicKeyA, publicKeyB });

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, droppedDirection, 'ops_push');
        expect(driver.transport.dropNext()).toBe(true);
        await driver.disconnect();
        expect(driver.transport.connectionA.destroyed).toBe(true);
        expect(driver.transport.connectionB.destroyed).toBe(true);
        const expectedAfterDrop = {
            a: operationIds(operationsA),
            b: operationIds(operationsB),
        };
        await driver.driveUntilQuiescent(expectedAfterDrop, { timeoutMs: 10_000 });
        const peerKeyA = driver.nodeA.publicKey.toString('hex');
        const peerKeyB = driver.nodeB.publicKey.toString('hex');
        expect(driver.nodeA.run(
            () => driver!.nodeA.mediator.__test.getConnectionState(peerKeyB),
        )).toBeNull();
        expect(driver.nodeB.run(
            () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA),
        )).toBeNull();

        await driver.reconnect();
        await driver.startSync('periodic');
        await driver.driveUntilQuiescent(unionIds, { timeoutMs: 10_000 });
        const repairMessages = assertWindowProtocol(driver.transport, {
            operationsA,
            operationsB,
            expectedOperations: operations,
        });
        expect(repairMessages.some(message => message.body.type === 'ops_push')).toBe(true);
        await assertConverged(driver, operations);

        await driver.reconnect();
        await driver.startSync();
        await driver.driveUntilQuiescent(unionIds, { timeoutMs: 10_000 });
        assertWindowProtocol(driver.transport, {
            operationsA: operations,
            operationsB: operations,
            expectedOperations: operations,
        });
        assertNoOperationTransfer(driver.transport);
    });

    it('closes mediator state and drains writes created while blocked inbound work settles', async () => {
        const operationsB = await createIndependentOperations([Date.now() - (60 * 60 * 1_000)]);
        const expectedB = operationIds(operationsB);
        driver = await createMediatorDriver({ operationsA: [], operationsB });
        const getByIds = jest.mocked(driver.storeB.getByIds);
        const getByIdsImplementation = getByIds.getMockImplementation();
        if (!getByIdsImplementation) {
            throw new Error('tracked node B getByIds implementation is unavailable');
        }
        let markLookupStarted!: () => void;
        const lookupStarted = new Promise<void>(resolve => {
            markLookupStarted = resolve;
        });
        let releaseLookup!: () => void;
        const lookupBlocked = new Promise<void>(resolve => {
            releaseLookup = resolve;
        });
        const lateWrite = encodeFramedMessage(JSON.stringify({ type: 'late_test_write' }));
        let lateWriteSequence!: number;
        getByIds.mockImplementationOnce(async ids => {
            markLookupStarted();
            await lookupBlocked;
            driver!.transport.connectionB.write(lateWrite);
            lateWriteSequence = driver!.transport.transcript.at(-1)!.sequence;
            return getByIdsImplementation(ids);
        });

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_req');
        const delivery = driver.transport.deliverNext();
        await lookupStarted;
        const writesAtDisconnect = driver.transport.transcript.length;
        const disconnect = driver.disconnect();
        const peerKeyA = driver.nodeA.publicKey.toString('hex');
        const peerKeyB = driver.nodeB.publicKey.toString('hex');
        const stateAAfterDisconnect = driver.nodeA.run(
            () => driver!.nodeA.mediator.__test.getConnectionState(peerKeyB),
        );
        const stateBAfterDisconnect = driver.nodeB.run(
            () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA),
        );

        releaseLookup();
        await Promise.all([delivery, disconnect]);

        expect(stateAAfterDisconnect).toBeNull();
        expect(stateBAfterDisconnect).toBeNull();
        expect(driver.transport.transcript).toHaveLength(writesAtDisconnect + 1);
        expect(driver.transport.deliveries).toContainEqual(expect.objectContaining({
            action: 'dropped',
            writeSequences: [lateWriteSequence],
        }));
        expect(driver.transport.pendingCount).toBe(0);
        expect(driver.transport.connectionA.destroyed).toBe(true);
        expect(driver.transport.connectionB.destroyed).toBe(true);
        await driver.driveUntilQuiescent({ a: [], b: expectedB });
    });

    it('waits for a deferred import to settle after disconnect without producing more traffic', async () => {
        const operationsA = await createIndependentOperations([Date.now() - (60 * 60 * 1_000)]);
        const expectedIds = operationIds(operationsA);
        driver = await createMediatorDriver({ operationsA, operationsB: [] });
        const deferred = driver.deferNextClientCall({
            node: 'b',
            client: 'gatekeeper',
            method: 'importBatch',
            label: 'node B import during disconnect',
        });

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        await driver.transport.deliverNext();
        await deferred.started;
        let wasSettledAtDisconnect!: boolean;
        let writesAfterDisconnect!: number;
        try {
            await driver.disconnect();
            wasSettledAtDisconnect = deferred.settled;
            writesAfterDisconnect = driver.transport.transcript.length;
        }
        finally {
            deferred.resolve();
        }
        await driver.driveUntilQuiescent(expectedIds);

        expect(wasSettledAtDisconnect).toBe(false);
        expect(deferred.settled).toBe(true);
        expect(driver.transport.transcript).toHaveLength(writesAfterDisconnect);
        expect(driver.transport.pendingCount).toBe(0);
        expect(driver.transport.connectionA.destroyed).toBe(true);
        expect(driver.transport.connectionB.destroyed).toBe(true);
    });

    it('negotiates raw initial pings before switching to framed protocol traffic', async () => {
        const fixtures = await createOperationFixtures();
        const operationsA = [fixtures.controllerCreate, fixtures.controllerUpdate];
        const operationsB = [fixtures.independentCreate];
        const expectedIds = operationIds([...operationsA, ...operationsB]);
        driver = await createMediatorDriver({
            operationsA,
            operationsB,
            connectionMode: 'unknown',
        });

        await driver.startSync();
        await driver.driveUntilQuiescent(expectedIds);

        const pings = driver.transcript.filter(entry => entry.messageType === 'ping');
        expect(pings).toHaveLength(2);
        expect(pings.map(entry => entry.direction)).toStrictEqual(['a-to-b', 'b-to-a']);
        expect(pings.every(entry => entry.transportMode === 'legacy')).toBe(true);

        const protocolEntries = driver.transcript.filter(entry => entry.messageType !== 'ping');
        expect(protocolEntries.length).toBeGreaterThan(0);
        expect(protocolEntries.every(entry => entry.transportMode === 'framed')).toBe(true);

        const peerKeyA = driver.nodeA.publicKey.toString('hex');
        const peerKeyB = driver.nodeB.publicKey.toString('hex');
        const stateA = driver.nodeA.run(
            () => driver!.nodeA.mediator.__test.getConnectionState(peerKeyB),
        );
        const stateB = driver.nodeB.run(
            () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA),
        );
        expect(stateA).toMatchObject({
            transportMode: 'framed',
            inboundTransportMode: 'framed',
        });
        expect(stateB).toMatchObject({
            transportMode: 'framed',
            inboundTransportMode: 'framed',
        });
    });

    it('waits for deferred client work and reports observable state on bounded failure', async () => {
        const fixtures = await createOperationFixtures();
        const operationsA = [fixtures.controllerCreate, fixtures.controllerUpdate];
        const operationsB = [fixtures.independentCreate];
        const expectedIds = operationIds([...operationsA, ...operationsB]);
        driver = await createMediatorDriver({ operationsA, operationsB });
        const deferred = driver.deferNextClientCall({
            node: 'b',
            client: 'gatekeeper',
            method: 'importBatch',
            label: 'delayed node-b import',
        });

        await driver.startSync();
        let releaseDelivery!: () => void;
        const deliveryBlock = new Promise<void>(resolve => {
            releaseDelivery = resolve;
        });
        let finishDelivery!: () => void;
        const deliveryFinished = new Promise<void>(resolve => {
            finishDelivery = resolve;
        });
        const deliverNextSpy = jest.spyOn(driver.transport, 'deliverNext').mockImplementationOnce(async () => {
            try {
                await deliveryBlock;
                return false;
            }
            finally {
                finishDelivery();
            }
        });
        const wallClockError = await driver.driveUntilQuiescent(expectedIds, {
            maxIterations: 2_000,
            timeoutMs: 100,
        }).then(
            () => null,
            error => error as Error,
        );
        releaseDelivery();
        await deliveryFinished;
        deliverNextSpy.mockRestore();
        expect(wallClockError).toBeInstanceOf(Error);
        expect(wallClockError!.message).toContain('"guardReason":"wall_clock_timeout"');
        expect(wallClockError!.message).toContain('"linkState"');
        expect(wallClockError!.message).toContain('"nodeA"');
        expect(wallClockError!.message).toContain('"nodeB"');

        const attempt = driver.driveUntilQuiescent(expectedIds, {
            maxIterations: 100,
            timeoutMs: 1_000,
        }).then(
            () => null,
            error => error as Error,
        );
        await deferred.started;
        const error = await attempt;

        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toContain('"guardReason":"iteration_limit"');
        expect(error!.message).toContain('"label":"b.gatekeeper.importBatch"');
        expect(error!.message).toContain('"unsettledDeferrals":["delayed node-b import"]');
        expect(error!.message).toContain('"linkState"');
        expect(error!.message).toContain('"nodeA"');
        expect(error!.message).toContain('"recentMessages"');
        expect(deferred.settled).toBe(false);

        deferred.resolve();
        const report = await driver.driveUntilQuiescent(expectedIds);
        expect(report.stableTurns).toBe(3);
        expect(deferred.settled).toBe(true);
    });
});
