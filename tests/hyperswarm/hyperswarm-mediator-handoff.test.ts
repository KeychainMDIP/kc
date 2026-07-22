import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import { jest } from '@jest/globals';

import { HYPR_INDEX_SYNC_STATE_KEYS } from '../../services/mediators/hyperswarm/src/bootstrap.ts';
import { mapAcceptedOperationsToSyncRecords } from '../../services/mediators/hyperswarm/src/sync-persistence.ts';
import { normalizePeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import {
    decodeUnknownTransportMessages,
    encodeFramedMessage,
} from '../../services/mediators/hyperswarm/src/transport-framing.ts';
import TestHelper from '../gatekeeper/helper.ts';
import { createMediatorDriver } from './hyperswarm-mediator-driver.ts';
import { installMediatorMocks } from './hyperswarm-mediator-harness.ts';
import {
    createRecordingDuplexPair,
    type RecordingDuplexPair,
    type TransportDirection,
} from './recording-duplex.ts';

installMediatorMocks();

jest.setTimeout(60_000);

interface WireMessage {
    sequence: number;
    direction: TransportDirection;
    body: {
        type: string;
        reason?: string;
        sessionId?: string;
        windowId?: string;
        round?: number;
        ids?: string[];
        data?: Operation[];
    };
}

function operationId(operation: Operation): string {
    return operation.signature!.hash.toLowerCase();
}

function operationIds(operations: Operation[]): string[] {
    return Array.from(new Set(operations.map(operationId))).sort();
}

function syncOrders(operations: Operation[]): ReadonlyMap<string, number> {
    return new Map(operations.map((operation, index) => [operationId(operation), index + 1]));
}

function decodeWire(link: RecordingDuplexPair): WireMessage[] {
    return link.transcript.flatMap(entry => {
        const decoded = decodeUnknownTransportMessages(entry.raw);
        if (decoded.error || decoded.remaining.length > 0) {
            throw new Error(`failed to decode wire write ${entry.sequence}`);
        }
        return decoded.messages.map(message => ({
            sequence: entry.sequence,
            direction: entry.direction,
            body: JSON.parse(message.toString('utf8')) as WireMessage['body'],
        }));
    });
}

function writeOperationPush(
    link: RecordingDuplexPair,
    base: WireMessage['body'],
    operation: Operation,
): void {
    link.connectionA.write(encodeFramedMessage(JSON.stringify({
        ...base,
        data: [operation],
    })));
}

function assertCompletedNegentropyExchange(messages: WireMessage[]): void {
    const finalOpen = messages.filter(message => message.body.type === 'neg_open').at(-1);
    if (!finalOpen) {
        throw new Error('completed Negentropy exchange has no neg_open');
    }
    expect(finalOpen.body).toMatchObject({
        sessionId: expect.any(String),
        windowId: expect.any(String),
    });
    const finalMessage = messages.filter(message => (
        ['neg_open', 'neg_msg', 'ops_req', 'ops_push', 'neg_close'].includes(message.body.type)
    )).at(-1);

    expect(finalMessage).toMatchObject({
        direction: finalOpen.direction,
        body: {
            type: 'neg_close',
            reason: 'complete',
            sessionId: finalOpen.body.sessionId,
            windowId: finalOpen.body.windowId,
        },
    });
    expect(finalMessage!.sequence).toBeGreaterThan(finalOpen.sequence);
}

async function gatekeeperIds(gatekeeper: Gatekeeper): Promise<string[]> {
    return operationIds((await gatekeeper.exportBatch()).map(event => event.operation));
}

async function nextTurn(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

async function eventually(assertion: () => boolean | Promise<boolean>, turns = 200): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) {
        if (await assertion()) {
            return;
        }
        await nextTurn();
    }
    throw new Error(`observable mediator condition did not settle after ${turns} turns`);
}

async function pumpUntilPendingMessage(
    link: RecordingDuplexPair,
    direction: TransportDirection,
    messageType: string,
): Promise<void> {
    for (let delivery = 0; delivery < 500; delivery += 1) {
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

async function createIndependentOperations(count: number, registry = 'hyperswarm'): Promise<Operation[]> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-handoff-independent-fixtures'),
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: Array.from(new Set(['hyperswarm', registry])),
    });
    const cipher = new CipherNode();
    const helper = new TestHelper(gatekeeper, cipher);
    const operations: Operation[] = [];
    const baseTime = Date.now() - (60 * 60 * 1_000);

    for (let index = 0; index < count; index += 1) {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk(), {
            version: 1,
            registry,
        });
        operation.signature!.signed = new Date(baseTime + (index * 1_000)).toISOString();
        operations.push(operation);
    }
    await gatekeeper.resetDb();
    return operations;
}

