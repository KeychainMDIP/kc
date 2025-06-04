import CipherNode from '@mdip/cipher/node';
import { Operation, MdipDocument } from '@mdip/gatekeeper/types';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import { copyJSON } from '@mdip/common/utils';
import { InvalidDIDError, ExpectedExceptionError } from '@mdip/common/errors';
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

async function createDeleteOp(
    keypair: EcdsaJwkPair,
    did: string
): Promise<Operation> {
    const current = await gatekeeper.resolveDID(did);
    const previd = current.didDocumentMetadata?.versionId;

    const operation: Operation = {
        type: "delete",
        did,
        previd,
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

async function createAssetOp(
    agent: string,
    keypair: EcdsaJwkPair,
    options: {
        registry?: string;
        validUntil?: string | null;
    } = {}
): Promise<Operation> {
    const { registry = 'local', validUntil = null } = options;
    const dataAnchor: Operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry,
            validUntil: validUntil || undefined
        },
        controller: agent,
        data: "mockData",
    };

    const msgHash = cipher.hashJSON(dataAnchor);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...dataAnchor,
        signature: {
            signer: agent,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };
}

describe('exportDID', () => {
    it('should export a valid DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(1);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should export a valid updated DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(2);
        expect(ops[0].operation).toStrictEqual(agentOp);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    // eslint-disable-next-line
    it('should return empty array on an invalid DID', async () => {
        const ops = await gatekeeper.exportDID('mockDID');
        expect(ops).toStrictEqual([]);
    });
});

describe('exportDIDs', () => {
    it('should export valid DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportDIDs([did]);
        const ops = exports[0];

        expect(ops.length).toBe(1);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should export all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        for (let i = 0; i < 5; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            await gatekeeper.createDID(assetOp);
        }

        const exports = await gatekeeper.exportDIDs();

        expect(exports.length).toBe(6);
    });

    it('should export a DIDs in order requested', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        delete agentOp.mdip!.validUntil;
        const agentDID = await gatekeeper.createDID(agentOp);

        const assetOp = await createAssetOp(agentDID, keypair);
        delete assetOp.mdip!.validUntil;
        const assetDID = await gatekeeper.createDID(assetOp);

        const exports = await gatekeeper.exportDIDs([assetDID, agentDID]);

        expect(exports.length).toBe(2);
        expect(exports[0][0].operation).toStrictEqual(assetOp);
        expect(exports[1][0].operation).toStrictEqual(agentOp);
    });

    it('should export valid updated DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const exports = await gatekeeper.exportDIDs([did]);
        const ops = exports[0];

        expect(ops.length).toBe(2);
        expect(ops[0].operation).toStrictEqual(agentOp);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    // eslint-disable-next-line
    it('should return empty array on an invalid DID', async () => {
        const exports = await gatekeeper.exportDIDs(['mockDID']);
        const ops = exports[0];
        expect(ops).toStrictEqual([]);
    });
});

describe('importDIDs', () => {
    it('should import a valid agent DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDIDs([did]);

        await gatekeeper.importDIDs(ops);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(1);
    });
});

describe('removeDIDs', () => {
    it('should remove a valid DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ok = await gatekeeper.removeDIDs([did]);

        expect(ok).toBe(true);

        try {
            await gatekeeper.resolveDID(did);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe('unknown');
        }
    });

    it('should throw an exception if no array specified', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.removeDIDs();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: dids');
        }
    });

    it('should return true if no DID specified remove', async () => {
        const ok = await gatekeeper.removeDIDs([]);
        expect(ok).toBe(true);
    });

    it('should return true if unknown DIDs specified', async () => {
        const ok = await gatekeeper.removeDIDs(['did:test:mock']);
        expect(ok).toBe(true);
    });
});

describe('exportBatch', () => {
    // local DIDs are excluded from exportBatch so we'll create on hyperswarm
    it('should export a valid batch', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportBatch([did]);

        expect(exports.length).toBe(1);
        expect(exports[0].operation).toStrictEqual(agentOp);
    });

    it('should export batch with all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);

        for (let i = 0; i < 5; i++) {
            const assetOp = await createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
            await gatekeeper.createDID(assetOp);
        }

        const exports = await gatekeeper.exportBatch();

        expect(exports.length).toBe(6);
    });

    it('should export a valid updated batch', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const exports = await gatekeeper.exportBatch([did]);

        expect(exports.length).toBe(2);
        expect(exports[0].operation).toStrictEqual(agentOp);
        expect(exports[1].operation).toStrictEqual(updateOp);
    });

    // eslint-disable-next-line
    it('should return empty array on an invalid DID', async () => {
        const exports = await gatekeeper.exportBatch(['mockDID']);
        expect(exports).toStrictEqual([]);
    });
});

