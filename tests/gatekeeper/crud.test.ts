import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import { ExpectedExceptionError } from '@mdip/common/errors';
import { copyJSON } from '@mdip/common/utils';
import HeliaClient from '@mdip/ipfs/helia';
import { jest } from '@jest/globals';
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

describe('createDID', () => {
    it('should create DID from agent operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should not persist a DID when its publication queues cannot be committed', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });
        const did = await gatekeeper.generateDID(agentOp);
        const addEvent = jest.spyOn(db, 'addEventAndQueue').mockRejectedValueOnce(new Error('queue failure'));

        await expect(gatekeeper.createDID(agentOp)).rejects.toThrow('queue failure');
        addEvent.mockRestore();

        await expect(gatekeeper.exportDID(did)).resolves.toStrictEqual([]);
        await expect(gatekeeper.getQueue('hyperswarm')).resolves.toStrictEqual([]);
        await expect(gatekeeper.getQueue('TFTC')).resolves.toStrictEqual([]);

        await expect(gatekeeper.createDID(agentOp)).resolves.toBe(did);
        await expect(gatekeeper.getQueue('hyperswarm')).resolves.toStrictEqual([agentOp]);
        await expect(gatekeeper.getQueue('TFTC')).resolves.toStrictEqual([agentOp]);
    });

    it('should create DID for local registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'local' });

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should reject an asset create that completes a controller cycle', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetOp = await helper.createAssetOp(agent, keypair);
        const asset = await gatekeeper.generateDID(assetOp);

        const agentDoc = await gatekeeper.resolveDID(agent);
        agentDoc.didDocument!.controller = asset;
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, agent, agentDoc)
        )).toBe(true);

        await expect(gatekeeper.verifyOperation(assetOp)).resolves.toBe(false);
        await expect(gatekeeper.createDID(assetOp)).rejects.toThrow('Invalid operation: controller cycle');
        await expect(gatekeeper.exportDID(asset)).resolves.toStrictEqual([]);
    });

    it('should throw exception on invalid version', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 2 });

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.version=2');
        }
    });

    // eslint-disable-next-line
    it('should throw exception on invalid registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'mockRegistry' });

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.registry=mockRegistry');
        }
    });

    it('should throw exception on unsupported registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });

        const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, registries: ['hyperswarm'] });

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid operation: registry TFTC not supported');
        }
    });

    it('should throw exception on invalid type', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'mockRegistry' });
        // @ts-expect-error Testing invalid usage
        agentOp.mdip!.type = 'mock';

        try {
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.type=mock');
        }
    });

    it('should reject an operation prefix that is not a DID method prefix', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { prefix: 'invalid' });

        await expect(gatekeeper.createDID(agentOp))
            .rejects.toThrow('Invalid operation: mdip.prefix=invalid');
        await expect(gatekeeper.getDIDs()).resolves.toStrictEqual([]);
    });

    it('should throw exception on invalid create agent operation', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.createDID();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: missing');
        }

        const keypair = cipher.generateRandomJwk();

        try {
            const agentOp = await helper.createAgentOp(keypair);
            // @ts-expect-error Testing invalid usage
            agentOp.type = 'mock';
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: type=mock');
        }

        try {
            const agentOp = await helper.createAgentOp(keypair);
            agentOp.created = 'mock';
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: created=mock');
        }

        try {
            const agentOp = await helper.createAgentOp(keypair);
            agentOp.mdip = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip');
        }

        try {
            const agentOp = await helper.createAgentOp(keypair);
            agentOp.created = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: created=undefined');
        }

        try {
            const agentOp = await helper.createAgentOp(keypair);
            agentOp.signature = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            const agentOp = await helper.createAgentOp(keypair);
            agentOp.publicJwk = undefined;
            await gatekeeper.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: publicJwk');
        }
    });

    it('should throw exception on create op size exceeding limit', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { prefix: 'did:tést' });
        const json = JSON.stringify(agentOp);
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole, maxOpBytes: json.length });

        expect(Buffer.byteLength(json, 'utf8')).toBeGreaterThan(json.length);

        try {
            await gk.createDID(agentOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: size');
        }
    });

    it('should create DID from asset operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agent, keypair);

        const did = await gatekeeper.createDID(assetOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should throw exception on invalid create asset operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);

        try {
            // inconsistent registry
            const assetOp = await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' });
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // Can't let local IDs create assets on other registries
            expect(error.message).toBe('Invalid operation: non-local registry=hyperswarm');
        }

        try {
            // invalid controller
            const assetOp = await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' });
            assetOp.controller = 'mock';
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signer is not controller');
        }

        try {
            // invalid signature
            const assetOp = await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' });
            assetOp.signature = undefined;
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            // invalid validUntil date
            const assetOp = await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm', validUntil: 'mock' });
            await gatekeeper.createDID(assetOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: mdip.validUntil=mock');
        }
    });

    it('should throw exception when registry queue exceeds limit', async () => {
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole, maxQueueSize: 5, registries: ['hyperswarm', 'TFTC'] });

        try {
            for (let i = 0; i < 10; i++) {
                const keypair = cipher.generateRandomJwk();
                const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });
                await gk.createDID(agentOp);
            }
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: registry TFTC not supported');
        }
    });
});

