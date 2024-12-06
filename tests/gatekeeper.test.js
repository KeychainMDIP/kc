import mockFs from 'mock-fs';
import fs from 'fs';
import * as cipher from '@mdip/cipher/node';
import * as gatekeeper from '@mdip/gatekeeper/lib';
import * as db_json from '@mdip/gatekeeper/db/json';
import { InvalidDIDError, ExpectedExceptionError } from '@mdip/common/errors';

const mockConsole = {
    log: () => { },
    error: () => { },
    time: () => { },
    timeEnd: () => { },
}

beforeAll(async () => {
    await db_json.start('test');
    await gatekeeper.start({ db: db_json, console: mockConsole });
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

afterAll(async () => {
    await gatekeeper.stop();
    await db_json.stop();
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

async function createUpdateOp(keypair, did, doc) {
    const current = await gatekeeper.resolveDID(did);
    const cid = current.mdip.opcid;

    const operation = {
        type: "update",
        did,
        cid,
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

async function createDeleteOp(keypair, did) {
    const current = await gatekeeper.resolveDID(did);
    const cid = current.mdip.opcid;

    const operation = {
        type: "delete",
        did,
        cid,
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

async function createAssetOp(agent, keypair, registry = 'local', validUntil = null) {
    const dataAnchor = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry,
            validUntil
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

describe('start', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should throw exception on invalid parameters', async () => {
        mockFs({});

        try {
            await gatekeeper.start();
            throw new ExpectedExceptionError();
        }
        catch (error) {
            expect(error.message).toBe('Invalid parameter: missing options.db');
        }
    });
});

describe('generateDID', () => {

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

        expect(did.startsWith('did:test:')).toBe(true);
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

describe('generateDoc', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should generate an agent doc from a valid anchor', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const doc = await gatekeeper.generateDoc(agentOp);
        const expected = {
            // eslint-disable-next-line
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    // eslint-disable-next-line
                    "https://www.w3.org/ns/did/v1",
                ],
                authentication: [
                    "#key-1",
                ],
                id: expect.any(String),
                verificationMethod: [
                    {
                        controller: expect.any(String),
                        id: "#key-1",
                        publicKeyJwk: agentOp.publicJwk,
                        type: "EcdsaSecp256k1VerificationKey2019",
                    },
                ],
            },
            didDocumentData: {},
            didDocumentMetadata: {
                created: expect.any(String),
            },
            mdip: agentOp.mdip,
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should generate an asset doc from a valid anchor', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agent, keypair);
        const doc = await gatekeeper.generateDoc(assetOp);
        const expected = {
            // eslint-disable-next-line
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    // eslint-disable-next-line
                    "https://www.w3.org/ns/did/v1",
                ],
                id: expect.any(String),
                controller: agent,
            },
            didDocumentData: assetOp.data,
            didDocumentMetadata: {
                created: expect.any(String),
            },
            mdip: assetOp.mdip,
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should return an empty doc if mdip missing from anchor', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        delete agentOp.mdip;
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip version invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 0);
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip type invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        agentOp.mdip.type = 'mock';
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip registry invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'mock');
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });
});

describe('createDID', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from agent operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should create DID for local registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'local');

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should throw exception on invalid version', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 2);

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: mdip.version=2');
        }
    });

    it('should throw exception on invalid registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'mockRegistry');

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: mdip.registry=mockRegistry');
        }
    });

    it('should throw exception on invalid type', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'mockRegistry');
        agentOp.mdip.type = 'mock';

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: mdip.type=mock');
        }
    });

    it('should throw exception on invalid create agent operation', async () => {
        mockFs({});

        try {
            await gatekeeper.createDID();
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: missing');
        }

        const keypair = cipher.generateRandomJwk();

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.type = 'mock';
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: type=mock');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.created = 'mock';
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: created=mock');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.mdip = null;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: mdip');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.created = null;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.signature = null;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.publicJwk = null;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: publicJwk');
        }
    });

    it('should create DID from asset operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agent, keypair);

        const did = await gatekeeper.createDID(assetOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should throw exception on invalid create asset operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);

        try {
            // inconsistent registry
            const assetOp = await createAssetOp(agent, keypair, 'hyperswarm');
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            // Can't let local IDs create assets on other registries
            expect(error.message).toBe('Invalid operation: non-local registry=hyperswarm');
        }

        try {
            // invalid controller
            const assetOp = await createAssetOp(agent, keypair, 'hyperswarm');
            assetOp.controller = 'mock';
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: signer is not controller');
        }

        try {
            // invalid signature
            const assetOp = await createAssetOp(agent, keypair, 'hyperswarm');
            assetOp.signature = null;
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            // invalid validUntil date
            const assetOp = await createAssetOp(agent, keypair, 'hyperswarm', 'mock');
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: mdip.validUntil=mock');
        }
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
            // eslint-disable-next-line
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    // eslint-disable-next-line
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
            mdip: {
                ...agentOp.mdip,
                opcid: expect.any(String),
            }
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
            mdip: {
                ...agentOp.mdip,
                opcid: expect.any(String),
            }
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve confirmed version when specified', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm'); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const expected = await gatekeeper.resolveDID(did);
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const ok = await gatekeeper.updateDID(updateOp);
        const confirmedDoc = await gatekeeper.resolveDID(did, { confirm: true });


        expect(ok).toBe(true);
        expect(confirmedDoc).toStrictEqual(expected);
    });

    it('should resolved cached confirmed version', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const initialDoc = await gatekeeper.resolveDID(did, { confirm: true });
        const cachedDoc = await gatekeeper.resolveDID(did, { confirm: true });

        expect(initialDoc).toStrictEqual(cachedDoc);
    });

    it('should return copies of cached version (confirmed)', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const initialDoc = await gatekeeper.resolveDID(did, { confirm: true });
        const cachedDoc1 = await gatekeeper.resolveDID(did, { confirm: true });
        const cachedDoc2 = await gatekeeper.resolveDID(did, { confirm: true });

        cachedDoc1.didDocumentData = { mock: true };

        expect(cachedDoc2.didDocumentData).toStrictEqual(initialDoc.didDocumentData);
    });

    it('should return copies of cached version (unconfirmed)', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const initialDoc = await gatekeeper.resolveDID(did, { confirm: false });
        const cachedDoc1 = await gatekeeper.resolveDID(did, { confirm: false });
        const cachedDoc2 = await gatekeeper.resolveDID(did, { confirm: false });

        cachedDoc1.didDocumentData = { mock: true };

        expect(cachedDoc2.didDocumentData).toStrictEqual(initialDoc.didDocumentData);
    });

    it('should resolve confirmed version after an update (confirmed cache refresh)', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        await gatekeeper.resolveDID(did, { confirm: true });
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const ok = await gatekeeper.updateDID(updateOp);
        const confirmedDoc = await gatekeeper.resolveDID(did, { confirm: true });

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
            didDocumentData: update.didDocumentData,
            didDocumentMetadata: {
                created: expect.any(String),
                updated: expect.any(String),
                version: 2,
                confirmed: true,
            },
            mdip: {
                ...agentOp.mdip,
                opcid: expect.any(String),
            }
        };

        expect(ok).toBe(true);
        expect(confirmedDoc).toStrictEqual(expected);
    });

    it('should resolve verified version after an update', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        await gatekeeper.resolveDID(did, { confirm: true });
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const ok = await gatekeeper.updateDID(updateOp);
        const verifiedDoc = await gatekeeper.resolveDID(did, { verify: true });

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
            didDocumentData: update.didDocumentData,
            didDocumentMetadata: {
                created: expect.any(String),
                updated: expect.any(String),
                version: 2,
                confirmed: true,
            },
            mdip: {
                ...agentOp.mdip,
                opcid: expect.any(String),
            }
        };

        expect(ok).toBe(true);
        expect(verifiedDoc).toStrictEqual(expected);
    });

    it('should resolve unconfirmed version when specified', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm'); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did, { confirm: false });
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
            didDocumentData: update.didDocumentData,
            didDocumentMetadata: {
                created: expect.any(String),
                updated: expect.any(String),
                version: 2,
                confirmed: false,
            },
            mdip: {
                ...agentOp.mdip,
                opcid: expect.any(String),
            }
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve version at specified time', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        let expected;

        // Add 10 versions, save one from the middle
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);

            if (i === 5) {
                expected = update;
            }

            update.didDocumentData = { mock: 1 };
            const updateOp = await createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        const doc = await gatekeeper.resolveDID(did, { atTime: expected.didDocumentMetadata.updated });
        expect(doc).toStrictEqual(expected);
    });

    it('should resolve specified version', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        let expected;

        // Add 10 versions, save one from the middle
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);

            if (i === 5) {
                expected = update;
            }

            update.didDocumentData = { mock: 1 };
            const updateOp = await createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        const doc = await gatekeeper.resolveDID(did, { atVersion: expected.didDocumentMetadata.version });
        expect(doc).toStrictEqual(expected);
    });

    it('should resolve all specified versions', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        // Add 10 versions
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);
            update.didDocumentData = { mock: 1 };
            const updateOp = await createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        for (let i = 0; i < 10; i++) {
            const doc = await gatekeeper.resolveDID(did, { atVersion: i + 1 });
            expect(doc.didDocumentMetadata.version).toBe(i + 1);
        }
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
            mdip: {
                ...assetOp.mdip,
                opcid: expect.any(String),
            }
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should not resolve an invalid DID', async () => {
        mockFs({});

        try {
            await gatekeeper.resolveDID();
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID('');
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID('mock');
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID([]);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID([1, 2, 3]);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID({});
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID({ mock: 1 });
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID('did:test:xxx');
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await gatekeeper.resolveDID('did:test:z3v8Auah2NPDigFc3qKx183QKL6vY8fJYQk6NeLz7KF2RFtC9c8');
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });

    it('should throw an exception on invalid signature in create op', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const events = await db_json.getEvents(did);
        // changing anything in the op will invalidate the signature
        events[0].operation.did = 'mock';
        await db_json.setEvents(did, events);

        try {
            await gatekeeper.resolveDID(did, { verify: true });
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });

    it('should throw an exception on invalid signature in update op', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const events = await db_json.getEvents(did);
        // changing anything in the op will invalidate the signature
        events[1].operation.did = 'mock';
        await db_json.setEvents(did, events);

        try {
            await gatekeeper.resolveDID(did, { verify: true });
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });

    it('should throw an exception on invalid operation cid in update op', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc1 = await gatekeeper.resolveDID(did);
        doc1.didDocumentData = { mock: 1 };
        const updateOp1 = await createUpdateOp(keypair, did, doc1);
        await gatekeeper.updateDID(updateOp1);
        const doc2 = await gatekeeper.resolveDID(did);
        doc2.didDocumentData = { mock: 2 };
        const updateOp2 = await createUpdateOp(keypair, did, doc2);
        await gatekeeper.updateDID(updateOp2);

        const events = await db_json.getEvents(did);
        // if we swap update events the sigs will be valid but the cid will be invalid
        [events[1], events[2]] = [events[2], events[1]];
        await db_json.setEvents(did, events);

        try {
            await gatekeeper.resolveDID(did, { verify: true });
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: cid');
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
        doc.mdip.opcid = expect.any(String);

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(doc);
    });

    it('should increment version with each update', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        for (let i = 0; i < 10; i++) {
            doc.didDocumentData = { mock: i };
            const updateOp = await createUpdateOp(keypair, did, doc);
            const ok = await gatekeeper.updateDID(updateOp);
            const updatedDoc = await gatekeeper.resolveDID(did);

            expect(ok).toBe(true);
            expect(updatedDoc.didDocumentMetadata.version).toBe(i + 2);
        }
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

    it('should throw exception on invalid update operation', async () => {
        mockFs({});

        try {
            const keypair = cipher.generateRandomJwk();
            const agentOp = await createAgentOp(keypair);
            const did = await gatekeeper.createDID(agentOp);
            const doc = await gatekeeper.resolveDID(did);
            const updateOp = await createUpdateOp(keypair, did, doc);
            delete updateOp.signature;
            await gatekeeper.updateDID(updateOp);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });

    it('should verify DID that has been updated multiple times', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        for (let i = 0; i < 10; i++) {
            doc.didDocumentData = { mock: i };
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
        }

        const doc2 = await gatekeeper.resolveDID(did, { verify: true });
        expect(doc2.didDocumentMetadata.version).toBe(11);
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
        expect(ops[0].operation).toStrictEqual(agentOp);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    // eslint-disable-next-line
    it('should return empty array on an invalid DID', async () => {
        mockFs({});

        const ops = await gatekeeper.exportDID('mockDID');
        expect(ops).toStrictEqual([]);
    });
});

describe('exportDIDs', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should export valid DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportDIDs([did]);
        const ops = exports[0];

        expect(ops.length).toBe(1);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should export all DIDs', async () => {
        mockFs({});

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
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);

        const exports = await gatekeeper.exportDIDs([assetDID, agentDID]);

        expect(exports.length).toBe(2);
        expect(exports[0][0].operation).toStrictEqual(assetOp);
        expect(exports[1][0].operation).toStrictEqual(agentOp);
    });

    it('should export valid updated DIDs', async () => {
        mockFs({});

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
        mockFs({});

        const exports = await gatekeeper.exportDIDs(['mockDID']);
        const ops = exports[0];
        expect(ops).toStrictEqual([]);
    });
});

