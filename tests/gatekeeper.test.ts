import mockFs from 'mock-fs';
import fs from 'fs';
import CipherNode from '@mdip/cipher/node';
import { Operation, MdipDocument } from '@mdip/gatekeeper/types';
import Gatekeeper from '@mdip/gatekeeper';
import DbJson from '@mdip/gatekeeper/db/json';
import { copyJSON, isValidDID, compareOrdinals } from '@mdip/common/utils';
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
const db_json = new DbJson('test');
const ipfs = new HeliaClient();
const gatekeeper = new Gatekeeper({ db: db_json, ipfs, console: mockConsole, registries: ['local', 'hyperswarm', 'TFTC'] });

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
    } = {}
): Promise<Operation> {
    const { excludePrevid = false, mockPrevid } = options;
    const current = await gatekeeper.resolveDID(did);
    const previd = excludePrevid ? undefined : mockPrevid ? mockPrevid : current.didDocumentMetadata?.versionId;

    const operation: Operation = {
        type: "update",
        did,
        previd,
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

describe('constructor', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should throw exception on invalid parameters', async () => {
        mockFs({});

        try {
            // @ts-expect-error Testing invalid usage
            new Gatekeeper();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: missing options.db');
        }

        try {
            new Gatekeeper({ db: db_json, registries: ['hyperswarm', 'bogus_reg'] });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: registry=bogus_reg');
        }
    });
});