describe('importBatch', () => {
    it('should queue a valid agent DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
    });

    it('should report when event already processed', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();
        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(0);
        expect(response.processed).toBe(1);
    });

    it('should throw an exception on undefined', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.importBatch();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.importBatch('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on an empty array', async () => {
        try {
            await gatekeeper.importBatch([]);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should report an error on non-transactions', async () => {
        // @ts-expect-error Testing invalid usage
        const response = await gatekeeper.importBatch([1, 2, 3]);

        expect(response.rejected).toBe(3);
    });

    it('should report an error on invalid event time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].time = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        // @ts-expect-error Testing invalid usage
        ops[0].operation = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation type', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        (ops[0].operation.type as any) = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing created time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.created;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing mdip metadata', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.mdip;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip version', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip!.version = -1;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip type', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        // @ts-expect-error Testing invalid usage
        ops[0].operation.mdip!.type = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip!.registry = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing operation signature', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.signature;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature date', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.signed = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature hash', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.hash = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature signer', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.signer = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing operation key', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.publicJwk;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on incorrect controller', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const ops = await gatekeeper.exportDID(assetDID);

        ops[0].operation.controller = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid update operation missing doc', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[1].operation.doc;

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid update operation missing did', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[1].operation.did;

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid delete operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const deleteOp = await createDeleteOp(keypair, did);
        const verifyResult = await gatekeeper.verifyOperation(deleteOp);
        await gatekeeper.deleteDID(deleteOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[1].operation.did;

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
        expect(verifyResult).toBe(true);
    });
});