describe('importDIDs', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should import a valid agent DID export', async () => {
        mockFs({});

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

    afterEach(() => {
        mockFs.restore();
    });

    it('should remove a valid DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ok = await gatekeeper.removeDIDs([did]);

        expect(ok).toBe(true);

        try {
            await gatekeeper.resolveDID(did);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });

    it('should throw an exception if no array specified', async () => {
        mockFs({});

        try {
            await gatekeeper.removeDIDs();
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid parameter: dids');
        }
    });

    it('should return true if no DID specified remove', async () => {
        mockFs({});

        const ok = await gatekeeper.removeDIDs([]);
        expect(ok).toBe(true);
    });

    it('should return true if unknown DIDs specified', async () => {
        mockFs({});

        const ok = await gatekeeper.removeDIDs(['did:test:mock']);
        expect(ok).toBe(true);
    });
});

describe('exportBatch', () => {
    // local DIDs are excluded from exportBatch so we'll create on hyperswarm

    afterEach(() => {
        mockFs.restore();
    });

    it('should export a valid batch', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm');
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportBatch([did]);

        expect(exports.length).toBe(1);
        expect(exports[0].operation).toStrictEqual(agentOp);
    });

    it('should export batch with all DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm');
        const agentDID = await gatekeeper.createDID(agentOp);

        for (let i = 0; i < 5; i++) {
            const assetOp = await createAssetOp(agentDID, keypair, 'hyperswarm');
            await gatekeeper.createDID(assetOp);
        }

        const exports = await gatekeeper.exportBatch();

        expect(exports.length).toBe(6);
    });

    it('should export a valid updated batch', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm');
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
        mockFs({});

        const exports = await gatekeeper.exportBatch(['mockDID']);
        expect(exports).toStrictEqual([]);
    });
});

