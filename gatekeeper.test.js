import mockFs from 'mock-fs';
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper-lib.js';
import * as db_json from './db-json.js';

beforeEach(async () => {
    db_json.start();
    await gatekeeper.start(db_json);
});

afterEach(async () => {
    await gatekeeper.stop();
});

describe('anchorSeed', () => {

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
        const did = await gatekeeper.anchorSeed(mockTxn);

        expect(did.startsWith('did:test:'));
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
        const did1 = await gatekeeper.anchorSeed(mockTxn);
        const did2 = await gatekeeper.anchorSeed(mockTxn);

        expect(did1 === did2).toBe(true);
    });
});

async function createAgentOp(keypair, version = 1, registry = 'local') {
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
            signed: new Date().toISOString(),
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

        expect(did.startsWith('did:test:'));
    });

    it('should create DID for local registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'local');

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:'));
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

        expect(did.startsWith('did:test:'));
    });
});


describe('resolveDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should resolve a valid agent DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: did,
                verificationMethod: [
                    {
                        controller: did,
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: {},
            didDocumentMetadata: {
                created: expect.any(String),
                version: 1,
                confirmed: true,
            },
            mdip: agentOp.mdip,
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should resolve a valid agent DID after an update', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: did,
                verificationMethod: [
                    {
                        controller: did,
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: doc.didDocumentData,
            didDocumentMetadata: {
                created: expect.any(String),
                updated: expect.any(String),
                version: 2,
                confirmed: true,
            },
            mdip: agentOp.mdip,
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve unconfirmed updates when allowed', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm'); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: did,
                verificationMethod: [
                    {
                        controller: did,
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: doc.didDocumentData,
            didDocumentMetadata: {
                created: expect.any(String),
                updated: expect.any(String),
                version: 2,
                confirmed: false,
            },
            mdip: agentOp.mdip,
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve only confirmed updates when specified', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm'); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did, null, true);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: did,
                verificationMethod: [
                    {
                        controller: did,
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: {},
            didDocumentMetadata: {
                created: expect.any(String),
                version: 1,
                confirmed: true,
            },
            mdip: agentOp.mdip,
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve a valid asset DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agent, keypair);
        const did = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(did);
        const expected = {
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                ],
                id: did,
                controller: assetOp.controller,
            },
            didDocumentData: assetOp.data,
            didDocumentMetadata: {
                created: expect.any(String),
                version: 1,
                confirmed: true,
            },
            mdip: assetOp.mdip,
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should not resolve an invalid DID', async () => {
        mockFs({});

        try {
            await gatekeeper.resolveDID();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID([]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID([1, 2, 3]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID({});
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID({ mock: 1 });
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('did:test:xxx');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await gatekeeper.resolveDID('did:test:z3v8Auah2NPDigFc3qKx183QKL6vY8fJYQk6NeLz7KF2RFtC9c8');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid DID');
        }
    });
});

describe('updateDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should update a valid DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);
        doc.didDocumentMetadata.updated = expect.any(String);
        doc.didDocumentMetadata.version = 2;

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(doc);
    });

    it('should return false if update operation is invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        updateOp.doc.didDocumentData = 'mock';
        const ok = await gatekeeper.updateDID(updateOp);

        expect(ok).toBe(false);
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
        //expect(ops[0].did).toStrictEqual(did);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should export a valid updated DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(2);
        //expect(ops[0].did).toStrictEqual(did);
        expect(ops[0].operation).toStrictEqual(agentOp);
        //expect(ops[1].did).toStrictEqual(did);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    it('should return empty array on an invalid DID', async () => {
        mockFs({});

        const ops = await gatekeeper.exportDID('mockDID');
        expect(ops).toStrictEqual([]);
    });
});

describe('importBatch', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should import a valid agent DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        const { verified } = await gatekeeper.importBatch(ops);

        expect(verified).toBe(1);
    });

    it('should import a valid asset DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const ops = await gatekeeper.exportDID(assetDID);

        const { verified } = await gatekeeper.importBatch(ops);

        expect(verified).toBe(1);
    });

    it('should report 0 ops imported when DID exists', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(0);
        expect(verified).toBe(2);
        expect(failed).toBe(0);
    });

    it('should update events when DID is imported from its native registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TESS');
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TESS';
        ops[1].registry = 'TESS';
        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(2);
        expect(verified).toBe(0);
        expect(failed).toBe(0);
    });

    it('should not overwrite events when verified DID is later synced from another registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TESS');
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);
        ops[0].registry = 'TESS';
        ops[1].registry = 'TESS';
        await gatekeeper.importBatch(ops);

        ops[0].registry = 'hyperswarm';
        ops[1].registry = 'hyperswarm';
        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(0);
        expect(verified).toBe(2);
        expect(failed).toBe(0);
    });

    it('should report 2 ops imported when DID deleted first', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(2);
        expect(verified).toBe(0);
        expect(failed).toBe(0);
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
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
        }

        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();
        const { updated, verified, failed } = await gatekeeper.importBatch(ops);

        expect(updated).toBe(N + 1);
        expect(verified).toBe(0);
        expect(failed).toBe(0);
    });

    it('should resolve an imported DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch(ops);
        const doc = await gatekeeper.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
    });

    it('should throw an exception on undefined', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should throw an exception on an empty array', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch([]);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid import');
        }
    });

    it('should report an error on non-transactions', async () => {
        mockFs({});

        const { updated, verified, failed } = await gatekeeper.importBatch([1, 2, 3]);

        expect(updated).toBe(0);
        expect(verified).toBe(0);
        expect(failed).toBe(3);
    });
});