describe('resolveDID', () => {
    it('should resolve a valid agent DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const opid = await gatekeeper.generateCID(agentOp);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
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
                version: "1",
                confirmed: true,
                versionId: opid
            },
            didResolutionMetadata: {
                retrieved: expect.any(String),
            },
            mdip: agentOp.mdip
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should resolve a valid agent DID after an update', async () => {

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        const opid = await gatekeeper.generateCID(updateOp);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);
        const expected = {
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
                version: "2",
                confirmed: true,
                versionId: opid
            },
            didResolutionMetadata: {
                retrieved: expect.any(String),
            },
            mdip: agentOp.mdip
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve confirmed version when specified', async () => {

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' }); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const expected = await gatekeeper.resolveDID(did);
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, update);
        const ok = await gatekeeper.updateDID(updateOp);
        const confirmedDoc = await gatekeeper.resolveDID(did, { confirm: true });

        // Update expected to match the new retrieved timestamp
        expected!.didResolutionMetadata!.retrieved = expect.any(String);

        expect(ok).toBe(true);
        expect(confirmedDoc).toStrictEqual(expected);
    });

    it('should resolve verified version after an update', async () => {

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        await gatekeeper.resolveDID(did, { confirm: true });
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, update);
        const opid = await gatekeeper.generateCID(updateOp);
        const ok = await gatekeeper.updateDID(updateOp);
        const verifiedDoc = await gatekeeper.resolveDID(did, { verify: true });

        const expected = {
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
                version: "2",
                confirmed: true,
                versionId: opid
            },
            didResolutionMetadata: {
                retrieved: expect.any(String),
            },
            mdip: agentOp.mdip
        };

        expect(ok).toBe(true);
        expect(verifiedDoc).toStrictEqual(expected);
    });

    it('should resolve unconfirmed version when specified', async () => {

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' }); // Specify hyperswarm registry for this agent
        const did = await gatekeeper.createDID(agentOp);
        const update = await gatekeeper.resolveDID(did);
        update.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, update);
        const opid = await gatekeeper.generateCID(updateOp);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did, { confirm: false });
        const expected = {
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
                version: "2",
                confirmed: false,
                versionId: opid
            },
            didResolutionMetadata: {
                retrieved: expect.any(String),
            },
            mdip: agentOp.mdip
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve version at specified time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);

        // Add 10 versions
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);
            update.didDocumentData = { mock: i + 1 };
            const updateOp = await helper.createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        const ops = await gatekeeper.exportDID(did);
        let timestamp = Date.now();

        for (const op of ops) {
            op.registry = 'TFTC';
            timestamp += 3600000; // add 1 hour to timestamp for each op
            op.time = new Date(timestamp).toISOString();
        }

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();

        // Pick a time out of the middle of the updates
        const doc = await gatekeeper.resolveDID(did, { versionTime: ops[5].time });

        expect(doc.didDocumentMetadata!.version).toBe("6");
        expect(doc.didDocumentMetadata!.confirmed).toBe(true);
        expect(doc.didDocumentData).toStrictEqual({ mock: 5 });
    });


    it('should resolve specified version', async () => {

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        let expected;

        // Add 10 versions, save one from the middle
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);

            if (i === 5) {
                expected = update;
            }

            update.didDocumentData = { mock: 1 };
            const updateOp = await helper.createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        const versionSequence = parseInt(expected!.didDocumentMetadata!.version!, 10);
        const doc = await gatekeeper.resolveDID(did, { versionSequence });

        // Update expected to match the new retrieved timestamp
        expected!.didResolutionMetadata!.retrieved = expect.any(String);

        expect(doc).toStrictEqual(expected);
    });

    it('should resolve all specified versions', async () => {

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        // Add 10 versions
        for (let i = 0; i < 10; i++) {
            const update = await gatekeeper.resolveDID(did);
            update.didDocumentData = { mock: 1 };
            const updateOp = await helper.createUpdateOp(keypair, did, update);
            await gatekeeper.updateDID(updateOp);
        }

        for (let i = 0; i < 10; i++) {
            const doc = await gatekeeper.resolveDID(did, { versionSequence: i + 1 });
            const version = (i + 1).toString();
            expect(doc.didDocumentMetadata!.version).toBe(version);
        }
    });

    it('should resolve a valid asset DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agent = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agent, keypair);
        delete assetOp.mdip!.validUntil;
        const opid = await gatekeeper.generateCID(assetOp);
        const did = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(did);
        const expected = {
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
                version: "1",
                confirmed: true,
                versionId: opid
            },
            didResolutionMetadata: {
                retrieved: expect.any(String),
            },
            mdip: assetOp.mdip
        };

        expect(doc).toStrictEqual(expected);
    });

    it('should return requested DID in docs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const suffix = did.split(':').pop();
        const altDID = `did:alt:prefix:${suffix}`;
        const doc = await gatekeeper.resolveDID(altDID);

        expect(doc!.didDocument!.id).toStrictEqual(altDID);
    });

    it('should return invalidDid error for invalid DIDs', async () => {
        async function checkForInvalidDidError(did?: any) {
            const { didResolutionMetadata } = await gatekeeper.resolveDID(did);
            expect(didResolutionMetadata).toBeDefined();
            expect(didResolutionMetadata!.error).toBe('invalidDid');
        }

        await checkForInvalidDidError();
        await checkForInvalidDidError('');
        await checkForInvalidDidError('mock');
        await checkForInvalidDidError([]);
        await checkForInvalidDidError([1, 2, 3]);
        await checkForInvalidDidError({});
        await checkForInvalidDidError({ mock: 1 });
        await checkForInvalidDidError('did:test:xxx');
    });

    it('should return notFound error for missing DID', async () => {
        const { didResolutionMetadata } = await gatekeeper.resolveDID('did:test:z3v8Auah2NPDigFc3qKx183QKL6vY8fJYQk6NeLz7KF2RFtC9c8');
        expect(didResolutionMetadata).toBeDefined();
        expect(didResolutionMetadata!.error).toBe('notFound');
    });

    it('should throw an exception on invalid signature in create op', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const events = await db.getEvents(did);
        // changing anything in the op will invalidate the signature
        events[0].operation.did = 'mock';
        await db.setEvents(did, events);

        try {
            await gatekeeper.resolveDID(did, { verify: true });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });

    it('should throw an exception on invalid signature in update op', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const events = await db.getEvents(did);
        // changing anything in the op will invalidate the signature
        events[1].operation.did = 'mock';
        await db.setEvents(did, events);

        try {
            await gatekeeper.resolveDID(did, { verify: true });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }
    });

    it('should throw an exception on invalid operation previd in update op', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc1 = await gatekeeper.resolveDID(did);
        doc1.didDocumentData = { mock: 1 };
        const updateOp1 = await helper.createUpdateOp(keypair, did, doc1);
        await gatekeeper.updateDID(updateOp1);
        const doc2 = await gatekeeper.resolveDID(did);
        doc2.didDocumentData = { mock: 2 };
        const updateOp2 = await helper.createUpdateOp(keypair, did, doc2);
        await gatekeeper.updateDID(updateOp2);

        const events = await db.getEvents(did);
        // if we swap update events the sigs will be valid but the previd will be invalid
        [events[1], events[2]] = [events[2], events[1]];
        await db.setEvents(did, events);

        try {
            await gatekeeper.resolveDID(did, { verify: true });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: previd');
        }
    });
});