describe('importBatch', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should queue a valid agent DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
    });

    it('should report when event already processed', async () => {
        mockFs({});

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
        mockFs({});

        try {
            await gatekeeper.importBatch();
            throw new ExpectedExceptionError();
        } catch (error) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch('mock');
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on an empty array', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch([]);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should report an error on non-transactions', async () => {
        mockFs({});

        const response = await gatekeeper.importBatch([1, 2, 3]);

        expect(response.rejected).toBe(3);
    });

    it('should report an error on invalid event time', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].time = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation type', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.type = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing created time', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.created;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing mdip metadata', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.mdip;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip version', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip.version = -1;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip type', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip.type = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip.registry = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing operation signature', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.signature;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature date', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature.signed = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature hash', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature.hash = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature signer', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature.signer = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing operation key', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.publicJwk;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on incorrect controller', async () => {
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const deleteOp = await createDeleteOp(keypair, did);
        await gatekeeper.deleteDID(deleteOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[1].operation.did;

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
    });
});

describe('processEvents', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should import a valid agent DID export', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(1);
    });

    it('should import a valid asset DID export', async () => {
        mockFs({});

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
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        // create on hyperswarm because exportBatch will not export local DIDs
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm');
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair, 'hyperswarm');
        await gatekeeper.createDID(assetOp);
        const batch = await gatekeeper.exportBatch();

        await gatekeeper.importBatch(batch);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(2);
    });

    it('should import a batch export with missing event dids', async () => {
        // This simulates an import from hyperswarm-mediator which receives only operations and creates events without DIDs
        // (TBD revisit whether events should be created with DIDs in advance of import)
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        // create on hyperswarm because exportBatch will not export local DIDs
        const agentOp = await createAgentOp(keypair, 1, 'hyperswarm');
        const agentDID = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(agentDID);
        const updateOp = await createUpdateOp(keypair, agentDID, doc);
        await gatekeeper.updateDID(updateOp);
        const assetOp = await createAssetOp(agentDID, keypair, 'hyperswarm');
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
        mockFs({});

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
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TFTC');
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(2);
        expect(response.merged).toBe(0);
    });

    it('should resolve as confirmed when DID is imported from its native registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TFTC');
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

        expect(doc2.didDocumentMetadata.version).toBe(2);
        expect(doc2.didDocumentMetadata.confirmed).toBe(true);
    });

    it('should not overwrite events when verified DID is later synced from another registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TFTC');
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
        mockFs({});

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
        mockFs({});

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

        for (let i = 0; i < events.length-1; i++) {
            const opcid1 = await gatekeeper.generateCID(events[i].operation);
            const opcid2 = events[i+1].operation.cid;
            const equal = opcid1 === opcid2;
            console.log(opcid1, opcid2, equal);
        }

        await gatekeeper.resolveDID(did, { verify: true });
        await gatekeeper.resetDb();

        const { queued, rejected } = await gatekeeper.importBatch(events);
        expect(queued).toBe(N + 1);
        expect(rejected).toBe(0);

        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(N + 1);
        expect(response.merged).toBe(0);
    });

    it('should resolve an imported DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();
        const doc = await gatekeeper.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
    });

    it('should handle processing events in any order', async () => {
        mockFs({});

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

    it('should handle deferred operation validation when asset ownership changes', async () => {
        mockFs({});

        const keypair1 = cipher.generateRandomJwk();
        const agentOp1 = await createAgentOp(keypair1, 1, 'TFTC');
        const agentDID1 = await gatekeeper.createDID(agentOp1);

        const keypair2 = cipher.generateRandomJwk();
        const agentOp2 = await createAgentOp(keypair2, 1, 'TFTC');
        const agentDID2 = await gatekeeper.createDID(agentOp2);

        const assetOp = await createAssetOp(agentDID1, keypair1, 'TFTC');
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc1 = await gatekeeper.resolveDID(assetDID);

        // agent1 transfers ownership of asset to agent2
        assetDoc1.didDocument.controller = agentDID2;
        const updateOp1 = await createUpdateOp(keypair1, assetDID, assetDoc1);
        await gatekeeper.updateDID(updateOp1);

        // agent2 transfers ownership of asset back to agent1
        assetDoc1.didDocument.controller = agentDID1;
        const updateOp2 = await createUpdateOp(keypair2, assetDID, assetDoc1);
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const events = dids.flat();
        await gatekeeper.resetDb();
        await gatekeeper.importBatch(events);

        const response1 = await gatekeeper.processEvents();
        expect(response1.added).toBe(events.length);

        const assetDoc2 = await gatekeeper.resolveDID(assetDID);
        expect(assetDoc2.didDocumentMetadata.version).toBe(3);
        expect(assetDoc2.didDocumentMetadata.confirmed).toBe(false);

        for (const event of events) {
            event.registry = 'TFTC';
        }

        await gatekeeper.importBatch(events);

        const response2 = await gatekeeper.processEvents();
        expect(response2.added).toBe(events.length);

        const assetDoc3 = await gatekeeper.resolveDID(assetDID);
        expect(assetDoc3.didDocumentMetadata.version).toBe(3);
        expect(assetDoc3.didDocumentMetadata.confirmed).toBe(true);
    });
});