describe('generateDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from operation', async () => {
        mockFs({});

        const mockTxn: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                registry: "mockRegistry",
                type: 'agent',
                version: 1,
            }
        };
        const did = await gatekeeper.generateDID(mockTxn);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should create DID from operation with configured prefix', async () => {
        mockFs({});

        const mockTxn: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
                registry: "mockRegistry"
            }
        };

        const gatekeeper = new Gatekeeper({ db: db_json, console: mockConsole, didPrefix: 'did:mock' });
        const did = await gatekeeper.generateDID(mockTxn);

        expect(did.startsWith('did:mock:')).toBe(true);
    });

    it('should create DID from operation with custom prefix', async () => {
        mockFs({});

        const mockTxn: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
                registry: "mockRegistry",
                prefix: "did:custom"
            }
        };

        const did = await gatekeeper.generateDID(mockTxn);

        expect(did.startsWith('did:custom:')).toBe(true);
    });

    it('should create same DID from same operation with date included', async () => {
        mockFs({});

        const mockTxn: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
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
        const did = await gatekeeper.generateDID(agentOp);
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
                id: did,
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

    it('should generate an agent doc with a custom prefix', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { prefix: 'did:custom' });
        const did = await gatekeeper.generateDID(agentOp);
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
                id: did,
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
                canonicalId: did,
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
        const did = await gatekeeper.generateDID(assetOp);
        const doc = await gatekeeper.generateDoc(assetOp);
        const expected = {
            // eslint-disable-next-line
            "@context": "https://w3id.org/did-resolution/v1",
            didDocument: {
                "@context": [
                    // eslint-disable-next-line
                    "https://www.w3.org/ns/did/v1",
                ],
                id: did,
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
        const agentOp = await createAgentOp(keypair, { version: 0 });
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip type invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        // @ts-expect-error Testing invalid usage
        agentOp.mdip!.type = 'mock';
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip registry invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'mock' });
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
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'local' });

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should throw exception on invalid version', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 2 });

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.version=2');
        }
    });

    it('should throw exception on invalid registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'mockRegistry' });

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.registry=mockRegistry');
        }
    });

    it('should throw exception on unsupported registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'TFTC' });

        const gatekeeper = new Gatekeeper({ db: db_json, console: mockConsole, registries: ['hyperswarm'] });

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.registry=TFTC');
        }
    });

    it('should throw exception on invalid type', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'mockRegistry' });
        // @ts-expect-error Testing invalid usage
        agentOp.mdip!.type = 'mock';

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.type=mock');
        }
    });

    it('should throw exception on invalid create agent operation', async () => {
        mockFs({});

        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.createDID();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: missing');
        }

        const keypair = cipher.generateRandomJwk();

        try {
            const agentOp = await createAgentOp(keypair);
            // @ts-expect-error Testing invalid usage
            agentOp.type = 'mock';
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: type=mock');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.created = 'mock';
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: created=mock');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.mdip = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.created = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: created=undefined');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.signature = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            const agentOp = await createAgentOp(keypair);
            agentOp.publicJwk = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: publicJwk');
        }
    });

    it('should throw exception on create op size exceeding limit', async () => {
        mockFs({});

        const gk = new Gatekeeper({ db: db_json, console: mockConsole, maxOpBytes: 100 });
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);

        try {
            await gk.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: size');
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
            const assetOp = await createAssetOp(agent, keypair, { registry: 'hyperswarm' });
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // Can't let local IDs create assets on other registries
            expect(error.message).toBe('Invalid operation: non-local registry=hyperswarm');
        }

        try {
            // invalid controller
            const assetOp = await createAssetOp(agent, keypair, { registry: 'hyperswarm' });
            assetOp.controller = 'mock';
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signer is not controller');
        }

        try {
            // invalid signature
            const assetOp = await createAssetOp(agent, keypair, { registry: 'hyperswarm' });
            assetOp.signature = undefined;
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            // invalid validUntil date
            const assetOp = await createAssetOp(agent, keypair, { registry: 'hyperswarm', validUntil: 'mock' });
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.validUntil=mock');
        }
    });

    it('should throw exception when registry queue exceeds limit', async () => {
        mockFs({});

        const gk = new Gatekeeper({ db: db_json, console: mockConsole, maxQueueSize: 5, registries: ['hyperswarm', 'TFTC'] });

        try {
            for (let i = 0; i < 10; i++) {
                const keypair = cipher.generateRandomJwk();
                const agentOp = await createAgentOp(keypair, { registry: 'TFTC' });
                await gk.createDID(agentOp);
            }
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: hyperswarm not supported');
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
        const opid = await gatekeeper.generateCID(agentOp);
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
                versionId: opid
            },
            mdip: agentOp.mdip
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
        const opid = await gatekeeper.generateCID(updateOp);
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
                versionId: opid
            },
            mdip: agentOp.mdip
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve confirmed version when specified', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' }); // Specify hyperswarm registry for this agent
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

    it('should resolve verified version after an update', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        await gatekeeper.resolveDID(did, { confirm: true });
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const opid = await gatekeeper.generateCID(updateOp);
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
                versionId: opid
            },
            mdip: agentOp.mdip
        };

        expect(ok).toBe(true);
        expect(verifiedDoc).toStrictEqual(expected);
    });

    it('should resolve unconfirmed version when specified', async () => {

        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' }); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, did, update);
        const opid = await gatekeeper.generateCID(updateOp);
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
                versionId: opid
            },
            mdip: agentOp.mdip
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

        const doc = await gatekeeper.resolveDID(did, { atTime: expected!.didDocumentMetadata!.updated });
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

        const doc = await gatekeeper.resolveDID(did, { atVersion: expected!.didDocumentMetadata!.version });
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
            expect(doc.didDocumentMetadata!.version).toBe(i + 1);
        }
    });

    it('should resolve a valid asset DID', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agent, keypair);
        delete assetOp.mdip!.validUntil;
        const opid = await gatekeeper.generateCID(assetOp);
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
                versionId: opid
            },
            mdip: assetOp.mdip
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should not resolve an invalid DID', async () => {
        mockFs({});

        const BadFormat = 'bad format';

        try {
            await gatekeeper.resolveDID();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            await gatekeeper.resolveDID('');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            await gatekeeper.resolveDID('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.resolveDID([]);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.resolveDID([1, 2, 3]);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.resolveDID({});
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.resolveDID({ mock: 1 });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            await gatekeeper.resolveDID('did:test:xxx');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe(BadFormat);
        }

        try {
            await gatekeeper.resolveDID('did:test:z3v8Auah2NPDigFc3qKx183QKL6vY8fJYQk6NeLz7KF2RFtC9c8');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe('unknown');
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
        } catch (error: any) {
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
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });

    it('should throw an exception on invalid operation previd in update op', async () => {
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
        // if we swap update events the sigs will be valid but the previd will be invalid
        [events[1], events[2]] = [events[2], events[1]];
        await db_json.setEvents(did, events);

        try {
            await gatekeeper.resolveDID(did, { verify: true });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: previd');
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
        const opid = await gatekeeper.generateCID(updateOp);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);
        doc.didDocumentMetadata!.updated = expect.any(String);
        doc.didDocumentMetadata!.version = 2;
        doc.didDocumentMetadata!.versionId = opid;

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
            expect(updatedDoc.didDocumentMetadata!.version).toBe(i + 2);
        }
    });

    it('should return false if update operation is invalid', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        updateOp.doc!.didDocumentData = 'mock';
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
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });

    it('should throw exception on update op size exceeding limit', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        try {
            const gk = new Gatekeeper({ db: db_json, console: mockConsole, maxOpBytes: 100 });
            const updateOp = await createUpdateOp(keypair, did, doc);
            await gk.updateDID(updateOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: size');
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
        expect(doc2.didDocumentMetadata!.version).toBe(11);
    });

    it('should throw exception when registry queue exceeds limit', async () => {
        mockFs({});

        const gk = new Gatekeeper({ db: db_json, console: mockConsole, maxQueueSize: 5, registries: ['hyperswarm', 'TFTC'] });

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { registry: 'TFTC' });

        const did = await gk.createDID(agentOp);
        const doc = await gk.resolveDID(did);

        try {
            for (let i = 0; i < 10; i++) {
                doc.didDocumentData = { mock: i };
                const updateOp = await createUpdateOp(keypair, did, doc);
                await gk.updateDID(updateOp);
            }
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: TFTC not supported');
        }
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
        } catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
            expect(error.detail).toBe('unknown');
        }
    });

    it('should throw an exception if no array specified', async () => {
        mockFs({});

        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.removeDIDs();
            throw new ExpectedExceptionError();
        } catch (error: any) {
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
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportBatch([did]);

        expect(exports.length).toBe(1);
        expect(exports[0].operation).toStrictEqual(agentOp);
    });

    it('should export batch with all DIDs', async () => {
        mockFs({});

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
        mockFs({});

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
            // @ts-expect-error Testing invalid usage
            await gatekeeper.importBatch();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        mockFs({});

        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.importBatch('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on an empty array', async () => {
        mockFs({});

        try {
            await gatekeeper.importBatch([]);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should report an error on non-transactions', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage
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

        // @ts-expect-error Testing invalid usage
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

        (ops[0].operation.type as any) = 'mock';

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

        ops[0].operation.mdip!.version = -1;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip type', async () => {
        mockFs({});

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
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip!.registry = 'mock';

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

        ops[0].operation.signature!.signed = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature hash', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.hash = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature signer', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.signer = 'mock';

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
        mockFs({});

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

        // Also check that blockchain info is added to document metadata for resolveDID coverage...
        const doc2 = await gatekeeper.resolveDID(did);
        expect(doc2.mdip!.registration).toStrictEqual(ops[2].blockchain);
    });

    it('should resolve as confirmed when DID is imported from its native registry', async () => {
        mockFs({});

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

    it('should not overwrite events when verified DID is later synced from another registry', async () => {
        mockFs({});

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

        expect(doc.didDocument!.id).toBe(did);
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

    it('should handle processing pre-v0.5 event without previd property', async () => {
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

        const gk = new Gatekeeper({ db: db_json, console: mockConsole });
        // @ts-expect-error Testing private state
        gk.isProcessingEvents = true;
        const response = await gk.processEvents();

        expect(response.busy).toBe(true);
    });

    it('should gracefully handle expections', async () => {
        mockFs({});

        const gk = new Gatekeeper({ db: db_json, console: mockConsole });
        // @ts-expect-error Testing private state
        gk.eventsQueue = null;
        const response = await gk.processEvents();

        expect(response.added).toBe(0);
        expect(response.merged).toBe(0);
        expect(response.rejected).toBe(0);
        expect(response.pending).toBe(0);
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
        mockFs({});

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
    afterEach(() => {
        mockFs.restore();
    });

    it('should clear non-empty queue', async () => {
        mockFs({});

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
        mockFs({});

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
        mockFs({});

        const ok = await gatekeeper.clearQueue('TFTC', []);
        expect(ok).toBe(true);
    });

    it('should return true if invalid queue specified', async () => {
        mockFs({});

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
        mockFs({});

        try {
            await gatekeeper.clearQueue('mock', []);
            throw new ExpectedExceptionError();
        } catch (error: any) {
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
        mockFs({});

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
        const recentDIDs = await gatekeeper.getDIDs({ updatedAfter: doc.didDocumentMetadata!.created });

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

describe('listRegistries', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of default valid registries', async () => {
        mockFs({});

        const gatekeeper = new Gatekeeper({ db: db_json, console: mockConsole });
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(1);
        expect(registries.includes('local')).toBe(true);
    });

    it('should return list of configured registries', async () => {
        mockFs({});

        const gatekeeper = new Gatekeeper({ db: db_json, console: mockConsole, registries: ['hyperswarm', 'TFTC'] });
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(2);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
    });

    it('should return list of inferred registries', async () => {
        mockFs({});

        const gatekeeper = new Gatekeeper({ db: db_json, console: mockConsole });
        await gatekeeper.getQueue('hyperswarm');
        await gatekeeper.getQueue('TFTC');
        await gatekeeper.getQueue('TBTC');
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(4);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
        expect(registries.includes('TBTC')).toBe(true);
    });

    it('should return non-redundant list of inferred registries', async () => {
        mockFs({});

        const gatekeeper = new Gatekeeper({ db: db_json, console: mockConsole });
        await gatekeeper.getQueue('hyperswarm');
        await gatekeeper.getQueue('hyperswarm');
        await gatekeeper.getQueue('TFTC');
        await gatekeeper.getQueue('TFTC');
        await gatekeeper.getQueue('TBTC');
        await gatekeeper.getQueue('TBTC');
        await gatekeeper.getQueue('TBTC');
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(4);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
        expect(registries.includes('TBTC')).toBe(true);
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
        const assetOp1 = await createAssetOp(agentDID, keypair, { registry: 'local', validUntil });
        await gatekeeper.createDID(assetOp1);

        // create asset that expires later
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // Add 1 hour
        const assetOp3 = await createAssetOp(agentDID, keypair, { registry: 'local', validUntil: expires.toISOString() });
        await gatekeeper.createDID(assetOp3);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(2);
        expect(expired).toBe(1);
        expect(invalid).toBe(0);
        expect(total).toBe(3);
    });
});

describe('checkDIDs', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should check all DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair, { registry: 'local', validUntil: new Date().toISOString() });
        await gatekeeper.createDID(assetOp);

        const check = await gatekeeper.checkDIDs({ chatty: true });

        expect(check.total).toBe(2);
        expect(check.byType.agents).toBe(1);
        expect(check.byType.assets).toBe(1);
        expect(check.byType.ephemeral).toBe(1);
        expect(check.byType.invalid).toBe(0);
        expect(check.byRegistry['local']).toBe(2);
        expect(check.byVersion[1]).toBe(2);
    });

    it('should report unconfirmed DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        const assetDID = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(assetDID);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, assetDID, doc);
        const ok = await gatekeeper.updateDID(updateOp);

        const check = await gatekeeper.checkDIDs({ chatty: true });

        expect(ok).toBe(true);
        expect(check.total).toBe(2);
        expect(check.byType.agents).toBe(1);
        expect(check.byType.assets).toBe(1);
        expect(check.byType.confirmed).toBe(1);
        expect(check.byType.unconfirmed).toBe(1);
        expect(check.byType.ephemeral).toBe(0);
        expect(check.byType.invalid).toBe(0);
        expect(check.byRegistry['hyperswarm']).toBe(2);
        expect(check.byVersion[1]).toBe(1);
        expect(check.byVersion[2]).toBe(1);
    });

    it('should report invalid DIDs', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const dids = await gatekeeper.getDIDs();
        dids.push('mock');

        // @ts-expect-error Testing invalid usage
        const check = await gatekeeper.checkDIDs({ chatty: true, dids });

        expect(check.total).toBe(3);
        expect(check.byType.invalid).toBe(1);
    });

    it('should reset a corrupted db', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        fs.writeFileSync('data/test.json', "{ dids: {");

        const { total } = await gatekeeper.checkDIDs();

        expect(total).toBe(0);
    });
});


describe('gatekeeper.db', () => {
    it('getEvents should return empty list on invalid did', async () => {
        // @ts-expect-error Testing invalid DID
        const events = await gatekeeper.db.getEvents(null);

        expect(events).toStrictEqual([]);
    });

    it('addEvent should throw exception on invalid did', async () => {
        try {
            // @ts-expect-error Testing invalid DID
            await gatekeeper.db.addEvent(null);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid DID');
        }
    });

    it('setEvents should throw exception on invalid did', async () => {
        try {
            // @ts-expect-error Testing invalid DID
            await gatekeeper.db.setEvents(null);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid DID');
        }
    });

    it('getQueue should return empty list invalid registry', async () => {
        // @ts-expect-error Testing invalid registry
        const queue1 = await gatekeeper.db.getQueue('mock');
        expect(queue1).toStrictEqual([]);

        // @ts-expect-error Testing invalid registry
        await gatekeeper.db.queueOperation('hyperswarm', {});
        // @ts-expect-error Testing invalid registry
        const queue2 = await gatekeeper.db.getQueue('mock');
        expect(queue2).toStrictEqual([]);
    });

    it('clearQueue should return true on unknown registry', async () => {
        // @ts-expect-error Testing unknown registry
        await gatekeeper.db.queueOperation('hyperswarm', {});
        // @ts-expect-error Testing unknown registry
        const ok = await gatekeeper.db.clearQueue('mock');
        expect(ok).toBe(true);
    });
});

describe('compareOrdinals', () => {
    it('should return -1 when a < b', async () => {

        const a = [444, 555, 666, 777];
        const b = [444, 555, 777, 888];

        const result = compareOrdinals(a, b);

        expect(result).toBe(-1);
    });

    it('should return 1 when a > b', async () => {

        const a = [444, 555, 666, 777];
        const b = [444, 555, 777, 888];

        const result = compareOrdinals(b, a);

        expect(result).toBe(1);
    });

    it('should return 0 when a = b', async () => {

        const a = [444, 555, 666, 777];

        const result = compareOrdinals(a, a);

        expect(result).toBe(0);
    });

    it('should return -1 when a = b and b in longer', async () => {

        const a = [444, 555, 666, 777];
        const b = [444, 555, 666, 777, 888];

        const result = compareOrdinals(a, b);

        expect(result).toBe(-1);
    });

    it('should return 1 when a = b and a in longer', async () => {

        const a = [444, 555, 666, 777, 888];
        const b = [444, 555, 666, 777];

        const result = compareOrdinals(a, b);

        expect(result).toBe(1);
    });
});

describe('isValidDID', () => {
    it('should return true for valid DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const isValid = isValidDID(agentDID);
        expect(isValid).toBe(true);
    });

    it('should return true for custome DID prefix', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair, {});
        const agentDID = await gatekeeper.createDID(agentOp);

        const isValid = isValidDID(agentDID);
        expect(isValid).toBe(true);
    });

    it('should return false for wrong type', async () => {
        // @ts-expect-error Testing wrong type
        expect(isValidDID()).toBe(false);
        // @ts-expect-error Testing wrong type
        expect(isValidDID(null)).toBe(false);
        // @ts-expect-error Testing wrong type
        expect(isValidDID(123)).toBe(false);
        // @ts-expect-error Testing wrong type
        expect(isValidDID([1, 2, 3])).toBe(false);
        // @ts-expect-error Testing wrong type
        expect(isValidDID({ mock: 123 })).toBe(false);
    });

    it('should return false if prefix missing', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const didWithoutPrefix = agentDID.replace(/^did:/, '');

        const isValid = isValidDID(didWithoutPrefix);
        expect(isValid).toBe(false);
    });

    it('should return false if did scheme is missing', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const suffix = agentDID.split(':').pop();
        const badDID = 'did:' + suffix;

        const isValid = isValidDID(badDID);
        expect(isValid).toBe(false);
    });

    it('should return false if suffix is not a valid CID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const badDID = agentDID + 'mock';

        const isValid = isValidDID(badDID);
        expect(isValid).toBe(false);
    });
});