describe('updateDID', () => {
    it('should update a valid DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        const opid = await gatekeeper.generateCID(updateOp);
        const ok = await gatekeeper.updateDID(updateOp);
        const updatedDoc = await gatekeeper.resolveDID(did);

        // Update doc to match expected
        doc.didDocumentMetadata!.updated = expect.any(String);
        doc.didDocumentMetadata!.version = "2";
        doc.didDocumentMetadata!.versionId = opid;
        doc.didResolutionMetadata!.retrieved = expect.any(String);

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(doc);
    });

    it('should reject invalid replacement documents without changing the DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const otherDid = await gatekeeper.createDID(
            await helper.createAgentOp(keypair, { prefix: 'did:mdip' })
        );
        const original = await gatekeeper.resolveDID(did);
        const missingData = copyJSON(original);
        const missingDid = copyJSON(original);
        const missingMdip = copyJSON(original);
        const invalidVersion = copyJSON(original);
        const wrongDid = copyJSON(original);
        const wrongType = copyJSON(original);
        const wrongRegistry = copyJSON(original);

        delete missingData.didDocumentData;
        delete missingDid.didDocument!.id;
        delete missingMdip.mdip;
        invalidVersion.mdip!.version = 2;
        wrongDid.didDocument!.id = otherDid;
        wrongType.mdip!.type = 'asset';
        wrongRegistry.mdip!.registry = 'hyperswarm';

        for (const replacement of [
            {},
            missingData,
            missingDid,
            missingMdip,
            invalidVersion,
            wrongDid,
            wrongType,
            wrongRegistry,
        ]) {
            const operation = await helper.createUpdateOp(keypair, did, replacement);
            await expect(gatekeeper.updateDID(operation)).resolves.toBe(false);
        }

        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(1);
        await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
            didDocument: { id: did },
            didDocumentData: {},
            mdip: { type: 'agent', registry: 'local' },
        });
    });

    it('should reject an operation of the wrong kind or for another DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const otherDid = await gatekeeper.createDID(
            await helper.createAgentOp(keypair, { prefix: 'did:mdip' })
        );
        const doc = await gatekeeper.resolveDID(did);
        const operation = await helper.createUpdateOp(keypair, did, doc);
        operation.type = 'create';
        delete operation.signature;
        const hash = cipher.hashJSON(operation);
        operation.signature = {
            signer: did,
            signed: new Date().toISOString(),
            hash,
            value: cipher.signHash(hash, keypair.privateJwk),
        };

        await expect(gatekeeper.verifyUpdateOperation(operation, doc)).resolves.toBe(false);
        await expect(gatekeeper.verifyUpdateOperation(
            await helper.createUpdateOp(keypair, did, doc),
            await gatekeeper.resolveDID(otherDid)
        )).resolves.toBe(false);
    });

    it('should accept an update whose DID uses another valid prefix', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const alias = `did:mdip:${did.split(':').pop()}`;
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { updated: true };
        const operation = await helper.createUpdateOp(keypair, alias, doc);

        await expect(gatekeeper.updateDID(operation)).resolves.toBe(true);
        await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
            didDocument: { id: did },
            didDocumentData: { updated: true },
        });
    });

    it('should reject cyclic asset controller chains', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetA = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));
        const assetB = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));

        const assetADoc = await gatekeeper.resolveDID(assetA);
        assetADoc.didDocument!.controller = assetB;
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(keypair, assetA, assetADoc))).toBe(true);

        const nextAssetADoc = await gatekeeper.resolveDID(assetA);
        nextAssetADoc.didDocumentData = { updated: true };
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(keypair, assetA, nextAssetADoc))).toBe(true);

        const assetBDoc = await gatekeeper.resolveDID(assetB);
        assetBDoc.didDocument!.controller = assetA;
        const cycle = await helper.createUpdateOp(keypair, assetB, assetBDoc);
        expect(await gatekeeper.updateDID(cycle)).toBe(false);
        expect((await gatekeeper.resolveDID(assetB)).didDocument!.controller).toBe(agent);

        const events = await db.getEvents(assetB);
        events.push({
            registry: 'local',
            time: cycle.signature!.signed,
            operation: cycle,
            did: assetB,
        });
        await db.setEvents(assetB, events);

        const cyclicAssetADoc = await gatekeeper.resolveDID(assetA);
        cyclicAssetADoc.didDocumentData = { updated: false };
        const update = await helper.createUpdateOp(keypair, assetA, cyclicAssetADoc);
        expect(await gatekeeper.updateDID(update)).toBe(false);
    });

    it('should reject a cycle through an unconfirmed controller update', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair, { registry: 'hyperswarm' }));
        const assetA = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );
        const assetB = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );

        const assetADoc = await gatekeeper.resolveDID(assetA);
        assetADoc.didDocument!.controller = assetB;
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(keypair, assetA, assetADoc))).toBe(true);
        expect((await gatekeeper.resolveDID(assetA, { confirm: true })).didDocument!.controller).toBe(agent);

        const assetBDoc = await gatekeeper.resolveDID(assetB);
        assetBDoc.didDocument!.controller = assetA;
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(keypair, assetB, assetBDoc))).toBe(false);
    });

    it('should reject a cycle created with a backdated signature', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetA = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));
        const assetB = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));

        const assetADoc = await gatekeeper.resolveDID(assetA);
        assetADoc.didDocument!.controller = assetB;
        const updateA = await helper.createUpdateOp(keypair, assetA, assetADoc);
        expect(await gatekeeper.updateDID(updateA)).toBe(true);

        const assetBDoc = await gatekeeper.resolveDID(assetB);
        assetBDoc.didDocument!.controller = assetA;
        const updateB = await helper.createUpdateOp(keypair, assetB, assetBDoc);
        updateB.signature!.signed = new Date(
            new Date(updateA.signature!.signed).getTime() - 1
        ).toISOString();
        const unsignedUpdateB = copyJSON(updateB);
        delete unsignedUpdateB.signature;
        updateB.signature!.hash = cipher.hashJSON(unsignedUpdateB);
        updateB.signature!.value = cipher.signHash(updateB.signature!.hash, keypair.privateJwk);

        expect(await gatekeeper.verifyOperation(updateB)).toBe(false);
        expect(await gatekeeper.updateDID(updateB)).toBe(false);
    });

    it('should serialize concurrent controller changes', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetA = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));
        const assetB = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));

        const assetADoc = await gatekeeper.resolveDID(assetA);
        assetADoc.didDocument!.controller = assetB;
        const updateA = await helper.createUpdateOp(keypair, assetA, assetADoc);
        const assetBDoc = await gatekeeper.resolveDID(assetB);
        assetBDoc.didDocument!.controller = assetA;
        const updateB = await helper.createUpdateOp(keypair, assetB, assetBDoc);

        const originalAddEventAndQueue = db.addEventAndQueue.bind(db);
        let signalStarted: () => void = () => { };
        let releaseFirst: () => void = () => { };
        const started = new Promise<void>(resolve => (signalStarted = resolve));
        const release = new Promise<void>(resolve => (releaseFirst = resolve));
        let pauseFirst = true;
        const addEvent = jest.spyOn(db, 'addEventAndQueue').mockImplementation(async (did, event, registries) => {
            if (pauseFirst && did === assetA && event.operation.type === 'update') {
                pauseFirst = false;
                signalStarted();
                await release;
            }
            return originalAddEventAndQueue(did, event, registries);
        });

        try {
            const first = gatekeeper.updateDID(updateA);
            await started;
            const second = gatekeeper.updateDID(updateB);
            releaseFirst();

            await expect(Promise.all([first, second])).resolves.toStrictEqual([true, false]);
            expect((await gatekeeper.resolveDID(assetA)).didDocument!.controller).toBe(assetB);
            expect((await gatekeeper.resolveDID(assetB)).didDocument!.controller).toBe(agent);
        }
        finally {
            releaseFirst();
            addEvent.mockRestore();
        }
    });

    it('should detect a legacy controller cycle when document IDs are missing', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetA = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));
        const assetB = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));

        const assetADoc = await gatekeeper.resolveDID(assetA);
        delete assetADoc.didDocument!.id;
        assetADoc.didDocument!.controller = assetB;
        const legacyUpdate = await helper.createUpdateOp(keypair, assetA, assetADoc);
        const assetAEvents = await db.getEvents(assetA);
        assetAEvents.push({
            registry: 'local',
            time: legacyUpdate.signature!.signed,
            operation: legacyUpdate,
            did: assetA,
        });
        await db.setEvents(assetA, assetAEvents);

        const assetBDoc = await gatekeeper.resolveDID(assetB);
        delete assetBDoc.didDocument!.id;
        assetBDoc.didDocument!.controller = assetA;
        const cycle = await helper.createUpdateOp(keypair, assetB, assetBDoc);
        const events = await db.getEvents(assetB);
        events.push({
            registry: 'local',
            time: cycle.signature!.signed,
            operation: cycle,
            did: assetB,
        });
        await db.setEvents(assetB, events);

        const updateDoc = await gatekeeper.resolveDID(assetA);
        updateDoc.didDocument!.id = assetA;
        updateDoc.didDocumentData = { updated: true };
        const update = await helper.createUpdateOp(keypair, assetA, updateDoc);
        expect(await gatekeeper.updateDID(update)).toBe(false);
    });

    it('should not persist an update when its publication queues cannot be committed', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        await gatekeeper.clearQueue('hyperswarm', [agentOp]);
        await gatekeeper.clearQueue('TFTC', [agentOp]);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        const addEvent = jest.spyOn(db, 'addEventAndQueue').mockRejectedValueOnce(new Error('queue failure'));

        await expect(gatekeeper.updateDID(updateOp)).rejects.toThrow('queue failure');
        addEvent.mockRestore();

        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(1);
        await expect(gatekeeper.getQueue('hyperswarm')).resolves.toStrictEqual([]);
        await expect(gatekeeper.getQueue('TFTC')).resolves.toStrictEqual([]);

        await expect(gatekeeper.updateDID(updateOp)).resolves.toBe(true);
        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(2);
        await expect(gatekeeper.getQueue('hyperswarm')).resolves.toStrictEqual([updateOp]);
        await expect(gatekeeper.getQueue('TFTC')).resolves.toStrictEqual([updateOp]);
    });

    it('should reject an update whose previd is no longer current', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const firstDoc = await gatekeeper.resolveDID(did);
        const staleDoc = await gatekeeper.resolveDID(did);
        firstDoc.didDocumentData = { member: 'Alice' };
        staleDoc.didDocumentData = { member: 'Bob' };
        const first = await helper.createUpdateOp(keypair, did, firstDoc);
        const stale = await helper.createUpdateOp(keypair, did, staleDoc);

        expect(await gatekeeper.updateDID(first)).toBe(true);
        expect(await gatekeeper.updateDID(stale)).toBe(false);
        expect((await gatekeeper.resolveDID(did)).didDocumentData).toEqual({ member: 'Alice' });
        expect((await db.getEvents(did))).toHaveLength(2);
    });

    it('should still update a DID whose earlier operation had no previd', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const legacyDoc = await gatekeeper.resolveDID(did);
        legacyDoc.didDocumentData = { member: 'Alice' };
        const legacy = await helper.createUpdateOp(keypair, did, legacyDoc, { excludePrevid: true });
        expect(await gatekeeper.updateDID(legacy)).toBe(true);

        const current = await gatekeeper.resolveDID(did);
        current.didDocumentData = { member: 'Bob' };
        const next = await helper.createUpdateOp(keypair, did, current);
        expect(next.previd).toBe(current.didDocumentMetadata?.versionId);
        expect(await gatekeeper.updateDID(next)).toBe(true);
        expect((await gatekeeper.resolveDID(did, { verify: true })).didDocumentData).toEqual({ member: 'Bob' });
    });

    it('should increment version with each update', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        for (let i = 0; i < 10; i++) {
            doc.didDocumentData = { mock: i };
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            const ok = await gatekeeper.updateDID(updateOp);
            const updatedDoc = await gatekeeper.resolveDID(did);

            expect(ok).toBe(true);
            const version = (i + 2).toString();
            expect(updatedDoc.didDocumentMetadata!.version).toBe(version);
        }
    });

    it('should return false if update operation is invalid', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        updateOp.doc!.didDocumentData = 'mock';
        const ok = await gatekeeper.updateDID(updateOp);

        expect(ok).toBe(false);
    });

    it('should throw exception on invalid update operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        try {
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            delete updateOp.signature;
            await gatekeeper.updateDID(updateOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: signature');
        }

        try {
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            delete updateOp.did;
            await gatekeeper.updateDID(updateOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: missing operation.did');
        }
    });

    it('should throw exception on update op size exceeding limit', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = 'é';
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        const json = JSON.stringify(updateOp);
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole, maxOpBytes: json.length });

        expect(Buffer.byteLength(json, 'utf8')).toBeGreaterThan(json.length);

        try {
            await gk.updateDID(updateOp);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: size');
        }
    });

    it('should verify DID that has been updated multiple times', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        for (let i = 0; i < 10; i++) {
            doc.didDocumentData = { mock: i };
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
        }

        const doc2 = await gatekeeper.resolveDID(did, { verify: true });
        expect(doc2.didDocumentMetadata!.version).toBe("11");
    });

    it('should throw exception when registry queue exceeds limit', async () => {
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole, maxQueueSize: 5, registries: ['hyperswarm', 'TFTC'] });

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });

        const did = await gk.createDID(agentOp);
        const doc = await gk.resolveDID(did);

        try {
            for (let i = 0; i < 10; i++) {
                doc.didDocumentData = { mock: i };
                const updateOp = await helper.createUpdateOp(keypair, did, doc);
                await gk.updateDID(updateOp);
            }
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid operation: registry TFTC not supported');
        }
    });
});

describe('deleteDID', () => {
    it('should delete a valid DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const deleteOp = await helper.createDeleteOp(keypair, did);
        const ok = await gatekeeper.deleteDID(deleteOp);
        const doc = await gatekeeper.resolveDID(did);

        expect(ok).toBe(true);
        expect(doc).toBeDefined();
        expect(doc.didDocument).toStrictEqual({ id: did });
        expect(doc.didDocumentMetadata!.deactivated).toBe(true);
        expect(doc.didDocumentMetadata!.version).toBe("2");
    });
});
