import { jest } from '@jest/globals';
import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import { VerifiableCredential } from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { copyJSON } from '@mdip/common/utils';
import { InvalidDIDError, ExpectedExceptionError, UnknownIDError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { TestHelper, mockJson, mockSchema } from './helper.ts';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;
let helper: TestHelper;

beforeAll(async () => {
    ipfs = new HeliaClient();
    await ipfs.start();
});

afterAll(async () => {
    if (ipfs) {
        await ipfs.stop();
    }
});

beforeEach(() => {
    const db = new DbJsonMemory('test');
    gatekeeper = new Gatekeeper({ db, ipfs, registries: ['local', 'hyperswarm', 'TFTC'] });
    wallet = new WalletJsonMemory();
    cipher = new CipherNode();
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
    helper = new TestHelper(keymaster);
});

describe('listCredentials', () => {
    it('return list of held credentials', async () => {
        const expectedCredentials = await helper.setupCredentials();
        const credentials = await keymaster.listCredentials('Carol');

        expect(credentials).toStrictEqual(expectedCredentials);
    });

    it('return empty list if specified ID holds no credentials', async () => {
        await helper.setupCredentials();
        const credentials = await keymaster.listCredentials('Bob');

        expect(credentials).toStrictEqual([]);
    });

    it('raises an exception if invalid ID specified', async () => {
        try {
            await keymaster.listCredentials('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('getCredential', () => {
    it('returns decrypted credential for valid DID', async () => {
        const credentials = await helper.setupCredentials();

        for (const did of credentials) {
            const credential = (await keymaster.getCredential(did))!;
            expect(credential.type[0]).toBe('VerifiableCredential');
        }
    });

    it('raises an exception if invalid DID specified', async () => {
        try {
            await keymaster.getCredential('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });

    it('raises an exception if DID specified that is not a credential', async () => {
        try {
            const agentDID = await keymaster.createId('Rando');
            await keymaster.getCredential(agentDID);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: did not encrypted');
        }
    });

    it('return null if not a verifiable credential', async () => {
        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);
        const res = await keymaster.getCredential(did);

        expect(res).toBeNull();
    });
});

describe('removeCredential', () => {
    it('removes specified credential from held credentials list', async () => {
        const credentials = await helper.setupCredentials();

        const ok1 = await keymaster.removeCredential(credentials[1]);
        const ok2 = await keymaster.removeCredential(credentials[3]);

        expect(ok1).toBe(true);
        expect(ok2).toBe(true);

        const held = await keymaster.listCredentials('Carol');

        expect(held).toStrictEqual([credentials[0], credentials[2]]);
    });

    it('returns false if DID not previously held', async () => {
        const agentDID = await keymaster.createId('Rando');
        const ok = await keymaster.removeCredential(agentDID);

        expect(ok).toBe(false);
    });

    it('raises an exception if no DID specified', async () => {
        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.removeCredential();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });

    it('raises an exception if invalid DID specified', async () => {
        try {
            await keymaster.removeCredential('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('publishCredential', () => {
    it('should reveal a valid credential', async () => {
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.publishCredential(did, { reveal: true });

        const doc = await keymaster.resolveDID(bob);
        const vc = await keymaster.decryptJSON(did);
        const manifest = (doc.didDocumentData as { manifest: Record<string, VerifiableCredential> }).manifest;

        expect(manifest[did]).toStrictEqual(vc);
    });

    it('should publish a valid credential without revealing', async () => {
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.publishCredential(did);

        const doc = await keymaster.resolveDID(bob);
        const vc = await keymaster.decryptJSON(did) as VerifiableCredential;
        const manifest = (doc.didDocumentData as { manifest: Record<string, VerifiableCredential> }).manifest;

        vc.credential = null;

        expect(manifest[did]).toStrictEqual(vc);
    });

    it('should throw when did is not a verifiable credential', async () => {
        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);

        try {
            await keymaster.publishCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toContain('did is not a credential');
        }
    });

    it('should reject publishing another subject\'s credential', async () => {
        await keymaster.createId('Issuer');
        const holder = await keymaster.createId('Holder');
        await keymaster.setCurrentId('Issuer');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, holder));

        await expect(keymaster.publishCredential(did)).rejects.toThrow('only subject can publish a credential');
    });
});

describe('unpublishCredential', () => {
    it('should unpublish a published credential', async () => {
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);
        await keymaster.publishCredential(did, { reveal: true });

        await keymaster.unpublishCredential(did);

        const doc = await keymaster.resolveDID(bob);
        const manifest = (doc.didDocumentData as { manifest: Record<string, VerifiableCredential> }).manifest;

        expect(manifest).toStrictEqual({});
    });

    it('should throw an exception when no current ID', async () => {
        try {
            await keymaster.unpublishCredential('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Keymaster: No current ID');
        }
    });

    it('should throw an exception when credential invalid', async () => {
        await keymaster.createId('Bob');

        try {
            await keymaster.unpublishCredential('did:test:mock49');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did');
        }
    });

    it('should throw an exception when credential not found', async () => {
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        try {
            await keymaster.unpublishCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did');
        }
    });
});

describe('isVerifiableCredential', () => {
    it('should return false for non-object or null', async () => {
        // @ts-expect-error Testing invalid usage, calling private func
        const res1 = keymaster.isVerifiableCredential(null);

        // @ts-expect-error Testing invalid usage, calling private func
        const res2 = keymaster.isVerifiableCredential("");

        expect(res1).toBe(false);
        expect(res2).toBe(false);
    })

    it('rejects malformed signed credential structures', async () => {
        await keymaster.createId('Alice');
        const subject = await keymaster.createId('Bob');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const vc = await keymaster.addSignature(await keymaster.bindCredential(schema, subject));
        const isCredential = (value: unknown): boolean => (keymaster as any).isVerifiableCredential(value);

        expect(isCredential(vc)).toBe(true);
        expect(isCredential({ ...vc, signature: { ...vc.signature, hash: undefined } })).toBe(true);
        expect(isCredential({ ...vc, validFrom: null, validUntil: null })).toBe(true);
        expect(isCredential({ ...vc, validFrom: '2030-01-01T01:00:00+01:00', validUntil: '2030-01-01T00:00:00Z' })).toBe(true);
        expect(isCredential({ ...vc, validFrom: '2030-01-01T00:00:00.0009Z', validUntil: '2030-01-01T00:00:00.0010Z' })).toBe(true);
        expect(isCredential({ ...vc, validFrom: '2030-01-01T00:00:00.9999Z', validUntil: '2030-01-01T00:00:01Z' })).toBe(true);
        expect(isCredential({ ...vc, '@context': [vc['@context'][0], 'http://localhost:8080/context.json'] })).toBe(true);

        const invalid: Record<string, unknown> = {
            array: [],
            'empty context': { ...vc, '@context': [] },
            'wrong base context': { ...vc, '@context': ['https://www.w3.org/ns/credentials/examples/v2'] },
            'non-string context': { ...vc, '@context': [vc['@context'][0], 7] },
            'invalid context URL': { ...vc, '@context': [vc['@context'][0], 'not-a-url'] },
            'unsupported context scheme': { ...vc, '@context': [vc['@context'][0], 'javascript:alert(1)'] },
            'context without host': { ...vc, '@context': [vc['@context'][0], 'https://'] },
            'context with invalid host': { ...vc, '@context': [vc['@context'][0], 'https://%'] },
            'context with invalid port': { ...vc, '@context': [vc['@context'][0], 'https://example.com:65536/context'] },
            'missing credential type': { ...vc, type: [schema] },
            'non-string type': { ...vc, type: ['VerifiableCredential', 7] },
            'invalid issuer': { ...vc, issuer: {} },
            'invalid validFrom': { ...vc, validFrom: 'not-a-date' },
            'non-string validFrom': { ...vc, validFrom: 7 },
            'invalid validUntil': { ...vc, validUntil: '2031-02-30T00:00:00Z' },
            'non-string validUntil': { ...vc, validUntil: 7 },
            'reversed validity window': { ...vc, validFrom: '2030-01-02T00:00:00Z', validUntil: '2030-01-01T00:00:00Z' },
            'reversed submillisecond window': { ...vc, validFrom: '2030-01-01T00:00:00.0009Z', validUntil: '2030-01-01T00:00:00.0001Z' },
            'missing subject ID': { ...vc, credentialSubject: {} },
            'array subject': { ...vc, credentialSubject: [] },
            'invalid subject ID': { ...vc, credentialSubject: { id: 'not-a-did' } },
            'missing signature': { ...vc, signature: undefined },
            'array signature': { ...vc, signature: [] },
            'missing signer': { ...vc, signature: { ...vc.signature, signer: undefined } },
            'invalid signature date': { ...vc, signature: { ...vc.signature, signed: 7 } },
            'invalid signature date string': { ...vc, signature: { ...vc.signature, signed: 'not-a-date' } },
            'invalid signature hash': { ...vc, signature: { ...vc.signature, hash: 7 } },
            'missing signature value': { ...vc, signature: { ...vc.signature, value: '' } },
        };

        for (const [name, candidate] of Object.entries(invalid)) {
            expect({ name, valid: isCredential(candidate) }).toEqual({ name, valid: false });
        }

        const originalURL = globalThis.URL;
        try {
            (globalThis as any).URL = class {};
            expect(isCredential(vc)).toBe(true);
            expect(isCredential(invalid['invalid context URL'])).toBe(false);
        } finally {
            globalThis.URL = originalURL;
        }
    });
})

describe('bindCredential', () => {
    it('should create a bound credential', async () => {
        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        const vc = await keymaster.bindCredential(credentialDid, userDid);

        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject!.id).toBe(userDid);
        expect(vc.credential!.email).toEqual(expect.any(String));
    });

    it('should create a bound credential with provided default', async () => {
        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        const credential = { email: 'bob@mock.com' };
        const vc = await keymaster.bindCredential(credentialDid, userDid, { credential });

        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject!.id).toBe(userDid);
        expect(vc.credential!.email).toEqual(credential.email);
    });

    it('should create a bound credential for a different user', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Alice')
        const vc = await keymaster.bindCredential(credentialDid, bob);

        expect(vc.issuer).toBe(alice);
        expect(vc.credentialSubject!.id).toBe(bob);
        expect(vc.credential!.email).toEqual(expect.any(String));
    });
});

describe('issueCredential', () => {
    it('rejects credentials that cannot be accepted before creating an asset', async () => {
        await keymaster.createId('Alice');
        const subject = await keymaster.createId('Bob');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const bound = await keymaster.bindCredential(schema, subject);
        const didsBefore = await gatekeeper.getDIDs();

        const invalid: Record<string, Record<string, unknown>> = {
            'empty context': { '@context': [] },
            'unsupported inline context': { '@context': [bound['@context'][0], { name: 'https://example.com/name' }] },
            'invalid context URL': { '@context': [bound['@context'][0], 'not-a-url'] },
            'missing credential type': { type: [schema] },
            'missing subject ID': { credentialSubject: {} },
            'invalid validFrom': { validFrom: 'not-a-date' },
            'invalid validUntil': { validUntil: 7 },
            'reversed validity window': { validFrom: '2030-01-02T00:00:00Z', validUntil: '2030-01-01T00:00:00Z' },
            'reversed submillisecond window': { validFrom: '2030-01-01T00:00:00.0009Z', validUntil: '2030-01-01T00:00:00.0001Z' },
        };

        for (const change of Object.values(invalid)) {
            await expect(keymaster.issueCredential({ ...bound, ...change } as VerifiableCredential))
                .rejects.toThrow('Invalid parameter: credential');
        }
        expect(await gatekeeper.getDIDs()).toStrictEqual(didsBefore);
    });

    it('can issue and accept an expired credential with well-formed dates', async () => {
        await keymaster.createId('Alice');
        const subject = await keymaster.createId('Bob');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema, subject, {
            validFrom: '2020-01-01T00:00:00Z',
            validUntil: '2021-01-01T00:00:00Z',
        });
        const did = await keymaster.issueCredential(credential);

        await keymaster.setCurrentId('Bob');
        expect(await keymaster.acceptCredential(did)).toBe(true);
    });

    it('re-signs a supplied credential without retaining its old signature in the payload', async () => {
        await keymaster.createId('Alice');
        const subject = await keymaster.createId('Bob');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.addSignature(await keymaster.bindCredential(schema, subject));
        const did = await keymaster.issueCredential(credential);

        await keymaster.setCurrentId('Bob');
        expect(await keymaster.acceptCredential(did)).toBe(true);
    });

    it('should issue a bound credential when user is issuer', async () => {
        const subject = await keymaster.createId('Bob');
        const schema = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(schema, subject);

        const did = await keymaster.issueCredential(boundCredential);

        const vc = await keymaster.decryptJSON(did) as VerifiableCredential;
        expect(vc.issuer).toBe(subject);
        expect(vc.credentialSubject!.id).toBe(subject);
        expect(vc.credential!.email).toEqual(expect.any(String));

        const isValid = await keymaster.verifySignature(vc);
        expect(isValid).toBe(true);

        const wallet = await keymaster.loadWallet();
        expect(wallet.ids['Bob'].owned!.includes(did)).toEqual(true);
    });

    it('should issue, accept and verify a credential with a delegated controller', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(schema, carol);
        const did = await keymaster.issueCredential(boundCredential, { controller: bob });

        const doc = await keymaster.resolveDID(did);
        expect(doc.didDocument!.controller).toBe(bob);

        await keymaster.setCurrentId('Carol');
        const vc = await keymaster.decryptJSON(did) as VerifiableCredential;
        expect(vc.issuer).toBe(alice);
        expect(vc.signature!.signer).toBe(alice);
        expect(vc.credentialSubject!.id).toBe(carol);
        expect(await keymaster.verifySignature(vc)).toBe(true);
        expect(await keymaster.acceptCredential(did)).toBe(true);
        expect(await keymaster.listCredentials()).toStrictEqual([did]);

        await keymaster.setCurrentId('Victor');
        const challengeDID = await keymaster.createChallenge({
            credentials: [{ schema, issuers: [alice] }],
        });

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Victor');
        const verified = await keymaster.verifyResponse(responseDID, { publish: false });
        expect(verified.match).toBe(true);
        expect(verified.vps).toStrictEqual([vc]);
    });

    it('should accept and verify a credential transferred after issuance', async () => {
        const alice = await keymaster.createId('Alice', { registry: 'local' });
        const bob = await keymaster.createId('Bob', { registry: 'local' });
        const carol = await keymaster.createId('Carol', { registry: 'local' });
        await keymaster.createId('Victor', { registry: 'local' });

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema, { registry: 'local' });
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, carol), { registry: 'local' });
        const original = await keymaster.decryptJSON(did);
        expect(await keymaster.transferAsset(did, bob)).toBe(true);
        expect((await keymaster.resolveDID(did)).didDocument!.controller).toBe(bob);

        await keymaster.setCurrentId('Carol');
        expect(await keymaster.acceptCredential(did)).toBe(true);
        expect(await keymaster.decryptJSON(did)).toStrictEqual(original);

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({ credentials: [{ schema, issuers: [alice] }] }, { registry: 'local' });
        await keymaster.setCurrentId('Carol');
        const response = await keymaster.createResponse(challenge, { registry: 'local' });

        await keymaster.setCurrentId('Victor');
        const verified = await keymaster.verifyResponse(response, { publish: false });
        expect(verified.match).toBe(true);
        expect(verified.responder).toBe(carol);
        expect(verified.vps).toStrictEqual([original]);
    });

    it('should bind and issue a credential', async () => {
        const subject = await keymaster.createId('Bob');
        const schema = await keymaster.createSchema(mockSchema);
        const unboundCredential = await keymaster.createTemplate(schema);

        const now = new Date();
        const validFrom = now.toISOString();
        now.setFullYear(now.getFullYear() + 1);
        const validUntil = now.toISOString();

        const did = await keymaster.issueCredential(unboundCredential, { subject, schema, validFrom, validUntil });

        const vc = await keymaster.decryptJSON(did) as VerifiableCredential;
        expect(vc.issuer).toBe(subject);
        expect(vc.credentialSubject!.id).toBe(subject);
        expect(vc.credential!.email).toEqual(expect.any(String));
        expect(vc.validFrom).toBe(validFrom);
        expect(vc.validUntil).toBe(validUntil);

        const isValid = await keymaster.verifySignature(vc);
        expect(isValid).toBe(true);
    });

    it('should throw an exception if user is not issuer', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const schema = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(schema, bob);

        await keymaster.setCurrentId('Bob');

        try {
            await keymaster.issueCredential(boundCredential);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential.issuer');
        }
    });

    it('should throw an exception on unbound credential without binding options', async () => {
        await keymaster.createId('Alice');

        const schema = await keymaster.createSchema(mockSchema);
        const unboundCredential = await keymaster.createTemplate(schema);

        try {
            await keymaster.issueCredential(unboundCredential);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential.issuer');
        }
    });
});