describe('processEvents', () => {
    it('should import a valid agent DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(1);
    });

    it('should import a valid asset DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const ops = await gatekeeper.exportDID(assetDID);

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(1);
    });

    it('should import a valid batch export', async () => {
        const keypair = cipher.generateRandomJwk();
        // create on hyperswarm because exportBatch will not export local DIDs
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        await gatekeeper.createDID(assetOp);
        const batch = await gatekeeper.exportBatch();

        await gatekeeper.importBatch(batch);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(2);
    });

    it('should import a batch export with missing event dids', async () => {
        // This simulates an import from hyperswarm-mediator which receives only operations and creates events without DIDs
        // (TBD revisit whether events should be created with DIDs in advance of import)
        const keypair = cipher.generateRandomJwk();
        // create on hyperswarm because exportBatch will not export local DIDs
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(agentDID);
        const updateOp = await createUpdateOp(keypair, agentDID, doc);
        await gatekeeper.updateDID(updateOp);
        const assetOp = await createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        await gatekeeper.createDID(assetOp);
        const batch = await gatekeeper.exportBatch();

        await gatekeeper.resetDb();

        for (const event of batch) {
            delete event.did;
        }

        await gatekeeper.importBatch(batch);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(3);
    });

    it('should report 0 ops added when DID exists', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(0);
        expect(response.merged).toBe(2);
    });

    it('should update events when DID is imported from its native registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const deleteOp = await createDeleteOp(keypair, did);
        await gatekeeper.deleteDID(deleteOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        ops[1].blockchain = {
            "height": 100,
            "index": 1,
            "txid": "mock1",
            "batch": "mock1"
        };
        ops[2].registry = 'TFTC';
        ops[2].blockchain = {
            "height": 200,
            "index": 2,
            "txid": "mock2",
            "batch": "mock2"
        };

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(3);
        expect(response.merged).toBe(0);
    });

    it('should resolve as confirmed when DID is imported from its native registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();

        const doc2 = await gatekeeper.resolveDID(did);

        expect(doc2.didDocumentMetadata!.version).toBe(2);
        expect(doc2.didDocumentMetadata!.confirmed).toBe(true);
    });

    it('should resolve with timestamp when available', async () => {
        const mockBlock1 = { hash: 'mockBlockid1', height: 100, time: 100 };
        const mockBlock2 = { hash: 'mockBlockid2', height: 101, time: 101 };
        await gatekeeper.addBlock('TFTC', mockBlock1);
        await gatekeeper.addBlock('TFTC', mockBlock2);

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc, { mockBlockid: mockBlock1.hash });
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        ops[1].blockchain = {
            "height": 101,
            "index": 1,
            "txid": "mockTxid",
            "batch": "mockBatch"
        };

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();

        const doc2 = await gatekeeper.resolveDID(did);

        const expectedTimestamp = {
            chain: 'TFTC',
            opid: doc2.didDocumentMetadata!.versionId,
            lowerBound: {
                blockid: mockBlock1.hash,
                height: mockBlock1.height,
                time: mockBlock1.time,
                timeISO: new Date(mockBlock1.time * 1000).toISOString(),
            },
            upperBound: {
                blockid: mockBlock2.hash,
                height: mockBlock2.height,
                time: mockBlock2.time,
                timeISO: new Date(mockBlock2.time * 1000).toISOString(),
                txid: ops[1].blockchain.txid,
                txidx: ops[1].blockchain.index,
                batchid: ops[1].blockchain.batch,
            }
        };

        expect(doc2.didDocumentMetadata!.timestamp).toStrictEqual(expectedTimestamp);
    });

    it('should not overwrite events when verified DID is later synced from another registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);
        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        await gatekeeper.importBatch(ops);

        ops[0].registry = 'hyperswarm';
        ops[1].registry = 'hyperswarm';
        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(0);
        expect(response.merged).toBe(4);
    });

    it('should report 2 ops imported when DID deleted first', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(2);
        expect(response.merged).toBe(0);
    });

    it('should report N+1 ops imported for N updates', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        const N = 10;
        for (let i = 0; i < N; i++) {
            doc.didDocumentData = { mock: `${i}` };
            const updateOp = await createUpdateOp(keypair, did, doc);
            const verified = await gatekeeper.verifyOperation(updateOp);
            expect(verified).toBe(true);
            await gatekeeper.updateDID(updateOp);
        }

        const events = await gatekeeper.exportDID(did);
        await gatekeeper.resetDb();
        const { queued, rejected } = await gatekeeper.importBatch(events);

        expect(queued).toBe(N + 1);
        expect(rejected).toBe(0);

        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(N + 1);
        expect(response.merged).toBe(0);
    });

    it('should resolve an imported DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();
        const doc = await gatekeeper.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
    });

    it('should handle processing events in any order', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);
        const updateOp1 = await createUpdateOp(keypair, agentDID, agentDoc);
        await gatekeeper.updateDID(updateOp1);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);
        const updateOp2 = await createUpdateOp(keypair, assetDID, assetDoc);
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const ops = dids.flat();
        await gatekeeper.resetDb();
        // Reverse the ops so that the updates come before the create ops
        await gatekeeper.importBatch(ops.reverse());

        const response1 = await gatekeeper.processEvents();
        expect(response1.added).toBe(4);
    });

    it('should handle processing pre-v0.5 event without previd property', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);
        const updateOp1 = await createUpdateOp(keypair, agentDID, agentDoc, { excludePrevid: true });
        await gatekeeper.updateDID(updateOp1);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);
        const updateOp2 = await createUpdateOp(keypair, assetDID, assetDoc, { excludePrevid: true });
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const ops = dids.flat();
        await gatekeeper.resetDb();
        await gatekeeper.importBatch(ops);

        const response = await gatekeeper.processEvents();
        expect(response.added).toBe(4);
    });

    it('should handle processing events with unknown previd property', async () => {
        const mockPrevid = 'mockPrevid';

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);
        const updateOp1 = await createUpdateOp(keypair, agentDID, agentDoc, { mockPrevid });
        await gatekeeper.updateDID(updateOp1);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);
        const updateOp2 = await createUpdateOp(keypair, assetDID, assetDoc, { mockPrevid });
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const ops = dids.flat();
        await gatekeeper.resetDb();
        await gatekeeper.importBatch(ops);

        const response = await gatekeeper.processEvents();
        expect(response.added).toBe(2);
        expect(response.pending).toBe(2);
    });

    it('should reject events with duplicate previd property', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updateOp1 = await createUpdateOp(keypair, agentDID, agentDoc);
        const update1 = copyJSON(agentDoc);
        update1.didDocumentData = { mock: 1 };
        const updateOp2 = await createUpdateOp(keypair, agentDID, update1);
        const update2 = copyJSON(agentDoc);
        update2.didDocumentData = { mock: 2 };
        const updateOp3 = await createUpdateOp(keypair, agentDID, update2);

        const ops = [];

        ops.push({
            registry: 'local',
            operation: updateOp1,
            ordinal: [0],
            time: new Date().toISOString(),
        });

        ops.push({
            registry: 'local',
            operation: updateOp2,
            ordinal: [1],
            time: new Date().toISOString(),
        });

        ops.push({
            registry: 'local',
            operation: updateOp3,
            ordinal: [2],
            time: new Date().toISOString(),
        });

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();
        expect(response.added).toBe(1);
        expect(response.rejected).toBe(2);
    });

    it('should handle a reorg event', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc1 = await gatekeeper.resolveDID(agentDID);

        // Simulate a double-spend scenario where a bad actor creates a pair of inconsistent operations
        // Only one of the pair can be confirmed and it depends on the order of operations
        const update1 = copyJSON(agentDoc1);
        update1.didDocumentData = { mock: 1 };
        const updateOp1 = await createUpdateOp(keypair, agentDID, update1);
        const update2 = copyJSON(agentDoc1);
        update2.didDocumentData = { mock: 2 };
        const updateOp2 = await createUpdateOp(keypair, agentDID, update2);

        const event1 = {
            registry: 'hyperswarm',
            operation: updateOp1,
            ordinal: [0],
            time: new Date().toISOString(),
        };

        const event2 = {
            registry: 'hyperswarm',
            operation: updateOp2,
            ordinal: [1],
            time: new Date().toISOString(),
        };

        // Simulate receiving events in reverse order from hyperswarm
        await gatekeeper.importBatch([event2, event1]);
        const response = await gatekeeper.processEvents();
        expect(response.added).toBe(1);
        expect(response.rejected).toBe(1);

        const agentDoc2 = await gatekeeper.resolveDID(agentDID);
        // @ts-expect-error Testing invalid usage
        expect(agentDoc2.didDocumentData.mock).toBe(2);

        const event3 = {
            registry: 'TFTC',
            operation: updateOp1,
            ordinal: [31226, 1, 0],
            time: new Date().toISOString(),
        };

        const event4 = {
            registry: 'TFTC',
            operation: updateOp2,
            ordinal: [31226, 1, 1],
            time: new Date().toISOString(),
        };

        // Simulate receiving the events in the imposed order from TFTC
        await gatekeeper.importBatch([event3, event4]);
        const response2 = await gatekeeper.processEvents();
        expect(response2.added).toBe(1);
        expect(response2.rejected).toBe(1);

        const agentDoc3 = await gatekeeper.resolveDID(agentDID, { confirm: true });
        // @ts-expect-error Testing invalid usage
        expect(agentDoc3.didDocumentData.mock).toBe(1);
    });

    it('should handle deferred operation validation when asset ownership changes', async () => {
        const keypair1 = cipher.generateRandomJwk();
        const agentOp1 = await createAgentOp(keypair1, { version: 1, registry: 'TFTC' });
        const agentDID1 = await gatekeeper.createDID(agentOp1);

        const keypair2 = cipher.generateRandomJwk();
        const agentOp2 = await createAgentOp(keypair2, { version: 1, registry: 'TFTC' });
        const agentDID2 = await gatekeeper.createDID(agentOp2);

        const assetOp = await createAssetOp(agentDID1, keypair1, { registry: 'TFTC' });
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc1 = await gatekeeper.resolveDID(assetDID);

        // agent1 transfers ownership of asset to agent2
        assetDoc1.didDocument!.controller = agentDID2;
        const updateOp1 = await createUpdateOp(keypair1, assetDID, assetDoc1);
        await gatekeeper.updateDID(updateOp1);

        // agent2 transfers ownership of asset back to agent1
        assetDoc1.didDocument!.controller = agentDID1;
        const updateOp2 = await createUpdateOp(keypair2, assetDID, assetDoc1);
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const events = dids.flat();
        await gatekeeper.resetDb();
        await gatekeeper.importBatch(events);

        const response1 = await gatekeeper.processEvents();
        expect(response1.added).toBe(events.length);

        const assetDoc2 = await gatekeeper.resolveDID(assetDID);
        expect(assetDoc2.didDocumentMetadata!.version).toBe(3);
        expect(assetDoc2.didDocumentMetadata!.confirmed).toBe(false);

        for (const event of events) {
            event.registry = 'TFTC';
        }

        await gatekeeper.importBatch(events);

        const response2 = await gatekeeper.processEvents();
        expect(response2.added).toBe(events.length);

        const assetDoc3 = await gatekeeper.resolveDID(assetDID);
        expect(assetDoc3.didDocumentMetadata!.version).toBe(3);
        expect(assetDoc3.didDocumentMetadata!.confirmed).toBe(true);
    });

    it('should reject events with bad signatures', async () => {
        const keypair1 = cipher.generateRandomJwk();
        const agentOp1 = await createAgentOp(keypair1);
        const agentDID1 = await gatekeeper.createDID(agentOp1);
        const agentDoc1 = await gatekeeper.resolveDID(agentDID1);
        const updateOp1 = await createUpdateOp(keypair1, agentDID1, agentDoc1);
        await gatekeeper.updateDID(updateOp1);

        const keypair2 = cipher.generateRandomJwk();
        const agentOp2 = await createAgentOp(keypair2);
        const agentDID2 = await gatekeeper.createDID(agentOp2);
        const agentDoc2 = await gatekeeper.resolveDID(agentDID2);
        const updateOp2 = await createUpdateOp(keypair2, agentDID2, agentDoc2);
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const ops = dids.flat();
        await gatekeeper.resetDb();

        const sigVal1 = ops[1].operation.signature!.value;
        const sigVal3 = ops[3].operation.signature!.value;

        ops[1].operation.signature!.value = sigVal3;
        ops[3].operation.signature!.value = sigVal1;

        await gatekeeper.importBatch(ops);

        const response1 = await gatekeeper.processEvents();
        expect(response1.added).toBe(2);
        expect(response1.rejected).toBe(2);
    });

    it('should return busy when already proccessing events', async () => {
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole });
        // @ts-expect-error Testing private state
        gk.isProcessingEvents = true;
        const response = await gk.processEvents();

        expect(response.busy).toBe(true);
    });

    it('should gracefully handle expections', async () => {
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole });
        // @ts-expect-error Testing private state
        gk.eventsQueue = null;
        const response = await gk.processEvents();

        expect(response.added).toBe(0);
        expect(response.merged).toBe(0);
        expect(response.rejected).toBe(0);
        expect(response.pending).toBe(0);
    });
});

