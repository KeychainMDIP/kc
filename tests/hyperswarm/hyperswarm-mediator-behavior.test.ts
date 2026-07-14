import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { Operation } from '@mdip/gatekeeper/types';
import TestHelper from '../gatekeeper/helper.ts';
import { installMediatorMocks } from './hyperswarm-mediator-harness.ts';
import { createMediatorDriver } from './hyperswarm-mediator-driver.ts';

installMediatorMocks();

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
    return operations.map(operation => operation.signature!.hash.toLowerCase()).sort();
}

async function gatekeeperIds(gatekeeper: Gatekeeper): Promise<string[]> {
    const events = await gatekeeper.exportBatch();
    return operationIds(events.map(event => event.operation));
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
        await driver.driveUntilQuiescent(expectedIds);

        const pings = driver.transcript.filter(entry => entry.messageType === 'ping');
        expect(pings).toHaveLength(2);
        expect(pings.map(entry => entry.direction)).toStrictEqual(['a-to-b', 'b-to-a']);
        expect(pings.every(entry => !entry.framed)).toBe(true);

        const protocolEntries = driver.transcript.filter(entry => entry.messageType !== 'ping');
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
});
