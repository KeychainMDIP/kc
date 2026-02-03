import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import TestHelper from './helper.ts';

const mockConsole = {
    log: (): void => { },
    error: (): void => { },
    time: (): void => { },
    timeEnd: (): void => { },
} as unknown as typeof console;

const cipher = new CipherNode();
const db = new DbJsonMemory('test');
const ipfs = new HeliaClient();
const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, registries: ['local', 'hyperswarm', 'TFTC'] });
const helper = new TestHelper(gatekeeper, cipher);

beforeAll(async () => {
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

describe('getQueue', () => {

    it('should return empty list when no events in queue', async () => {
        const registry = 'TFTC';

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([]);
    });

    it('should return events in queue', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([agentOp, updateOp]);
    });

    it('should throw an exception if invalid registry', async () => {
        try {
            await gatekeeper.getQueue('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: registry=mock');
        }
    });
});

describe('clearQueue', () => {

    it('should clear non-empty queue', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);

        await gatekeeper.clearQueue(registry, queue);
        const queue2 = await gatekeeper.getQueue(registry);

        expect(queue2).toStrictEqual([]);
    });

    it('should clear queue using signature hashes', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const queue = await gatekeeper.getQueue(registry);
        const hashes = queue
            .map(op => op.signature?.hash)
            .filter((hash): hash is string => !!hash);

        await gatekeeper.clearQueue(registry, hashes);
        const queue2 = await gatekeeper.getQueue(registry);

        expect(queue2).toStrictEqual([]);
    });

    it('should return true when hash list has no valid hashes', async () => {
        const ok = await gatekeeper.clearQueue('TFTC', ['']);
        expect(ok).toBe(true);
    });

    it('should leave queue unchanged when hashes do not match', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        await gatekeeper.createDID(agentOp);

        const queue1 = await gatekeeper.getQueue(registry);
        expect(queue1.length).toBeGreaterThan(0);

        const ok = await gatekeeper.clearQueue(registry, ['deadbeef']);
        expect(ok).toBe(true);

        const queue2 = await gatekeeper.getQueue(registry);
        expect(queue2).toStrictEqual(queue1);
    });

    it('should ignore queued ops without hashes when clearing by hash', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        await gatekeeper.createDID(agentOp);

        const opWithoutHash = {
            type: 'create',
            mdip: { version: 1, type: 'agent', registry },
            signature: { signed: '', hash: '', value: '' },
        } as any;
        await db.queueOperation(registry, opWithoutHash);

        const hashes = [agentOp.signature!.hash];
        await gatekeeper.clearQueue(registry, hashes);

        const queue = await gatekeeper.getQueue(registry);
        expect(queue).toStrictEqual([opWithoutHash]);
    });

    it('should return true when queue missing but operations provided', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const ok = await gatekeeper.clearQueue(registry, [agentOp]);
        expect(ok).toBe(true);
    });

    it('should clear only specified events', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const queue1 = [agentOp];

        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue1.push(updateOp);
        }

        const queue2 = await gatekeeper.getQueue(registry);
        expect(queue2).toStrictEqual(queue1);

        const queue3 = [];
        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue3.push(updateOp);
        }

        await gatekeeper.clearQueue(registry, queue2);
        const queue4 = await gatekeeper.getQueue(registry);
        expect(queue4).toStrictEqual(queue3);
    });

    it('should return true if queue already empty', async () => {
        const ok = await gatekeeper.clearQueue('TFTC', []);
        expect(ok).toBe(true);
    });

    it('should return true if invalid queue specified', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);
        await gatekeeper.clearQueue(registry, queue);
        await gatekeeper.getQueue(registry);

        // @ts-expect-error Testing invalid queue
        const ok = await gatekeeper.clearQueue(registry, 'mock');

        expect(ok).toStrictEqual(true);
    });

    it('should throw an exception if invalid registry', async () => {
        try {
            await gatekeeper.clearQueue('mock', []);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: registry=mock');
        }
    });
});