describe('sendCredential', () => {
    it('should create a notice for the credential', async () => {
        const subject = await keymaster.createId('Bob');
        const schema = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(schema, subject);
        const credentialDID = await keymaster.issueCredential(boundCredential);
        const noticeDID = await keymaster.sendCredential(credentialDID);

        expect(noticeDID).toBeDefined();
        const { notice } = await keymaster.resolveAsset(noticeDID!);

        expect(notice).toBeDefined();
        expect(notice.to).toStrictEqual([subject]);
        expect(notice.dids).toStrictEqual([credentialDID]);
    });

    it('should throw an exception on invalid credential', async () => {
        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.sendCredential(bob);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did not encrypted');
        }
    });

    it('should return null for an encrypted non-credential', async () => {
        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);

        await expect(keymaster.sendCredential(did)).resolves.toBeNull();
    });
});

describe('listIssued', () => {
    it('should return empty list for new ID', async () => {
        await keymaster.createId('Bob');
        const issued = await keymaster.listIssued();

        expect(issued).toStrictEqual([]);
    });

    it('should return list containing one issued credential', async () => {
        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);

        const issued = await keymaster.listIssued();

        expect(issued).toStrictEqual([did]);
    });
});

describe('updateCredential', () => {
    it('should update a valid verifiable credential', async () => {
        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);
        const vc = (await keymaster.getCredential(did))!;

        const validUntilDate = new Date();
        validUntilDate.setHours(validUntilDate.getHours() + 24);
        vc.validUntil = validUntilDate.toISOString();
        const ok = await keymaster.updateCredential(did, vc);
        expect(ok).toBe(true);

        const updated = (await keymaster.getCredential(did))!;
        expect(updated.validUntil).toBe(vc.validUntil);
        expect(updated.issuer).toBe(userDid);
        expect(updated.signature!.signer).toBe(userDid);
        expect(await keymaster.verifySignature(updated)).toBe(true);
        expect(await keymaster.acceptCredential(did)).toBe(true);

        const doc = await keymaster.resolveDID(did);
        expect(doc.didDocumentMetadata!.version).toBe("2");
    });

    it.each([
        { '@context': [] },
        { '@context': ['https://www.w3.org/ns/credentials/v2', 'not-a-url'] },
        { validFrom: '2030-01-02T00:00:00Z', validUntil: '2030-01-01T00:00:00Z' },
    ])('rejects malformed replacement credentials without updating the asset', async change => {
        const issuer = await keymaster.createId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, issuer));
        const original = (await keymaster.getCredential(did))!;
        const candidate = { ...original, ...change } as VerifiableCredential;
        const events = await gatekeeper.exportDID(did);

        await expect(keymaster.updateCredential(did, candidate)).rejects.toThrow('Invalid parameter: credential');

        expect(candidate.signature).toStrictEqual(original.signature);
        expect(await gatekeeper.exportDID(did)).toStrictEqual(events);
        expect(await keymaster.getCredential(did)).toStrictEqual(original);
    });

    it('should throw when the issuer encryption keypair is unavailable', async () => {
        const userDid = await keymaster.createId('Bob');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, userDid));
        const credential = (await keymaster.getCredential(did))!;
        const fetchKeyPair = keymaster.fetchKeyPair.bind(keymaster);
        jest.spyOn(keymaster, 'fetchKeyPair')
            .mockImplementationOnce(fetchKeyPair)
            .mockResolvedValueOnce(null);

        await expect(keymaster.updateCredential(did, credential)).rejects.toThrow('Keymaster: No valid sender keypair');
    });

    it('should keep signing and encryption bound to the validated issuer if the current ID changes', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, bob));
        const candidate = (await keymaster.getCredential(did))!;
        candidate.credential = { email: 'updated@example.com' };
        const addSignature = keymaster.addSignature.bind(keymaster);
        const signing = jest.spyOn(keymaster, 'addSignature').mockImplementationOnce(async (obj, signer) => {
            await keymaster.setCurrentId('Bob');
            return addSignature(obj, signer);
        });

        try {
            expect(await keymaster.updateCredential(did, candidate)).toBe(true);
        } finally {
            signing.mockRestore();
        }

        expect(await keymaster.acceptCredential(did)).toBe(true);
        const updated = (await keymaster.getCredential(did))!;
        expect(updated.issuer).toBe(alice);
        expect(updated.signature!.signer).toBe(alice);
        expect((await keymaster.resolveAsset(did)).encrypted.sender).toBe(alice);
        await keymaster.setCurrentId('Alice');
        expect(await keymaster.getCredential(did)).toStrictEqual(updated);
    });

    it('should reject updates by the holder even when the issuer is in the wallet', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, bob));

        await keymaster.setCurrentId('Bob');
        const original = (await keymaster.getCredential(did))!;
        const candidate = copyJSON(original);
        candidate.credential = { email: 'updated@example.com' };
        const input = copyJSON(candidate);
        const events = await gatekeeper.exportDID(did);

        await expect(keymaster.updateCredential(did, candidate)).rejects.toThrow('Invalid parameter: credential.issuer');

        expect(candidate).toStrictEqual(input);
        expect(await gatekeeper.exportDID(did)).toStrictEqual(events);
        expect(await keymaster.getCredential(did)).toStrictEqual(original);
        expect((await keymaster.fetchIdInfo()).did).toBe(bob);
        expect(await keymaster.acceptCredential(did)).toBe(true);
    });

    it.each([undefined, '', 'did:test:other'])('should reject an invalid issuer (%p) before changing the credential', async (issuer) => {
        const alice = await keymaster.createId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, alice));
        const original = (await keymaster.getCredential(did))!;
        const candidate = { ...original, issuer } as VerifiableCredential;
        const signature = candidate.signature;
        const events = await gatekeeper.exportDID(did);

        await expect(keymaster.updateCredential(did, candidate)).rejects.toThrow('Invalid parameter: credential.issuer');

        expect(candidate.signature).toStrictEqual(signature);
        expect(await gatekeeper.exportDID(did)).toStrictEqual(events);
        expect(await keymaster.getCredential(did)).toStrictEqual(original);
    });

    it.each(['delegated', 'transferred'])('should update a credential with a %s controller using separate signing identities', async (mode) => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(
            await keymaster.bindCredential(schema, carol),
            mode === 'delegated' ? { controller: bob } : {},
        );
        if (mode === 'transferred') {
            expect(await keymaster.transferAsset(did, bob)).toBe(true);
        }
        const candidate = (await keymaster.getCredential(did))!;
        candidate.credential = { email: 'updated@example.com' };

        expect(await keymaster.updateCredential(did, candidate)).toBe(true);

        const updated = (await keymaster.getCredential(did))!;
        expect(updated.issuer).toBe(alice);
        expect(updated.signature!.signer).toBe(alice);
        expect(updated.credential).toStrictEqual(candidate.credential);
        expect(await keymaster.verifySignature(updated)).toBe(true);
        const doc = await keymaster.resolveDID(did);
        expect(doc.didDocument!.controller).toBe(bob);
        expect((await keymaster.resolveAsset(did)).encrypted.sender).toBe(alice);
        const events = await gatekeeper.exportDID(did);
        expect(events.at(-1)!.operation.signature!.signer).toBe(bob);

        await keymaster.setCurrentId('Carol');
        expect(await keymaster.getCredential(did)).toStrictEqual(updated);
        expect(await keymaster.acceptCredential(did)).toBe(true);
    });

    it('should not persist an update without the delegated controller key', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const did = await keymaster.issueCredential(await keymaster.bindCredential(schema, carol), { controller: bob });
        await keymaster.removeId('Bob');
        const original = (await keymaster.getCredential(did))!;
        const candidate = copyJSON(original);
        candidate.credential = { email: 'updated@example.com' };
        const events = await gatekeeper.exportDID(did);

        await expect(keymaster.updateCredential(did, candidate)).rejects.toThrow(UnknownIDError);

        expect(await gatekeeper.exportDID(did)).toStrictEqual(events);
        expect(await keymaster.getCredential(did)).toStrictEqual(original);
    });

    it('should throw exception on invalid parameters', async () => {
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);
        const vc = (await keymaster.getCredential(did))!;

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.updateCredential();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // Pass agent DID instead of credential DID
            await keymaster.updateCredential(bob, vc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: did not encrypted');
        }

        try {
            // Pass cipher DID instead of credential DID
            const cipherDID = await keymaster.encryptMessage('mock', bob);
            await keymaster.updateCredential(cipherDID, vc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did not encrypted JSON');
        }

        try {            // Pass cipher DID instead of credential DID
            const cipherDID = await keymaster.encryptJSON({ bob }, bob);
            await keymaster.updateCredential(cipherDID, vc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did is not a credential');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.updateCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: credential');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.updateCredential(did, {});
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential');
        }

        try {
            const vc2 = copyJSON(vc);
            delete vc2.credential;
            await keymaster.updateCredential(did, vc2);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential');
        }

        try {
            const vc2 = copyJSON(vc);
            delete vc2.credentialSubject;
            await keymaster.updateCredential(did, vc2);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential');
        }
    });
});

