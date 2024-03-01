import fs from 'fs';
import mockFs from 'mock-fs';
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';

beforeEach(async () => {
    await gatekeeper.start();
});

afterEach(async () => {
    await gatekeeper.stop();
});

describe('generateDid', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from txn', async () => {
        mockFs({});

        const mockTxn = {
            op: "create",
            created: new Date().toISOString(),
            mdip: {
                registry: "mockRegistry"
            }
        };
        const did = await gatekeeper.generateDID(mockTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create same DID from same txn with date included', async () => {
        mockFs({});

        const mockTxn = {
            op: "create",
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

async function createAgentTxn(keypair, version = 1, registry = 'hyperswarm') {
    const txn = {
        op: "create",
        created: new Date().toISOString(),
        mdip: {
            version: version,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msgHash = cipher.hashJSON(txn);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...txn,
        signature: {
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature
        }
    };
}

async function createUpdateTxn(keypair, did, doc) {
    const current = await gatekeeper.resolveDID(did);
    const prev = cipher.hashJSON(current);

    const txn = {
        op: "update",
        did: did,
        doc: doc,
        prev: prev,
    };

    const msgHash = cipher.hashJSON(txn);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);

    const signed = {
        ...txn,
        signature: {
            signer: did,
            created: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return signed;
}

async function createAssetTxn(agent, keypair) {
    const dataAnchor = {
        op: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry: "BTC",
        },
        controller: agent,
        data: "mockData",
    };

    const msgHash = cipher.hashJSON(dataAnchor);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const assetTxn = {
        ...dataAnchor,
        signature: {
            signer: agent,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return assetTxn;
}

describe('createDID', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from agent txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID for peerbit registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'peerbit');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });


    it('should create DID for BTC registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'BTC');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID for tBTC registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'tBTC');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID for local registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'local');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should throw exception on invalid version', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 2);

        try {
            const did = await gatekeeper.createDID(agentTxn);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid versions include')).toBe(true);
        }
    });

    it('should throw exception on invalid registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'mockRegistry');

        try {
            const did = await gatekeeper.createDID(agentTxn);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid registries include')).toBe(true);
        }
    });

    it('should create DID from asset txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const agent = await gatekeeper.createDID(agentTxn);
        const assetTxn = await createAssetTxn(agent, keypair);

        const did = await gatekeeper.createDID(assetTxn);

        expect(did.length).toBe(60);
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
        const agentTxn = await createAgentTxn(keypair);
        const did = await gatekeeper.createDID(agentTxn);

        const txns = await gatekeeper.exportDID(did);

        expect(txns.length).toBe(1);
        expect(txns[0].did).toStrictEqual(did);
        expect(txns[0].txn).toStrictEqual(agentTxn);
    });

    it('should return empty array on an invalid DID', async () => {
        mockFs({});

        const txns = await gatekeeper.exportDID('mockDID');
        expect(txns).toStrictEqual([]);
    });
});

describe('importDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should import a valid agent DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const did = await gatekeeper.createDID(agentTxn);
        const txns = await gatekeeper.exportDID(did);

        const imported = await gatekeeper.importDID(txns);

        expect(imported).toBe(0);
    });

    it('should import a valid asset DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const agentDID = await gatekeeper.createDID(agentTxn);
        const assetTxn = await createAssetTxn(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetTxn);
        const txns = await gatekeeper.exportDID(assetDID);

        const imported = await gatekeeper.importDID(txns);

        expect(imported).toBe(0);
    });

    it('should report 0 txns reported when DID exists', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const did = await gatekeeper.createDID(agentTxn);
        const doc = await gatekeeper.resolveDID(did);
        const updateTxn = await createUpdateTxn(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateTxn);
        const txns = await gatekeeper.exportDID(did);

        const imported = await gatekeeper.importDID(txns);

        expect(imported).toBe(0);
    });

    it('should report 2 txns imported when DID deleted first', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const did = await gatekeeper.createDID(agentTxn);
        const doc = await gatekeeper.resolveDID(did);
        const updateTxn = await createUpdateTxn(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateTxn);
        const txns = await gatekeeper.exportDID(did);

        fs.rmSync(gatekeeper.dbName);
        const imported = await gatekeeper.importDID(txns);

        expect(imported).toBe(2);
    });

    it('should report N+1 txns imported for N updates', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const did = await gatekeeper.createDID(agentTxn);
        const doc = await gatekeeper.resolveDID(did);

        const N = 20;
        for (let i = 0; i < N; i++) {
            doc.didDocumentMetadata.data = `mock-${i}`;
            const updateTxn = await createUpdateTxn(keypair, did, doc);
            const ok = await gatekeeper.updateDID(updateTxn);
        }

        const txns = await gatekeeper.exportDID(did);

        fs.rmSync(gatekeeper.dbName);
        const imported = await gatekeeper.importDID(txns);

        expect(imported).toBe(N+1);
    });

    it('should resolve an imported DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const did = await gatekeeper.createDID(agentTxn);
        const txns = await gatekeeper.exportDID(did);

        fs.rmSync(gatekeeper.dbName);

        const imported = await gatekeeper.importDID(txns);
        const doc = await gatekeeper.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
    });

    it('should throw an exception on mismatched DID in export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn1 = await createAgentTxn(keypair);
        const did1 = await gatekeeper.createDID(agentTxn1);
        const agentTxn2 = await createAgentTxn(keypair);
        const did2 = await gatekeeper.createDID(agentTxn2);
        const txns = await gatekeeper.exportDID(did1);

        txns[0].did = did2;

        try {
            const imported = await gatekeeper.importDID(txns);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on undefined', async () => {
        mockFs({});

        try {
            const imported = await gatekeeper.importDID();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        mockFs({});

        try {
            const imported = await gatekeeper.importDID('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on an empty array', async () => {
        mockFs({});

        try {
            const imported = await gatekeeper.importDID([]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on an array on non-transactions', async () => {
        mockFs({});

        try {
            const imported = await gatekeeper.importDID([1, 2, 3]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid txn');
        }
    });
});