describe('Test operation validation errors', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return false if operation is invalid', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid value
        const result = await gatekeeper.verifyOperation({ type: 'dummy' });
        expect(result).toBe(false);
    });

    it('update error with missing didDocument', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);

        delete doc.didDocument;

        try {
            await gatekeeper.verifyUpdateOperation(updateOp, doc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: doc.didDocument');
        }
    });

    it('update error with missing didDocument', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);

        delete doc.didDocument;

        try {
            await gatekeeper.verifyUpdateOperation(updateOp, doc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: doc.didDocument');
        }
    });

    it('update error with deactivated didDocumentMetadata', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);

        doc.didDocumentMetadata!.deactivated = true;

        try {
            await gatekeeper.verifyUpdateOperation(updateOp, doc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: DID deactivated');
        }
    });

    it('update error without verificationMethod', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);

        delete doc.didDocument!.verificationMethod;

        try {
            await gatekeeper.verifyUpdateOperation(updateOp, doc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: doc.didDocument.verificationMethod');
        }
    });

    it('update error with empty verificationMethod', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await createUpdateOp(keypair, did, doc);
        doc = await gatekeeper.resolveDID(did);

        delete doc.didDocument!.verificationMethod![0].publicKeyJwk;

        try {
            await gatekeeper.verifyUpdateOperation(updateOp, doc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: didDocument missing verificationMethod');
        }
    });

    it('create error with invalid type', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        let assetOp = await createAssetOp(agent, keypair);

        // @ts-expect-error Testing invalid value
        assetOp.mdip!.type = "dummy";

        try {
            await gatekeeper.verifyCreateOperation(assetOp);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.type=dummy');
        }
    });

    it('create error with invalid signature', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        let agentOp = await createAgentOp(keypair);
        agentOp.mdip!.prefix = "dummy";

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });
});