describe('getDids', () => {
    it('should return all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);

        const allDIDs = await gatekeeper.getDIDs();

        expect(allDIDs.length).toBe(2);
        expect(allDIDs.includes(agentDID)).toBe(true);
        expect(allDIDs.includes(assetDID)).toBe(true);
    });

    it('should return all DIDs resolved', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ resolve: true });

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDoc);
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs confirmed and resolved', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updatedAgentDoc = JSON.parse(JSON.stringify(agentDoc));
        updatedAgentDoc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, agentDID, updatedAgentDoc);
        await gatekeeper.updateDID(updateOp);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ confirm: true, resolve: true });

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDoc); // version 1
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs unconfirmed and resolved', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updatedAgentDoc = JSON.parse(JSON.stringify(agentDoc));
        updatedAgentDoc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, agentDID, updatedAgentDoc);
        await gatekeeper.updateDID(updateOp);
        const agentDocv2 = await gatekeeper.resolveDID(agentDID);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ confirm: false, resolve: true });

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDocv2);
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs after specified time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
        }

        const doc = await gatekeeper.resolveDID(dids[4]);
        const recentDIDs = await gatekeeper.getDIDs({ updatedAfter: doc.didDocumentMetadata!.created });

        expect(recentDIDs.length).toBe(5);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
        expect(recentDIDs.includes(dids[8])).toBe(true);
        expect(recentDIDs.includes(dids[9])).toBe(true);
    });

    it('should return all DIDs before specified time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
        }

        const doc = await gatekeeper.resolveDID(dids[5]);
        const recentDIDs = await gatekeeper.getDIDs({ updatedBefore: doc.didDocumentMetadata!.created });

        expect(recentDIDs.length).toBe(6);
        expect(recentDIDs.includes(agentDID)).toBe(true);
        expect(recentDIDs.includes(dids[0])).toBe(true);
        expect(recentDIDs.includes(dids[1])).toBe(true);
        expect(recentDIDs.includes(dids[2])).toBe(true);
        expect(recentDIDs.includes(dids[3])).toBe(true);
        expect(recentDIDs.includes(dids[4])).toBe(true);
    });

    it('should return all DIDs between specified times', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
        }

        const doc3 = await gatekeeper.resolveDID(dids[3]);
        const doc8 = await gatekeeper.resolveDID(dids[8]);
        const recentDIDs = await gatekeeper.getDIDs({
            updatedAfter: doc3.didDocumentMetadata!.created,
            updatedBefore: doc8.didDocumentMetadata!.created
        });

        expect(recentDIDs.length).toBe(4);
        expect(recentDIDs.includes(dids[4])).toBe(true);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
    });

    it('should resolve all specified DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];
        const expected = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);
            expected.push(await gatekeeper.resolveDID(assetDID));
        }

        const resolvedDIDs = await gatekeeper.getDIDs({
            dids: dids,
            resolve: true
        });

        expect(resolvedDIDs.length).toBe(10);

        for (let i = 0; i < 10; i++) {
            expect(resolvedDIDs[i]).toStrictEqual(expected[i]);
        }
    });
});
