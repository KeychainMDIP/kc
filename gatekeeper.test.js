import mockFs from 'mock-fs';
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';
import * as db_json from './db-json.js';

beforeEach(async () => {
    db_json.start();
    await gatekeeper.start(db_json);
});

afterEach(async () => {
    await gatekeeper.stop();
});

describe('generateDid', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from operation', async () => {
        mockFs({});

        const mockTxn = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                registry: "mockRegistry"
            }
        };
        const did = await gatekeeper.generateDID(mockTxn);

        expect(did.startsWith('did:mdip:'));
    });

    it('should create same DID from same operation with date included', async () => {
        mockFs({});

        const mockTxn = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                registry: "mockRegistry"
            }
        };
        const did1 = await gatekeeper.generateDID(mockTxn);
        const did2 = await gatekeeper.generateDID(mockTxn);

        expect(did1 === did2).toBe(true);
    });
});

async function createAgentOp(keypair, version = 1, registry = 'hyperswarm') {
    const operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: version,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...operation,
        signature: {
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature
        }
    };
}

async function createUpdateOp(keypair, did, doc) {
    const current = await gatekeeper.resolveDID(did);
    const prev = cipher.hashJSON(current);

    const operation = {
        type: "update",
        did: did,
        doc: doc,
        prev: prev,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);

    const signed = {
        ...operation,
        signature: {
            signer: did,
            created: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return signed;
}

async function createAssetOp(agent, keypair) {
    const dataAnchor = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry: "hyperswarm",
        },
        controller: agent,
        data: "mockData",
    };

    const msgHash = cipher.hashJSON(dataAnchor);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const assetOp = {
        ...dataAnchor,
        signature: {
            signer: agent,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return assetOp;
}

describe('createDID', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from agent operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID for local registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'local');

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:mdip:'));
    });

    it('should throw exception on invalid version', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 2);

        try {
            await gatekeeper.createDID(agentOp);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid versions include')).toBe(true);
        }
    });

    it('should throw exception on invalid registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'mockRegistry');

        try {
            await gatekeeper.createDID(agentOp);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid registries include')).toBe(true);
        }
    });

    it('should create DID from asset operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agent, keypair);

        const did = await gatekeeper.createDID(assetOp);

        expect(did.startsWith('did:mdip:'));
    });
});

describe('exportDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should export a valid DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(1);
        expect(ops[0].did).toStrictEqual(did);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should return empty array on an invalid DID', async () => {
        mockFs({});

        const ops = await gatekeeper.exportDID('mockDID');
        expect(ops).toStrictEqual([]);
    });
});

describe('importDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should import a valid agent DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        const imported = await gatekeeper.importDID(ops);

        expect(imported).toBe(0);
    });

    it('should import a valid asset DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const ops = await gatekeeper.exportDID(assetDID);

        const imported = await gatekeeper.importDID(ops);

        expect(imported).toBe(0);
    });

    it('should report 0 ops reported when DID exists', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateTxn = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateTxn);
        const ops = await gatekeeper.exportDID(did);

        const imported = await gatekeeper.importDID(ops);

        expect(imported).toBe(0);
    });

    it('should report 2 ops imported when DID deleted first', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateTxn = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateTxn);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        const imported = await gatekeeper.importDID(ops);

        expect(imported).toBe(2);
    });

    it('should report N+1 ops imported for N updates', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        const N = 10;
        for (let i = 0; i < N; i++) {
            doc.didDocumentData = { mock: `${i}` };
            const updateTxn = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateTxn);
        }

        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();
        const imported = await gatekeeper.importDID(ops);

        expect(imported).toBe(N + 1);
    });

    it('should resolve an imported DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importDID(ops);
        const doc = await gatekeeper.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
    });

    it('should throw an exception on mismatched DID in export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp1 = await createAgentOp(keypair);
        const did1 = await gatekeeper.createDID(agentOp1);
        const agentOp2 = await createAgentOp(keypair);
        const did2 = await gatekeeper.createDID(agentOp2);
        const ops = await gatekeeper.exportDID(did1);

        ops[0].did = did2;

        try {
            await gatekeeper.importDID(ops);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid operation');
        }
    });

    it('should throw an exception on undefined', async () => {
        mockFs({});

        try {
            await gatekeeper.importDID();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        mockFs({});

        try {
            await gatekeeper.importDID('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on an empty array', async () => {
        mockFs({});

        try {
            await gatekeeper.importDID([]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on an array on non-transactions', async () => {
        mockFs({});

        try {
            await gatekeeper.importDID([1, 2, 3]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid operation');
        }
    });
});
