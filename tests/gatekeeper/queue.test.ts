import CipherNode from '@mdip/cipher/node';
import { Operation, MdipDocument } from '@mdip/gatekeeper/types';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import { ExpectedExceptionError } from '@mdip/common/errors';
import type { EcdsaJwkPair } from '@mdip/cipher/types';
import HeliaClient from '@mdip/ipfs/helia';

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

beforeAll(async () => {
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

async function createAgentOp(
    keypair: EcdsaJwkPair,
    options: {
        version?: number;
        registry?: string;
        prefix?: string;
    } = {}
): Promise<Operation> {
    const { version = 1, registry = 'local', prefix } = options;
    const operation: Operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: version,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    if (prefix) {
        operation.mdip!.prefix = prefix;
    }

    const msgHash = cipher.hashJSON(operation);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...operation,
        signature: {
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature
        }
    };
}

async function createUpdateOp(
    keypair: EcdsaJwkPair,
    did: string,
    doc: MdipDocument,
    options: {
        excludePrevid?: boolean;
        mockPrevid?: string;
        mockBlockid?: string;
    } = {}
): Promise<Operation> {
    const { excludePrevid = false, mockPrevid } = options;
    const current = await gatekeeper.resolveDID(did);
    const previd = excludePrevid ? undefined : mockPrevid ? mockPrevid : current.didDocumentMetadata?.versionId;
    const { mockBlockid } = options;

    const operation: Operation = {
        type: "update",
        did,
        previd,
        ...(mockBlockid !== undefined && { blockid: mockBlockid }),
        doc,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...operation,
        signature: {
            signer: did,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };
}

describe('getQueue', () => {

    it('should return empty list when no events in queue', async () => {
        const registry = 'TFTC';

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([]);
    });

    it('should return single event in queue', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([updateOp]);
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
        const agentOp = await createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);

        await gatekeeper.clearQueue(registry, queue);
        const queue2 = await gatekeeper.getQueue(registry);

        expect(queue2).toStrictEqual([]);
    });

    it('should clear only specified events', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const queue1 = [];
        const queue2 = [];

        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue1.push(updateOp);
        }

        const queue3 = await gatekeeper.getQueue(registry);
        expect(queue3).toStrictEqual(queue1);

        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue2.push(updateOp);
        }

        await gatekeeper.clearQueue(registry, queue3);
        const queue4 = await gatekeeper.getQueue(registry);
        expect(queue4).toStrictEqual(queue2);
    });

    it('should return true if queue already empty', async () => {
        const ok = await gatekeeper.clearQueue('TFTC', []);
        expect(ok).toBe(true);
    });

    it('should return true if invalid queue specified', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
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