async function createControllerAsset(): Promise<[Operation, Operation]> {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('hyperswarm-handoff-dependency-fixtures'),
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
    await gatekeeper.createDID(asset);
    await gatekeeper.resetDb();
    return [controller, asset];
}

describe('hyperswarm mediator Gatekeeper acceptance and ordered handoff', () => {
    let driver: Awaited<ReturnType<typeof createMediatorDriver>> | null = null;

    afterEach(async () => {
        if (driver) {
            await driver.dispose();
            driver = null;
        }
        jest.restoreAllMocks();
    });

    it.each(['importBatch', 'processEvents'] as const)(
        'does not complete Negentropy while Gatekeeper.%s is unsettled',
        async method => {
            const operations = await createIndependentOperations(1);
            const expectedIds = operationIds(operations);
            driver = await createMediatorDriver({
                operationsA: operations,
                operationsB: [],
                publicKeyA: Buffer.alloc(32, 0x22),
                publicKeyB: Buffer.alloc(32, 0x11),
            });
            const deferred = driver.deferNextClientCall({
                node: 'b',
                client: 'gatekeeper',
                method,
                label: `node B ${method} during Negentropy`,
            });

            await driver.startSync();
            await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
            const delivery = driver.transport.deliverNext();
            await deferred.started;
            await nextTurn();
            await nextTurn();
            const closesWhileBlocked = decodeWire(driver.transport).filter(message => (
                message.body.type === 'neg_close' && message.body.reason === 'complete'
            ));
            const persistedWhileBlocked = await driver.storeB.count();

            deferred.resolve();
            await delivery;
            await driver.driveUntilQuiescent(expectedIds);

            expect(closesWhileBlocked).toHaveLength(0);
            expect(persistedWhileBlocked).toBe(0);
            expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
            expect(await driver.storeB.count()).toBe(expectedIds.length);
            expect(decodeWire(driver.transport).some(message => (
                message.body.type === 'neg_close' && message.body.reason === 'complete'
            ))).toBe(true);
        },
    );

    it('does not let an old deferred persistence finalize a replacement session', async () => {
        const operations = await createIndependentOperations(1);
        const expectedIds = operationIds(operations);
        driver = await createMediatorDriver({
            operationsA: operations,
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        const upsertMany = jest.mocked(driver.storeB.upsertMany);
        const upsertManyImplementation = upsertMany.getMockImplementation();
        if (!upsertManyImplementation) {
            throw new Error('tracked node B upsertMany implementation is unavailable');
        }
        let markPersistenceStarted!: () => void;
        const persistenceStarted = new Promise<void>(resolve => {
            markPersistenceStarted = resolve;
        });
        let releasePersistence!: () => void;
        const persistenceBlocked = new Promise<void>(resolve => {
            releasePersistence = resolve;
        });
        upsertMany.mockImplementationOnce(async records => {
            markPersistenceStarted();
            await persistenceBlocked;
            return upsertManyImplementation(records);
        });
        const peerKeyA = driver.nodeA.publicKey.toString('hex');
        let delivery: Promise<boolean> | null = null;
        let replacement: RecordingDuplexPair | null = null;
        let syncStarted = false;
        let oldSessionId: unknown;
        let replacementSessionId: unknown;
        let stateAfterPersistence: Record<string, unknown> | null = null;
        let replacementMessages: WireMessage[] = [];

        try {
            await driver.startSync();
            syncStarted = true;
            await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
            delivery = driver.transport.deliverNext();
            await persistenceStarted;
            oldSessionId = (driver.nodeB.run(
                () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA),
            )?.activeSession as { sessionId?: unknown } | null)?.sessionId;

            driver.nodeB.run(() => driver!.nodeB.mediator.__test.disconnectPeer(peerKeyA));
            replacement = createRecordingDuplexPair({
                publicKeyA: driver.nodeB.publicKey,
                publicKeyB: driver.nodeA.publicKey,
                receiveAtA: async () => undefined,
                receiveAtB: async () => undefined,
            });
            driver.nodeB.run(() => driver!.nodeB.mediator.__test.addConnection(peerKeyA, {
                connection: replacement!.connectionA,
                capabilities: normalizePeerCapabilities({
                    negentropy: true,
                    negentropyVersion: 1,
                    orderedCatchup: false,
                }),
                transportMode: 'framed',
                inboundTransportMode: 'framed',
                peerTransportFramingVersion: 1,
            }));
            await driver.nodeB.run(
                () => driver!.nodeB.mediator.__test.maybeStartPeerSync(peerKeyA, 'connect'),
            );
            expect(driver.nodeB.run(
                () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA),
            )?.activeSession).toBeNull();
            expect(decodeWire(replacement)).toHaveLength(0);

            releasePersistence();
            await delivery;
            await driver.nodeB.run(
                () => driver!.nodeB.mediator.__test.maybeStartPeerSync(peerKeyA, 'periodic'),
            );
            replacementSessionId = (driver.nodeB.run(
                () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA),
            )?.activeSession as { sessionId?: unknown } | null)?.sessionId;
            stateAfterPersistence = driver.nodeB.run(
                () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA),
            );
            replacementMessages = decodeWire(replacement);
        }
        finally {
            releasePersistence();
            await delivery?.catch(() => undefined);
            if (syncStarted) {
                await driver.disconnect().catch(() => undefined);
                await driver.driveUntilQuiescent(expectedIds).catch(() => undefined);
            }
            await replacement?.destroy();
        }

        expect(typeof oldSessionId).toBe('string');
        expect(typeof replacementSessionId).toBe('string');
        expect(replacementSessionId).not.toBe(oldSessionId);
        expect(stateAfterPersistence?.activeSession).toEqual({
            mode: 'negentropy',
            sessionId: replacementSessionId,
        });
        expect(replacementMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({ body: expect.objectContaining({ type: 'neg_open' }) }),
        ]));
        expect(replacementMessages.some(message => message.body.sessionId === oldSessionId)).toBe(false);
    });

    it('waits for a later controller push to persist an earlier requested asset', async () => {
        const [controller, asset] = await createControllerAsset();
        const expectedIds = operationIds([controller, asset]);
        driver = await createMediatorDriver({
            operationsA: [controller, asset],
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        const originalPush = decodeWire(driver.transport).at(-1)!.body;
        expect(driver.transport.dropNext()).toBe(true);

        writeOperationPush(driver.transport, originalPush, asset);
        await driver.transport.deliverNext();
        await eventually(() => driver!.nodeB.gatekeeperClient.processEvents.mock.calls.length >= 1);
        expect(await driver.storeB.has(operationId(asset))).toBe(false);
        expect(decodeWire(driver.transport).some(message => message.body.type === 'neg_close')).toBe(false);

        writeOperationPush(driver.transport, originalPush, controller);
        await driver.transport.deliverNext();
        await driver.driveUntilQuiescent(expectedIds);

        expect(await driver.storeB.has(operationId(asset))).toBe(true);
        expect(await driver.storeB.has(operationId(controller))).toBe(true);
        expect(decodeWire(driver.transport).some(message => (
            message.body.type === 'neg_close' && message.body.reason === 'complete'
        ))).toBe(true);
    });

    it('rejects a requested invalid push without persisting or completing it', async () => {
        const [invalidOperation] = await createIndependentOperations(1);
        invalidOperation.signature!.value = 'invalid-signature';
        const invalidId = operationId(invalidOperation);
        const mapped = mapAcceptedOperationsToSyncRecords([invalidOperation]);
        expect(mapped.records).toHaveLength(1);

        driver = await createMediatorDriver({
            operationsA: [],
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        await driver.storeA.upsertMany(mapped.records);

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        await driver.transport.deliverNext();
        await eventually(() => driver!.nodeB.gatekeeperClient.processEvents.mock.calls.length > 0);

        expect(await driver.storeB.has(invalidId)).toBe(false);
        expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual([]);
        const successfulCloses = decodeWire(driver.transport).filter(message => (
            message.direction === 'b-to-a'
            && message.body.type === 'neg_close'
            && message.body.reason === 'complete'
        ));

        await driver.disconnect();
        await driver.storeA.reset();
        await driver.driveUntilQuiescent({ a: [], b: [] });
        expect(successfulCloses).toHaveLength(0);
    });

    it('retries an identical requested push after a transient import failure', async () => {
        const operations = await createIndependentOperations(1);
        const expectedIds = operationIds(operations);
        driver = await createMediatorDriver({
            operationsA: operations,
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        driver.nodeB.gatekeeperClient.importBatch.mockRejectedValueOnce(new Error('transient import failure'));

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        expect(await driver.transport.duplicateNext()).toBe(true);
        await driver.driveUntilQuiescent(expectedIds);

        expect(driver.nodeB.gatekeeperClient.importBatch).toHaveBeenCalledTimes(2);
        expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
        expect(await driver.storeB.count()).toBe(1);
        expect(decodeWire(driver.transport).some(message => (
            message.body.type === 'neg_close' && message.body.reason === 'complete'
        ))).toBe(true);
    });

    it.each(['unready', 'busy'] as const)(
        'retries an identical requested push when Gatekeeper is %s',
        async state => {
            const operations = await createIndependentOperations(1);
            const expectedIds = operationIds(operations);
            driver = await createMediatorDriver({
                operationsA: operations,
                operationsB: [],
                publicKeyA: Buffer.alloc(32, 0x22),
                publicKeyB: Buffer.alloc(32, 0x11),
            });
            if (state === 'unready') {
                driver.nodeB.gatekeeperClient.isReady.mockResolvedValueOnce(false);
            } else {
                driver.nodeB.gatekeeperClient.processEvents.mockResolvedValueOnce({ busy: true });
            }

            await driver.startSync();
            await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
            expect(await driver.transport.duplicateNext()).toBe(true);
            await driver.driveUntilQuiescent(expectedIds);

            expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
            expect(await driver.storeB.count()).toBe(1);
            expect(decodeWire(driver.transport).some(message => (
                message.body.type === 'neg_close' && message.body.reason === 'complete'
            ))).toBe(true);
        },
    );

    it('retains accepted operations across sync-store failures and completes on an identical retry', async () => {
        const operations = await createIndependentOperations(1);
        const expectedIds = operationIds(operations);
        driver = await createMediatorDriver({
            operationsA: operations,
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        const upsertMany = jest.mocked(driver.storeB.upsertMany);
        upsertMany
            .mockRejectedValueOnce(new Error('transient sync-store failure'))
            .mockRejectedValueOnce(new Error('transient sync-store failure'));

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        const push = driver.transport.peekNext();
        if (!push || push.direction !== 'a-to-b') {
            throw new Error('expected a pending A-to-B ops_push');
        }
        expect(driver.transport.dropNext()).toBe(true);

        for (let attempt = 0; attempt < 2; attempt += 1) {
            driver.transport.connectionA.write(push.raw);
            expect(await driver.transport.deliverNext()).toBe(true);
            expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
            expect(await driver.storeB.count()).toBe(0);
            expect(decodeWire(driver.transport).some(message => (
                message.body.type === 'neg_close' && message.body.reason === 'complete'
            ))).toBe(false);
        }

        driver.transport.connectionA.write(push.raw);
        expect(await driver.transport.deliverNext()).toBe(true);
        await driver.driveUntilQuiescent(expectedIds);

        expect(upsertMany).toHaveBeenCalledTimes(3);
        expect(driver.nodeB.gatekeeperClient.importBatch).toHaveBeenCalledTimes(3);
        const processResults = await Promise.all(
            driver.nodeB.gatekeeperClient.processEvents.mock.results.map(result => result.value),
        );
        expect(processResults[0]?.added).toBe(1);
        expect(processResults.slice(1).every(result => (result.added ?? 0) === 0)).toBe(true);
        expect(await driver.storeB.count()).toBe(1);
        expect(decodeWire(driver.transport).some(message => (
            message.body.type === 'neg_close' && message.body.reason === 'complete'
        ))).toBe(true);
    });

    it('retries only retained operations named by the current push', async () => {
        const operations = await createIndependentOperations(2);
        const expectedIds = operationIds(operations);
        driver = await createMediatorDriver({
            operationsA: operations,
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        const upsertMany = jest.mocked(driver.storeB.upsertMany);
        const upsertManyImplementation = upsertMany.getMockImplementation();
        if (!upsertManyImplementation) {
            throw new Error('tracked node B upsertMany implementation is unavailable');
        }
        const attempts: string[][] = [];
        upsertMany
            .mockImplementationOnce(async records => {
                attempts.push(records.map(record => record.id).sort());
                throw new Error('transient sync-store failure');
            })
            .mockImplementationOnce(async records => {
                attempts.push(records.map(record => record.id).sort());
                throw new Error('transient sync-store failure');
            })
            .mockImplementation(async records => {
                attempts.push(records.map(record => record.id).sort());
                return upsertManyImplementation(records);
            });

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        const originalPush = decodeWire(driver.transport).at(-1)!.body;
        expect(driver.transport.dropNext()).toBe(true);

        writeOperationPush(driver.transport, originalPush, operations[0]);
        expect(await driver.transport.deliverNext()).toBe(true);
        writeOperationPush(driver.transport, originalPush, operations[1]);
        expect(await driver.transport.deliverNext()).toBe(true);

        expect(attempts).toStrictEqual([[operationId(operations[0])], [operationId(operations[1])]]);
        expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
        expect(await driver.storeB.count()).toBe(0);

        writeOperationPush(driver.transport, originalPush, operations[0]);
        expect(await driver.transport.deliverNext()).toBe(true);
        expect(await driver.storeB.has(operationId(operations[0]))).toBe(true);
        expect(await driver.storeB.has(operationId(operations[1]))).toBe(false);

        writeOperationPush(driver.transport, originalPush, operations[1]);
        expect(await driver.transport.deliverNext()).toBe(true);
        await driver.driveUntilQuiescent(expectedIds);

        expect(attempts).toStrictEqual([
            [operationId(operations[0])],
            [operationId(operations[1])],
            [operationId(operations[0])],
            [operationId(operations[1])],
        ]);
    });

    it('clears retained accepted operations when the sync store is replaced', async () => {
        const operations = await createIndependentOperations(1);
        const expectedIds = operationIds(operations);
        driver = await createMediatorDriver({
            operationsA: operations,
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        const upsertMany = jest.mocked(driver.storeB.upsertMany);
        upsertMany.mockRejectedValueOnce(new Error('transient sync-store failure'));

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        const push = driver.transport.peekNext();
        if (!push || push.direction !== 'a-to-b') {
            throw new Error('expected a pending A-to-B ops_push');
        }
        expect(driver.transport.dropNext()).toBe(true);

        driver.transport.connectionA.write(push.raw);
        expect(await driver.transport.deliverNext()).toBe(true);
        expect(await driver.storeB.count()).toBe(0);

        driver.nodeB.run(() => driver!.nodeB.mediator.__test.setSyncStore(driver!.storeB));
        driver.transport.connectionA.write(push.raw);
        expect(await driver.transport.deliverNext()).toBe(true);

        expect(upsertMany).toHaveBeenCalledTimes(1);
        expect(await driver.storeB.count()).toBe(0);
        expect(decodeWire(driver.transport).some(message => (
            message.body.type === 'neg_close' && message.body.reason === 'complete'
        ))).toBe(false);

        await driver.storeB.upsertMany(mapAcceptedOperationsToSyncRecords(operations).records);
        driver.transport.connectionA.write(push.raw);
        expect(await driver.transport.deliverNext()).toBe(true);
        await driver.driveUntilQuiescent(expectedIds);
    });

    it('skips database and Gatekeeper work for a persisted duplicate push', async () => {
        const operations = await createIndependentOperations(2);
        const expectedIds = operationIds(operations);
        driver = await createMediatorDriver({
            operationsA: operations,
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        const originalPush = decodeWire(driver.transport).at(-1)!.body;
        expect(driver.transport.dropNext()).toBe(true);

        const getByIds = jest.mocked(driver.storeB.getByIds);
        const getByIdsCallsBeforeFirstPush = getByIds.mock.calls.length;
        writeOperationPush(driver.transport, originalPush, operations[0]);
        expect(await driver.transport.deliverNext()).toBe(true);
        expect(getByIds).toHaveBeenCalledTimes(getByIdsCallsBeforeFirstPush + 1);
        const getByIdsCalls = getByIds.mock.calls.length;
        const importBatchCalls = driver.nodeB.gatekeeperClient.importBatch.mock.calls.length;
        const processEventsCalls = driver.nodeB.gatekeeperClient.processEvents.mock.calls.length;
        expect(await driver.storeB.count()).toBe(1);
        expect(decodeWire(driver.transport).some(message => (
            message.body.type === 'neg_close' && message.body.reason === 'complete'
        ))).toBe(false);

        writeOperationPush(driver.transport, originalPush, operations[0]);
        expect(await driver.transport.deliverNext()).toBe(true);

        expect(getByIds).toHaveBeenCalledTimes(getByIdsCalls);
        expect(driver.nodeB.gatekeeperClient.importBatch).toHaveBeenCalledTimes(importBatchCalls);
        expect(driver.nodeB.gatekeeperClient.processEvents).toHaveBeenCalledTimes(processEventsCalls);
        expect(await driver.storeB.count()).toBe(1);

        writeOperationPush(driver.transport, originalPush, operations[1]);
        expect(await driver.transport.deliverNext()).toBe(true);
        await driver.driveUntilQuiescent(expectedIds);
    });

    it('backfills a merged operation once and ignores a duplicate delivery', async () => {
        const [operation] = await createIndependentOperations(1, 'TFTC');
        const id = operationId(operation);
        driver = await createMediatorDriver({
            operationsA: [],
            operationsB: [],
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        const nativeEvent: GatekeeperEvent = {
            registry: 'TFTC',
            time: operation.signature!.signed,
            ordinal: [Date.parse(operation.signature!.signed)],
            operation,
        };
        for (const node of [driver.nodeA, driver.nodeB]) {
            node.gatekeeper.supportedRegistries.push('TFTC');
            await node.gatekeeper.importBatch([nativeEvent]);
            await node.gatekeeper.processEvents();
        }
        const mapped = mapAcceptedOperationsToSyncRecords([operation]);
        await driver.storeA.upsertMany(mapped.records);
        expect(await driver.storeB.has(id)).toBe(false);

        await driver.startSync();
        await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ops_push');
        expect(await driver.transport.duplicateNext()).toBe(true);
        await driver.driveUntilQuiescent([id]);

        expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual([id]);
        expect(await driver.storeB.count()).toBe(1);
        expect(driver.nodeB.gatekeeperClient.importBatch).toHaveBeenCalledTimes(1);
        const processResults = await Promise.all(
            driver.nodeB.gatekeeperClient.processEvents.mock.results.map(result => result.value),
        );
        expect(processResults.some(result => (result.merged ?? 0) > 0)).toBe(true);
    });

    it.each([
        ['empty local store', 'empty', true],
        ['gap below threshold', 'below', false],
        ['gap at threshold', 'exact', true],
        ['unready peer', 'unready', false],
        ['peer not ahead', 'not-ahead', false],
    ] as const)('selects the expected initial mode for %s', async (_case, scenario, expectOrdered) => {
        const operations = await createIndependentOperations(6);
        let operationsA: Operation[];
        let operationsB: Operation[];
        let syncOrderByIdA: ReadonlyMap<string, number>;

        if (scenario === 'empty') {
            operationsA = operations.slice(0, 2);
            operationsB = [];
            syncOrderByIdA = syncOrders(operationsA);
        }
        else if (scenario === 'below') {
            operationsA = operations.slice(0, 5);
            operationsB = operations.slice(0, 2);
            syncOrderByIdA = syncOrders(operationsA);
        }
        else if (scenario === 'exact') {
            operationsA = operations.slice(0, 5);
            operationsB = operations.slice(0, 1);
            syncOrderByIdA = syncOrders(operationsA);
        }
        else if (scenario === 'unready') {
            operationsA = operations.slice(0, 5);
            operationsB = operations.slice(0, 1);
            syncOrderByIdA = syncOrders(operationsA.slice(0, 4));
        }
        else {
            operationsA = operations.slice(0, 2);
            operationsB = operations.slice(0, 2);
            syncOrderByIdA = syncOrders(operationsA);
        }

        const expectedIds = operationIds([...operationsA, ...operationsB]);
        driver = await createMediatorDriver({
            operationsA,
            operationsB,
            orderedCatchupEnabled: true,
            syncOrderByIdA,
            syncOrderByIdB: syncOrders(operationsB),
            maxRecordsPerWindow: 4,
            connectionMode: 'unknown',
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });

        await driver.startSync();
        await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 15_000 });

        const firstProtocolMessage = decodeWire(driver.transport)
            .find(message => message.body.type !== 'ping');
        expect(firstProtocolMessage?.body.type).toBe(expectOrdered ? 'ordered_catchup_req' : 'neg_open');
    });

    it('waits for a lagging higher-key peer to request ordered catch-up', async () => {
        const operationsA = await createIndependentOperations(5);
        const operationsB = operationsA.slice(0, 1);
        const expectedIds = operationIds(operationsA);
        driver = await createMediatorDriver({
            operationsA,
            operationsB,
            orderedCatchupEnabled: true,
            syncOrderByIdA: syncOrders(operationsA),
            syncOrderByIdB: syncOrders(operationsB),
            maxRecordsPerWindow: 4,
            connectionMode: 'unknown',
            publicKeyA: Buffer.alloc(32, 0x11),
            publicKeyB: Buffer.alloc(32, 0x22),
        });
        const exportIndex = driver.nodeB.gatekeeperClient.exportIndex;
        const exportIndexImplementation = exportIndex.getMockImplementation();
        if (!exportIndexImplementation) {
            throw new Error('node B exportIndex implementation is unavailable');
        }
        let markPostImportExportFinished!: () => void;
        const postImportExportFinished = new Promise<void>(resolve => {
            markPostImportExportFinished = resolve;
        });
        exportIndex.mockImplementationOnce(async request => {
            try {
                return await exportIndexImplementation(request);
            }
            finally {
                markPostImportExportFinished();
            }
        });
        await driver.startSync();
        expect(driver.transport.peekNext()).toMatchObject({
            direction: 'a-to-b',
            messageTypes: ['ping'],
        });
        await driver.transport.deliverNext();
        expect(driver.transport.peekNext()).toMatchObject({
            direction: 'b-to-a',
            messageTypes: ['ping'],
        });
        await driver.transport.deliverNext();
        expect(driver.transport.peekNext()).toMatchObject({
            direction: 'b-to-a',
            messageTypes: ['ordered_catchup_req'],
        });

        const peerKeyB = driver.nodeB.publicKey.toString('hex');
        await driver.nodeA.run(
            () => driver!.nodeA.mediator.__test.maybeStartPeerSync(peerKeyB, 'periodic'),
        );
        expect(decodeWire(driver.transport).some(message => message.body.type === 'neg_open')).toBe(false);

        await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 15_000 });
        const handoffMessages = decodeWire(driver.transport);
        expect(handoffMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                direction: 'b-to-a',
                body: expect.objectContaining({ type: 'ordered_catchup_req' }),
            }),
            expect.objectContaining({
                direction: 'a-to-b',
                body: expect.objectContaining({ type: 'ordered_catchup_push' }),
            }),
        ]));
        const finalCatchupSequence = Math.max(...handoffMessages
            .filter(message => message.body.type === 'ordered_catchup_push')
            .map(message => message.sequence));
        await postImportExportFinished;
        const opens = handoffMessages.filter(message => message.body.type === 'neg_open');
        expect(opens.length).toBeGreaterThan(0);
        expect(opens.every(message => (
            message.direction === 'b-to-a' && message.sequence > finalCatchupSequence
        ))).toBe(true);
        expect(handoffMessages.some(message => (
            message.body.type === 'neg_close' && message.body.reason === 'ordered_catchup_active'
        ))).toBe(false);
        assertCompletedNegentropyExchange(handoffMessages);
        expect(await gatekeeperIds(driver.nodeA.gatekeeper)).toStrictEqual(expectedIds);
        expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
    });

    it('suppresses Negentropy until ordered imports settle, then converges through the handoff', async () => {
        const operationsA = await createIndependentOperations(6);
        const [uniqueB] = await createIndependentOperations(1);
        const operationsB = [uniqueB];
        const union = [...operationsA, ...operationsB];
        const expectedIds = operationIds(union);
        driver = await createMediatorDriver({
            operationsA,
            operationsB,
            orderedCatchupEnabled: true,
            syncOrderByIdA: syncOrders(operationsA),
            syncOrderByIdB: syncOrders(operationsB),
            maxRecordsPerWindow: 4,
            connectionMode: 'unknown',
            publicKeyA: Buffer.alloc(32, 0x22),
            publicKeyB: Buffer.alloc(32, 0x11),
        });
        await driver.storeB.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await driver.storeB.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '0');
        const assertSourceOrderMirrored = async (): Promise<void> => {
            const sourceIds = new Set(operationIds(operationsA));
            const sourceCursors = (await driver!.storeA.iterateOrdered({ limit: Number.MAX_SAFE_INTEGER }))
                .map(row => ({ syncOrder: row.syncOrder!, id: row.id }));
            const targetRows = await driver!.storeB.iterateOrdered({ limit: Number.MAX_SAFE_INTEGER });
            const targetCursors = targetRows
                .filter(row => sourceIds.has(row.id))
                .map(row => ({ syncOrder: row.syncOrder!, id: row.id }));

            expect(targetRows.map(row => row.id).sort()).toStrictEqual(expectedIds);
            expect(targetCursors.map(cursor => cursor.id))
                .toStrictEqual(sourceCursors.map(cursor => cursor.id));
            expect(targetCursors.every((cursor, index) => (
                index === 0 || cursor.syncOrder > targetCursors[index - 1].syncOrder
            ))).toBe(true);
            expect(targetCursors.at(-1)?.id).toBe(sourceCursors.at(-1)?.id);
        };
        const deferred = driver.deferNextClientCall({
            node: 'b',
            client: 'gatekeeper',
            method: 'processEvents',
            label: 'node B final ordered page',
        });
        const applySyncPage = jest.mocked(driver.storeB.applySyncPage);
        const applySyncPageImplementation = applySyncPage.getMockImplementation();
        if (!applySyncPageImplementation) {
            throw new Error('tracked node B applySyncPage implementation is unavailable');
        }
        let markApplyStarted!: () => void;
        const applyStarted = new Promise<void>(resolve => {
            markApplyStarted = resolve;
        });
        let releaseApply!: () => void;
        const applyBlocked = new Promise<void>(resolve => {
            releaseApply = resolve;
        });
        let markApplyFinished!: () => void;
        const applyFinished = new Promise<void>(resolve => {
            markApplyFinished = resolve;
        });
        applySyncPage.mockImplementationOnce(async page => {
            markApplyStarted();
            await applyBlocked;
            try {
                return await applySyncPageImplementation(page);
            }
            finally {
                markApplyFinished();
            }
        });
        const exportCallsBeforeCatchup = driver.nodeB.gatekeeperClient.exportIndex.mock.calls.length;
        const getNodeBTelemetry = () => driver!.nodeB.run(
            () => driver!.nodeB.mediator.__test.getSyncStatsSnapshot(),
        );

        try {
            await driver.startSync();
            await pumpUntilPendingMessage(driver.transport, 'a-to-b', 'ordered_catchup_push');
            const peerKeyA = driver.nodeA.publicKey.toString('hex');
            const peerKeyB = driver.nodeB.publicKey.toString('hex');
            await driver.nodeA.run(() => driver!.nodeA.mediator.__test.maybeStartPeerSync(peerKeyB, 'periodic'));
            await driver.nodeB.run(() => driver!.nodeB.mediator.__test.maybeStartPeerSync(peerKeyA, 'periodic'));
            expect(decodeWire(driver.transport).some(message => message.body.type === 'neg_open')).toBe(false);

            const delivery = driver.transport.deliverNext();
            await deferred.started;

            await driver.nodeA.run(() => driver!.nodeA.mediator.__test.maybeStartPeerSync(peerKeyB, 'periodic'));
            await driver.nodeB.run(() => driver!.nodeB.mediator.__test.maybeStartPeerSync(peerKeyA, 'periodic'));
            await nextTurn();
            const negentropyStartedWhileImportBlocked = decodeWire(driver.transport)
                .some(message => message.body.type === 'neg_open');
            expect(driver.nodeB.run(
                () => driver!.nodeB.mediator.__test.getConnectionState(peerKeyA)?.activeSession,
            )).toEqual(expect.objectContaining({ mode: 'ordered_catchup' }));
            expect(driver.nodeB.gatekeeperClient.exportIndex).toHaveBeenCalledTimes(exportCallsBeforeCatchup);
            expect(getNodeBTelemetry()).toMatchObject({
                orderedCatchup: {
                    sessionsStarted: 1,
                    sessionsCompleted: 0,
                    sessionsFailed: 0,
                },
                syncDurationMs: { sessions: 0 },
            });

            deferred.resolve();
            await delivery;
            await applyStarted;

            await driver.nodeA.run(() => driver!.nodeA.mediator.__test.maybeStartPeerSync(peerKeyB, 'periodic'));
            await driver.nodeB.run(() => driver!.nodeB.mediator.__test.maybeStartPeerSync(peerKeyA, 'periodic'));
            await nextTurn();
            const negentropyStartedWhileRefreshBlocked = decodeWire(driver.transport)
                .some(message => message.body.type === 'neg_open');
            expect(getNodeBTelemetry()).toMatchObject({
                orderedCatchup: {
                    sessionsStarted: 1,
                    sessionsCompleted: 0,
                    sessionsFailed: 0,
                },
                syncDurationMs: { sessions: 0 },
            });

            releaseApply();
            await applyFinished;
            await assertSourceOrderMirrored();
            expect(await driver.storeB.countOrdered()).toBe(expectedIds.length);
            await eventually(() => {
                const stats = getNodeBTelemetry() as {
                    orderedCatchup: { sessionsCompleted: number };
                };
                return stats.orderedCatchup.sessionsCompleted === 1;
            });
            expect(getNodeBTelemetry()).toMatchObject({
                orderedCatchup: {
                    sessionsStarted: 1,
                    sessionsCompleted: 1,
                    sessionsFailed: 0,
                },
                syncDurationMs: { sessions: 1 },
            });

            await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 15_000 });

            expect(negentropyStartedWhileImportBlocked).toBe(false);
            expect(negentropyStartedWhileRefreshBlocked).toBe(false);
            const messages = decodeWire(driver.transport);
            const finalOrderedSequence = Math.max(...messages
                .filter(message => message.body.type === 'ordered_catchup_push')
                .map(message => message.sequence));
            const firstNegOpen = messages.find(message => message.body.type === 'neg_open');
            expect(firstNegOpen?.sequence).toBeGreaterThan(finalOrderedSequence);
            expect(messages.map(message => message.body.type)).toEqual(expect.arrayContaining([
                'ordered_catchup_req',
                'ordered_catchup_push',
                'neg_open',
                'neg_msg',
                'ops_push',
                'neg_close',
            ]));
            expect(await gatekeeperIds(driver.nodeA.gatekeeper)).toStrictEqual(expectedIds);
            expect(await gatekeeperIds(driver.nodeB.gatekeeper)).toStrictEqual(expectedIds);
            expect(await driver.storeA.count()).toBe(expectedIds.length);
            expect(await driver.storeB.count()).toBe(expectedIds.length);
            expect(driver.nodeB.gatekeeperClient.exportIndex).toHaveBeenCalled();
            expect(driver.storeB.applySyncPage).toHaveBeenCalled();

            assertCompletedNegentropyExchange(messages);

            await driver.reconnect();
            await driver.startSync();
            await driver.driveUntilQuiescent(expectedIds, { timeoutMs: 15_000 });
            const secondMessages = decodeWire(driver.transport);
            assertCompletedNegentropyExchange(secondMessages);
            expect(secondMessages
                .filter(message => message.body.type === 'ops_req')
                .flatMap(message => message.body.ids ?? [])).toStrictEqual([]);
            expect(secondMessages
                .filter(message => ['ops_push', 'ordered_catchup_push', 'batch', 'queue'].includes(message.body.type))
                .flatMap(message => message.body.data ?? [])).toStrictEqual([]);

            const canonicalA = (await driver.storeA.iterateSorted({ limit: Number.MAX_SAFE_INTEGER }))
                .map(row => ({ ts: row.ts, id: row.id }));
            const canonicalB = (await driver.storeB.iterateSorted({ limit: Number.MAX_SAFE_INTEGER }))
                .map(row => ({ ts: row.ts, id: row.id }));
            expect(canonicalA).toStrictEqual(canonicalB);
            await assertSourceOrderMirrored();
        }
        finally {
            deferred.resolve();
            releaseApply();
        }
    });
});