describe('getQueue', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return empty list when no events in queue', async () => {
        mockFs({});

        const registry = 'TFTC';

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([]);
    });

    it('should return single event in queue', async () => {
        mockFs({});

        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([updateOp]);
    });

    it('should throw an exception if invalid registry', async () => {
        mockFs({});

        try {
            await gatekeeper.getQueue('mock');
            throw new ExpectedExceptionError();
        } catch (error) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: registry=mock');
        }
    });
});

describe('clearQueue', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should clear non-empty queue', async () => {
        mockFs({});

        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
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
        mockFs({});

        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
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
        mockFs({});

        const ok = await gatekeeper.clearQueue('TFTC', []);
        expect(ok).toBe(true);
    });

    it('should return true if invalid queue specified', async () => {
        mockFs({});

        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, registry);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);
        await gatekeeper.clearQueue(registry, queue);
        await gatekeeper.getQueue(registry);

        const ok = await gatekeeper.clearQueue(registry, 'mock');

        expect(ok).toStrictEqual(true);
    });

    it('should throw an exception if invalid registry', async () => {
        mockFs({});

        try {
            await gatekeeper.clearQueue('mock', []);
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid parameter: registry=mock');
        }
    });
});

describe('getDids', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return all DIDs', async () => {
        mockFs({});

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
        mockFs({});

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
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TFTC');
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
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, 1, 'TFTC');
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
        mockFs({});

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
        const recentDIDs = await gatekeeper.getDIDs({ updatedAfter: doc.didDocumentMetadata.created });

        expect(recentDIDs.length).toBe(5);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
        expect(recentDIDs.includes(dids[8])).toBe(true);
        expect(recentDIDs.includes(dids[9])).toBe(true);
    });

    it('should return all DIDs before specified time', async () => {
        mockFs({});

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
        const recentDIDs = await gatekeeper.getDIDs({ updatedBefore: doc.didDocumentMetadata.created });

        expect(recentDIDs.length).toBe(6);
        expect(recentDIDs.includes(agentDID)).toBe(true);
        expect(recentDIDs.includes(dids[0])).toBe(true);
        expect(recentDIDs.includes(dids[1])).toBe(true);
        expect(recentDIDs.includes(dids[2])).toBe(true);
        expect(recentDIDs.includes(dids[3])).toBe(true);
        expect(recentDIDs.includes(dids[4])).toBe(true);
    });

    it('should return all DIDs between specified times', async () => {
        mockFs({});

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
            updatedAfter: doc3.didDocumentMetadata.created,
            updatedBefore: doc8.didDocumentMetadata.created
        });

        expect(recentDIDs.length).toBe(4);
        expect(recentDIDs.includes(dids[4])).toBe(true);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
    });

    it('should resolve all specified DIDs', async () => {
        mockFs({});

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

describe('initRegistries', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should default to valid registries', async () => {
        mockFs({});

        const registries = await gatekeeper.initRegistries();

        expect(registries.length).toBe(5);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
        expect(registries.includes('TBTC')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
    });

    it('should parse supported registries', async () => {
        mockFs({});

        const registries = await gatekeeper.initRegistries("local, hyperswarm");

        expect(registries.length).toBe(2);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
    });

    it('should parse supported registries with extra whitespace', async () => {
        mockFs({});

        const registries = await gatekeeper.initRegistries("   local,    hyperswarm    ");

        expect(registries.length).toBe(2);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
    });

    it('should throw an exception on invalid registries', async () => {
        mockFs({});

        try {
            await gatekeeper.initRegistries("local, hyperswarm, mock");
            throw new ExpectedExceptionError();
        } catch (error) {
            expect(error.message).toBe('Invalid parameter: registry=mock');
        }
    });
});