describe('revokeCredential', () => {
    it('should revoke a valid verifiable credential', async () => {
        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);

        const ok = await keymaster.revokeCredential(did);
        expect(ok).toBe(true);

        const revoked = await keymaster.resolveDID(did);
        expect(revoked.didDocument).toStrictEqual({ id: did });
        expect(revoked.didDocumentMetadata!.deactivated).toBe(true);
    });

    it('should throw exception if verifiable credential is already revoked', async () => {
        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);

        const ok1 = await keymaster.revokeCredential(did);
        expect(ok1).toBe(true);

        const revoked = await keymaster.resolveDID(did);
        expect(revoked.didDocument).toStrictEqual({ id: did });
        expect(revoked.didDocumentMetadata!.deactivated).toBe(true);

        try {
            await keymaster.revokeCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: DID deactivated');
        }
    });

    it('should throw exception if user does not control verifiable credential', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.setCurrentId('Bob');
        await keymaster.removeId('Alice');

        try {
            await keymaster.revokeCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

    });
});

describe('acceptCredential', () => {
    it('should add a valid verifiable credential to user wallet', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.setCurrentId('Bob');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(true);

        const wallet = await keymaster.loadWallet();
        expect(wallet.ids['Alice'].owned!.includes(did)).toBe(true);
        expect(wallet.ids['Bob'].held!.includes(did)).toBe(true);
    });

    it('should return false if user cannot decrypt credential', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Carol');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.setCurrentId('Carol');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(false);
    });

    it('should return false if user is not the credential subject', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Carol');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const vc1 = await keymaster.issueCredential(boundCredential);
        const credential = await keymaster.getCredential(vc1);
        const vc2 = await keymaster.encryptJSON(credential, 'Carol');

        await keymaster.setCurrentId('Carol');

        const ok = await keymaster.acceptCredential(vc2);
        expect(ok).toBe(false);
    });

    it('should return false if the verifiable credential is invalid', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Bob');

        const ok = await keymaster.acceptCredential(credentialDid);
        expect(ok).toBe(false);
    });

    it('should return false for decryptable non-credential data', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');
        const did = await keymaster.encryptJSON({ message: 'not a credential' }, bob);

        await keymaster.setCurrentId('Bob');
        await expect(keymaster.acceptCredential(did)).resolves.toBe(false);
    });

    it('should return false for an unsigned credential', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema, bob);
        const did = await keymaster.encryptJSON(credential, bob);

        await keymaster.setCurrentId('Bob');
        await expect(keymaster.acceptCredential(did)).resolves.toBe(false);
    });

    it('should return false when the credential signer is not its issuer', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Mallory');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Mallory');
        const credential = await keymaster.bindCredential(schema, bob);
        credential.issuer = alice;
        const signed = await keymaster.addSignature(credential);
        const did = await keymaster.encryptJSON(signed, bob);

        await keymaster.setCurrentId('Bob');
        await expect(keymaster.acceptCredential(did)).resolves.toBe(false);
    });

    it('should return false when the credential signature is invalid', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema, bob);
        const signed = await keymaster.addSignature(credential);
        signed.credential!.email = 'tampered@example.com';
        const did = await keymaster.encryptJSON(signed, bob);

        await keymaster.setCurrentId('Bob');
        await expect(keymaster.acceptCredential(did)).resolves.toBe(false);
    });
});
