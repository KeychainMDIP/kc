import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import { InvalidDIDError, ExpectedExceptionError } from '@mdip/common/errors';
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

describe('createDID', () => {
    it('should create DID from agent operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
    });

    it('should create DID for local registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'local' });

        const did = await gatekeeper.createDID(agentOp);

        expect(did.startsWith('did:test:')).toBe(true);
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
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole, maxOpBytes: 100 });
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);

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
                version: "1",
                confirmed: true,
                versionId: opid
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
                version: "2",
                confirmed: true,
                versionId: opid
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
                version: "2",
                confirmed: true,
                versionId: opid
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
                version: "2",
                confirmed: false,
                versionId: opid
            },
            mdip: agentOp.mdip
        };

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(expected);
    });

    it('should resolve version at specified time', async () => {

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

        const doc = await gatekeeper.resolveDID(did, { atTime: expected!.didDocumentMetadata!.updated });
        expect(doc).toStrictEqual(expected);
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

        const atVersion = parseInt(expected!.didDocumentMetadata!.version!, 10);
        const doc = await gatekeeper.resolveDID(did, { atVersion });
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
            const doc = await gatekeeper.resolveDID(did, { atVersion: i + 1 });
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
                version: "1",
                confirmed: true,
                versionId: opid
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

    it('should not resolve an invalid DID', async () => {
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
        doc.didDocumentMetadata!.updated = expect.any(String);
        doc.didDocumentMetadata!.version = "2";
        doc.didDocumentMetadata!.versionId = opid;

        expect(ok).toBe(true);
        expect(updatedDoc).toStrictEqual(doc);
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

        try {
            const gk = new Gatekeeper({ db, ipfs, console: mockConsole, maxOpBytes: 100 });
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
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