describe('listRegistries', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of valid registries', async () => {
        mockFs({});

        await gatekeeper.initRegistries();
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(5);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
        expect(registries.includes('TBTC')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
    });

    it('should return list of configured registries', async () => {
        mockFs({});

        await gatekeeper.initRegistries("hyperswarm, TFTC");
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(2);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
    });
});

describe('verifyDb', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should verify all DIDs in db', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(2);
        expect(expired).toBe(0);
        expect(invalid).toBe(0);
        expect(total).toBe(2);
    });

    it('should get same results with cached verifications', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const verify1 = await gatekeeper.verifyDb();
        const verify2 = await gatekeeper.verifyDb();

        expect(verify1).toStrictEqual(verify2);
    });

    it('should get same results with chatty turned off', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const verify1 = await gatekeeper.verifyDb();
        const verify2 = await gatekeeper.verifyDb({ chatty: false });

        expect(verify1).toStrictEqual(verify2);
    });

    it('should remove invalid DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(assetDID);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, assetDID, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        expect(ok).toBe(true);

        // Can't verify a DID that has been updated if the controller is removed
        await gatekeeper.removeDIDs([agentDID]);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(0);
        expect(expired).toBe(0);
        expect(invalid).toBe(1);
        expect(total).toBe(1);
    });

    it('should remove expired DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        // create asset that should expire
        const validUntil = new Date().toISOString();
        const assetOp1 = await createAssetOp(agentDID, keypair, 'local', validUntil);
        await gatekeeper.createDID(assetOp1);

        // create asset that expires later
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // Add 1 hour
        const assetOp3 = await createAssetOp(agentDID, keypair, 'local', expires.toISOString());
        await gatekeeper.createDID(assetOp3);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(2);
        expect(expired).toBe(1);
        expect(invalid).toBe(0);
        expect(total).toBe(3);
    });
});

describe('checkDb', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should check all DIDs in db', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const { total } = await gatekeeper.checkDb();

        expect(total).toBe(2);
    });

    it('should reset a corrupted db', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        fs.writeFileSync('data/test.json', "{ dids: {");

        const { total } = await gatekeeper.checkDb();

        expect(total).toBe(0);
    });
});
