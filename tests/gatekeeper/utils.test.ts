import CipherNode from '@mdip/cipher/node';
import { Operation } from '@mdip/gatekeeper/types';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import { compareOrdinals } from '@mdip/common/utils';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { isValidDID } from '@mdip/ipfs/utils';
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

describe('constructor', () => {
    it('should throw exception on invalid parameters', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            new Gatekeeper();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: missing options.db');
        }

        try {
            new Gatekeeper({ db, ipfs, registries: ['hyperswarm', 'bogus_reg'] });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: registry=bogus_reg');
        }
    });
});

describe('generateDID', () => {
    it('should create DID from operation', async () => {
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
        const mockTxn: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
                registry: "mockRegistry"
            }
        };

        const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, didPrefix: 'did:mock' });
        const did = await gatekeeper.generateDID(mockTxn);

        expect(did.startsWith('did:mock:')).toBe(true);
    });

    it('should create DID from operation with custom prefix', async () => {
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

    it('should generate an agent doc from a valid anchor', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.generateDID(agentOp);
        const doc = await gatekeeper.generateDoc(agentOp);
        const expected = {
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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { prefix: 'did:custom' });
        const did = await gatekeeper.generateDID(agentOp);
        const doc = await gatekeeper.generateDoc(agentOp);
        const expected = {
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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agent, keypair);
        const did = await gatekeeper.generateDID(assetOp);
        const doc = await gatekeeper.generateDoc(assetOp);
        const expected = {
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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        delete agentOp.mdip;
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip version invalid', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 0 });
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip type invalid', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        // @ts-expect-error Testing invalid usage
        agentOp.mdip!.type = 'mock';
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });

    it('should return an empty doc if mdip registry invalid', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'mock' });
        const doc = await gatekeeper.generateDoc(agentOp);

        expect(doc).toStrictEqual({});
    });
});

describe('ipfs disabled', () => {
    it('should throw on addText/addData/addJSON when disabled', async () => {
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });

        // eslint-disable-next-line sonarjs/no-duplicate-string
        await expect(gatekeeper.addText('hello')).rejects.toThrow('IPFS disabled');
        await expect(gatekeeper.addData(Buffer.from('data'))).rejects.toThrow('IPFS disabled');
        await expect(gatekeeper.addJSON({ hello: 'world' })).rejects.toThrow('IPFS disabled');
        await expect(gatekeeper.getText('cid')).rejects.toThrow('IPFS disabled');
        await expect(gatekeeper.getData('cid')).rejects.toThrow('IPFS disabled');
        await expect(gatekeeper.getJSON('cid')).rejects.toThrow('IPFS disabled');
    });

    it('should still generate CID when save=true and disabled', async () => {
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const operation: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
                registry: "mockRegistry"
            }
        };

        const cid = await gatekeeper.generateCID(operation, true);
        expect(typeof cid).toBe('string');
    });

    it('should throw if ipfs is missing when enabled', async () => {
        try {
            new Gatekeeper({ db, ipfsEnabled: true });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: missing options.ipfs');
        }
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
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const isValid = isValidDID(agentDID);
        expect(isValid).toBe(true);
    });

    it('should return true for custome DID prefix', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, {});
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
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const didWithoutPrefix = agentDID.replace(/^did:/, '');

        const isValid = isValidDID(didWithoutPrefix);
        expect(isValid).toBe(false);
    });

    it('should return false if did scheme is missing', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const suffix = agentDID.split(':').pop();
        const badDID = 'did:' + suffix;

        const isValid = isValidDID(badDID);
        expect(isValid).toBe(false);
    });

    it('should return false if suffix is not a valid CID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        const badDID = agentDID + 'mock';

        const isValid = isValidDID(badDID);
        expect(isValid).toBe(false);
    });
});

describe('Test operation validation errors', () => {

    it('should return false if operation is invalid', async () => {
        // @ts-expect-error Testing invalid value
        const result = await gatekeeper.verifyOperation({ type: 'dummy' });
        expect(result).toBe(false);
    });

    it('update error with missing didDocument', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);

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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);

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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);

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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);

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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        let doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
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
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        let assetOp = await helper.createAssetOp(agent, keypair);

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
        const keypair = cipher.generateRandomJwk();
        let agentOp = await helper.createAgentOp(keypair);
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

describe('gatekeeper.db', () => {
    it('getEvents should return empty list on invalid did', async () => {
        // @ts-expect-error Testing invalid DID
        const events = await gatekeeper.db.getEvents(null);

        expect(events).toStrictEqual([]);
    });

    it('getEvents should return empty list on malformed DID with no suffix', async () => {
        // @ts-expect-error Testing invalid DID
        const events = await gatekeeper.db.getEvents("did:test:");

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

describe('listRegistries', () => {
    it('should return list of default valid registries', async () => {
        const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole });
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(2);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
    });

    it('should return list of configured registries', async () => {
        const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, registries: ['hyperswarm', 'TFTC'] });
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(2);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
    });

    it('should return list of inferred registries', async () => {
        const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole });
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
        const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole });
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