describe('addJSON', () => {
    beforeEach(() => {
        mockFs({});
    });

    afterEach(() => {
        mockFs.restore();
    });

    const data = { key: 'mock' };
    const hash = 'z3v8AuaXiw9ZVBhPuQdTJySePBjwpBtvsSCRLXuPLzwqokHV8cS';

    it('should create CID from data', async () => {
        const ipfs = new HeliaClient();
        const gatekeeper = new Gatekeeper({ ipfs, db: db_json, console: mockConsole });
        const cid = await gatekeeper.addJSON(data);

        expect(cid).toBe(hash);
    });
});

describe('getJSON', () => {
    beforeEach(() => {
        mockFs({});
    });

    afterEach(() => {
        mockFs.restore();
    });

    const mockData = { key: 'mock' };

    it('should return JSON data from CID', async () => {
        const cid = await gatekeeper.addJSON(mockData);
        const data = await gatekeeper.getJSON(cid);

        expect(data).toStrictEqual(mockData);
    });
});

describe('addText', () => {
    beforeEach(() => {
        mockFs({});
    });

    afterEach(() => {
        mockFs.restore();
    });

    const mockData = 'mock text data';
    const hash = 'zb2rhgNGdyFtViUWRk4oYLGrwdkgbt4GnF2s15k3ZujX6w3QW';

    it('should create CID from text data', async () => {
        const cid = await gatekeeper.addText(mockData);

        expect(cid).toBe(hash);
    });
});

describe('getText', () => {
    beforeEach(() => {
        mockFs({});
    });

    afterEach(() => {
        mockFs.restore();
    });

    const mockData = 'mock text data';

    it('should return text data from CID', async () => {
        const cid = await gatekeeper.addText(mockData);
        const data = await gatekeeper.getText(cid);

        expect(data).toBe(mockData);
    });
});

describe('addData', () => {
    beforeEach(() => {
        mockFs({});
    });

    afterEach(() => {
        mockFs.restore();
    });

    const mockData = Buffer.from('mock data');
    const hash = 'zb2rhYuMKCR7pY51Tzv52NmTW9zYU2P53XFUJitvDwtSpCDhd';

    it('should create CID from text data', async () => {
        const cid = await gatekeeper.addData(mockData);

        expect(cid).toBe(hash);
    });
});

describe('getData', () => {
    beforeEach(() => {
        mockFs({});
    });

    afterEach(() => {
        mockFs.restore();
    });

    const mockData = Buffer.from('mock data');

    it('should return text data from CID', async () => {
        const cid = await gatekeeper.addData(mockData);
        const data = await gatekeeper.getData(cid);

        expect(data).toStrictEqual(mockData);
    });
});
