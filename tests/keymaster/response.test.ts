import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import { ChallengeReceipt, ChallengeResponse, VerifiableCredential } from '@mdip/keymaster/types';
import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { InvalidDIDError, ExpectedExceptionError, UnknownIDError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { mockSchema } from './helper.ts';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;

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
});

describe('createResponse', () => {
    it.each(['omitted', 'empty', 'matching', 'multiple'] as const)('should create and verify a response with %s issuers', async issuerList => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const vcDid = await keymaster.issueCredential(boundCredential);

        await keymaster.setCurrentId('Bob');

        const ok = await keymaster.acceptCredential(vcDid);
        expect(ok).toBe(true);

        const wallet = await keymaster.loadWallet();
        expect(wallet.ids['Alice'].owned!.includes(vcDid)).toBe(true);
        expect(wallet.ids['Bob'].held!.includes(vcDid)).toBe(true);

        await keymaster.setCurrentId('Victor');

        const issuers = {
            omitted: undefined,
            empty: [],
            matching: [alice],
            multiple: [bob, alice],
        }[issuerList];
        const challenge = {
            credentials: [
                {
                    schema: credentialDid,
                    issuers,
                }
            ]
        };
        const challengeDID = await keymaster.createChallenge(challenge);

        await keymaster.setCurrentId('Bob');
        const responseDID = await keymaster.createResponse(challengeDID);
        const { response } = await keymaster.decryptJSON(responseDID) as { response: ChallengeResponse };

        expect(response.challenge).toBe(challengeDID);
        expect(response.credentials.length).toBe(1);
        expect(response.credentials[0].vc).toBe(vcDid);
        expect(response.fulfilled).toBe(1);
        expect(response.match).toBe(true);
        expect(response.responseNonce).toEqual(expect.any(String));

        const publicAsset = await keymaster.resolveAsset(responseDID) as Record<string, unknown>;
        expect(publicAsset).not.toHaveProperty('response');

        await keymaster.setCurrentId('Victor');
        const verified = await keymaster.verifyResponse(responseDID, { publish: false });
        expect(verified.match).toBe(true);
        expect(verified.vps).toHaveLength(1);
        expect(verified.vps![0].issuer).toBe(alice);
    });

    it.each(['unlisted issuer', 'wrong schema'] as const)('should reject %s during selection and verification', async mismatch => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const victor = await keymaster.createId('Victor');
        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const otherSchema = await keymaster.createSchema({ ...mockSchema, title: 'Other schema' });
        const vc = await keymaster.issueCredential(await keymaster.bindCredential(schema, bob));
        await keymaster.setCurrentId('Bob');
        expect(await keymaster.acceptCredential(vc)).toBe(true);

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({ credentials: [{
            schema: mismatch === 'wrong schema' ? otherSchema : schema,
            issuers: mismatch === 'unlisted issuer' ? [victor] : [],
        }] });
        await keymaster.setCurrentId('Bob');
        const generated = await keymaster.createResponse(challenge);
        const { response } = await keymaster.decryptJSON(generated) as { response: ChallengeResponse };
        expect(response.credentials).toStrictEqual([]);
        expect(response.requested).toBe(1);
        expect(response.fulfilled).toBe(0);
        expect(response.match).toBe(false);

        // Supply the same credential manually to check the verifier independently.
        const vp = await keymaster.encryptMessage(await keymaster.decryptMessage(vc), victor, { includeHash: true });
        response.credentials = [{ vc, vp }];
        response.fulfilled = 1;
        response.match = true;
        const supplied = await keymaster.encryptJSON({ response }, victor);

        await keymaster.setCurrentId('Victor');
        for (const did of [generated, supplied]) {
            const verified = await keymaster.verifyResponse(did, { publish: false });
            expect(verified.match).toBe(false);
            expect(verified.vps).toStrictEqual([]);
        }
    });

    it.each([
        ['at type[1] with an additional type', true],
        ['after another type', false],
    ] as const)('uses the schema %s during creation and verification', async (_position, schemaAtIndexOne) => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema, bob);
        credential.type = schemaAtIndexOne
            ? ['VerifiableCredential', schema, 'EmployeeCredential']
            : ['VerifiableCredential', 'EmployeeCredential', schema];
        const vc = await keymaster.issueCredential(credential);

        await keymaster.setCurrentId('Bob');
        expect(await keymaster.acceptCredential(vc)).toBe(true);
        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({ credentials: [{ schema, issuers: [alice] }] });
        await keymaster.setCurrentId('Bob');
        const generated = await keymaster.createResponse(challenge);
        const { response } = await keymaster.decryptJSON(generated) as { response: ChallengeResponse };

        expect(response.credentials.map(pair => pair.vc)).toStrictEqual(schemaAtIndexOne ? [vc] : []);
        expect(response.match).toBe(schemaAtIndexOne);

        const vp = await keymaster.encryptMessage(await keymaster.decryptMessage(vc), victor, { includeHash: true });
        const supplied = await keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [{ vc, vp }],
                requested: 1,
                fulfilled: 1,
                match: true,
                responseNonce: 'mock-nonce',
            },
        }, victor);

        await keymaster.setCurrentId('Victor');
        for (const did of [generated, supplied]) {
            expect((await keymaster.verifyResponse(did, { publish: false })).match).toBe(schemaAtIndexOne);
        }
    });

    it('should skip an invalidly signed credential and select a valid alternative', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema, bob);
        const invalid = await keymaster.addSignature(credential);
        invalid.credential!.email = 'tampered@example.com';
        const invalidDid = await keymaster.encryptJSON(invalid, bob);
        const validDid = await keymaster.issueCredential(credential);

        await keymaster.setCurrentId('Bob');
        expect(await keymaster.acceptCredential(validDid)).toBe(true);
        const wallet = await keymaster.loadWallet();
        wallet.ids.Bob.held!.unshift(invalidDid);
        await keymaster.saveWallet(wallet);

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({ credentials: [{ schema, issuers: [alice] }] });
        await keymaster.setCurrentId('Bob');
        const responseDid = await keymaster.createResponse(challenge);
        const { response } = await keymaster.decryptJSON(responseDid) as { response: ChallengeResponse };

        expect(response.credentials.map(pair => pair.vc)).toStrictEqual([validDid]);
        expect(response.match).toBe(true);

        await keymaster.setCurrentId('Victor');
        expect((await keymaster.verifyResponse(responseDid, { publish: false })).match).toBe(true);
    });

    it('should throw an exception on invalid challenge', async () => {
        const alice = await keymaster.createId('Alice');

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.createResponse();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.createResponse('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

        try {
            await keymaster.createResponse('did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.createResponse('did:mock', { retries: 10, delay: 10 });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.createResponse(alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challengeDID');
        }
    });
});

describe('credential validity periods', () => {
    const now = Date.parse('2030-06-15T12:00:00.000Z');
    const past = new Date(now - 60_000).toISOString();
    const current = new Date(now).toISOString();
    const future = new Date(now + 60_000).toISOString();
    const cases: [string, Record<string, unknown>, boolean][] = [
        ['within the window', { validFrom: past, validUntil: future }, true],
        ['at validFrom', { validFrom: current }, true],
        ['just before validUntil', { validUntil: new Date(now + 1).toISOString() }, true],
        ['at validUntil', { validUntil: current }, false],
        ['expired', { validUntil: past }, false],
        ['not yet valid', { validFrom: future }, false],
        ['reversed window', { validFrom: future, validUntil: past }, false],
        ['empty window', { validFrom: current, validUntil: current }, false],
        ['no validUntil', {}, true],
        ['legacy null validUntil', { validUntil: null }, true],
        ['no validFrom', { validFrom: undefined, validUntil: future }, true],
        ['no bounds', { validFrom: undefined }, true],
        ['null bounds', { validFrom: null, validUntil: null }, true],
        ['offset validFrom', { validFrom: '2030-06-15T13:00:00+01:00' }, true],
        ['offset validUntil', { validUntil: '2030-06-15T08:00:00-04:00' }, false],
        ['timezone-free validFrom', { validFrom: '2030-06-15T00:00:00' }, false],
        ['timezone-free validUntil', { validUntil: '2030-06-16T00:00:00' }, false],
        ['date-only validFrom', { validFrom: '2030-06-14' }, false],
        ['date-only validUntil', { validUntil: '2030-06-16' }, false],
        ['impossible validFrom', { validFrom: '2030-02-30T00:00:00Z' }, false],
        ['impossible validUntil', { validUntil: '2031-02-30T00:00:00Z' }, false],
        ['impossible offset date', { validUntil: '2031-04-31T23:00:00-04:00' }, false],
        ['non-leap February 29', { validFrom: '2030-02-29T00:00:00Z' }, false],
        ['non-leap century', { validUntil: '2100-02-29T00:00:00Z' }, false],
        ['leap year', { validFrom: '2028-02-29T00:00:00Z' }, true],
        ['leap century', { validFrom: '2000-02-29T00:00:00Z' }, true],
        ['early year', { validFrom: '0001-01-01T00:00:00Z' }, true],
        ['negative year', { validFrom: '-0001-01-01T00:00:00Z' }, true],
        ['extended year', { validUntil: '10000-01-01T00:00:00Z' }, true],
        ['invalid month', { validUntil: '2031-13-01T00:00:00Z' }, false],
        ['invalid day', { validUntil: '2031-01-00T00:00:00Z' }, false],
        ['invalid hour', { validUntil: '2031-01-01T25:00:00Z' }, false],
        ['invalid minute', { validUntil: '2031-01-01T00:60:00Z' }, false],
        ['invalid second', { validUntil: '2031-01-01T00:00:60Z' }, false],
        ['invalid offset hour', { validUntil: '2031-01-01T00:00:00+15:00' }, false],
        ['invalid offset minute', { validUntil: '2031-01-01T00:00:00+01:60' }, false],
        ['offset exceeds fourteen hours', { validUntil: '2031-01-01T00:00:00+14:01' }, false],
        ['maximum positive offset', { validFrom: '2030-06-16T02:00:00+14:00' }, true],
        ['maximum negative offset', { validUntil: '2030-06-14T22:00:00-14:00' }, false],
        ['trailing newline', { validFrom: `${past}\n` }, false],
        ['end of day', { validFrom: '2030-06-14T24:00:00Z' }, true],
        ['fractional end of day', { validFrom: '2030-06-14T24:00:00.0000Z' }, true],
        ['nonzero end-of-day minutes', { validUntil: '2031-01-01T24:01:00Z' }, false],
        ['nonzero end-of-day seconds', { validUntil: '2031-01-01T24:00:01Z' }, false],
        ['nonzero end-of-day fraction', { validUntil: '2031-01-01T24:00:00.0001Z' }, false],
        ['submillisecond future start', { validFrom: '2030-06-15T12:00:00.0009Z' }, false],
        ['submillisecond future expiry', { validUntil: '2030-06-15T12:00:00.0009Z' }, true],
        ['submillisecond past start', { validFrom: '2030-06-15T11:59:59.9999Z' }, true],
        ['submillisecond past expiry', { validUntil: '2030-06-15T11:59:59.9999Z' }, false],
        ['higher precision at start', { validFrom: '2030-06-15T12:00:00.000000Z' }, true],
        ['higher precision at expiry', { validUntil: '2030-06-15T12:00:00.000000Z' }, false],
        ['higher precision offset start', { validFrom: '2030-06-15T13:00:00.000001+01:00' }, false],
        ['higher precision offset expiry', { validUntil: '2030-06-15T08:00:00.000001-04:00' }, true],
        ['very small fractional expiry', { validUntil: '2030-06-15T12:00:00.000000000000000000001Z' }, true],
        ['invalid validFrom', { validFrom: 'not a date' }, false],
        ['invalid validUntil', { validUntil: 'not a date' }, false],
        ['empty validFrom', { validFrom: '' }, false],
        ['empty validUntil', { validUntil: '' }, false],
        ['numeric validFrom', { validFrom: now - 60_000 }, false],
        ['numeric validUntil', { validUntil: now + 60_000 }, false],
        ['array validFrom', { validFrom: [past] }, false],
        ['array validUntil', { validUntil: [future] }, false],
    ];
    let clock: jest.SpiedFunction<typeof Date.now>;
    let alice: string;
    let bob: string;
    let victor: string;
    let schema: string;
    let challenge: string;

    beforeEach(async () => {
        clock = jest.spyOn(Date, 'now').mockReturnValue(now);
        keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase', defaultRegistry: 'local' });
        alice = await keymaster.createId('Alice');
        bob = await keymaster.createId('Bob');
        victor = await keymaster.createId('Victor');
        await keymaster.setCurrentId('Alice');
        schema = await keymaster.createSchema(mockSchema);
        await keymaster.setCurrentId('Victor');
        challenge = await keymaster.createChallenge({ credentials: [{ schema, issuers: [alice] }] }, { registry: 'local' });
    });

    afterEach(() => {
        clock.mockRestore();
    });

    async function createSignedCredential(validity: Record<string, unknown> = {}) {
        await keymaster.setCurrentId('Alice');
        const credential = await keymaster.bindCredential(schema, bob, { validFrom: past });
        Object.assign(credential, validity);
        // The signed validity window is independent of the asset's expiration.
        const signed = await keymaster.addSignature(credential);
        const vc = await keymaster.encryptJSON(signed, bob, { includeHash: true, registry: 'local' });
        expect((await keymaster.resolveDID(vc)).mdip?.validUntil).toBeUndefined();
        await keymaster.setCurrentId('Bob');
        const wallet = await keymaster.loadWallet();
        wallet.ids.Bob.held = [...(wallet.ids.Bob.held || []), vc];
        await keymaster.saveWallet(wallet);
        return vc;
    }

    async function presentCredential(vc: string) {
        const vp = await keymaster.encryptMessage(await keymaster.decryptMessage(vc), victor, { includeHash: true, registry: 'local' });
        // Construct the response without using the holder's credential selection.
        return keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [{ vc, vp }],
                requested: 1,
                fulfilled: 1,
                match: true,
                responseNonce: 'mock-nonce',
            },
        }, victor, { registry: 'local' });
    }

    it.each(cases)('selects only current credentials: %s', async (_name, validity, expected) => {
        const vc = await createSignedCredential(validity);
        const responseDID = await keymaster.createResponse(challenge, { registry: 'local' });
        const { response } = await keymaster.decryptJSON(responseDID) as { response: ChallengeResponse };

        expect(response.match).toBe(expected);
        expect(response.credentials.map(pair => pair.vc)).toStrictEqual(expected ? [vc] : []);
        expect(response.fulfilled).toBe(expected ? 1 : 0);
        expect((await keymaster.loadWallet()).ids.Bob.held).toContain(vc);
    });

    it.each(cases)('independently verifies the signed validity window: %s', async (_name, validity, expected) => {
        const vc = await createSignedCredential(validity);
        const responseDID = await presentCredential(vc);
        await keymaster.setCurrentId('Victor');
        const result = await keymaster.verifyResponse(responseDID, { publish: false });

        expect(result.match).toBe(expected);
        expect(result.vps).toHaveLength(expected ? 1 : 0);
        expect(result.responder).toBe(bob);
    });

    it.each([
        ['validFrom', false, true],
        ['validUntil', true, false],
    ] as const)('crosses a submillisecond %s boundary at the next clock tick', async (field, before, after) => {
        const vc = await createSignedCredential({ [field]: '2030-06-15T12:00:00.0009Z' });
        const responseDID = await presentCredential(vc);

        for (const [elapsed, expected] of [[0, before], [1, after]] as const) {
            clock.mockReturnValue(now + elapsed);
            await keymaster.setCurrentId('Bob');
            const selectedDID = await keymaster.createResponse(challenge, { registry: 'local' });
            const { response } = await keymaster.decryptJSON(selectedDID) as { response: ChallengeResponse };
            expect(response.match).toBe(expected);

            await keymaster.setCurrentId('Victor');
            expect((await keymaster.verifyResponse(responseDID, { publish: false })).match).toBe(expected);
        }
    });

    it('skips unusable credentials and selects a later current credential without removing any', async () => {
        const held = [];
        for (const validity of [{ validUntil: past }, { validFrom: future }, { validUntil: 'invalid' }, {}]) {
            const vc = await createSignedCredential(validity);
            held.push(vc);
        }

        const responseDID = await keymaster.createResponse(challenge, { registry: 'local' });
        const { response } = await keymaster.decryptJSON(responseDID) as { response: ChallengeResponse };
        expect(response.credentials.map(pair => pair.vc)).toStrictEqual([held[3]]);
        expect((await keymaster.loadWallet()).ids.Bob.held).toStrictEqual(held);

        await keymaster.setCurrentId('Victor');
        expect((await keymaster.verifyResponse(responseDID, { publish: false })).match).toBe(true);
    });

    it.each([false, true])('rejects a credential that expires after response creation with publish=%s', async (publish) => {
        const vc = await createSignedCredential({ validUntil: future });
        const responseDID = await keymaster.createResponse(challenge, { registry: 'local' });
        await keymaster.setCurrentId('Victor');
        expect((await keymaster.verifyResponse(responseDID, { publish: false })).match).toBe(true);

        clock.mockReturnValue(now + 60_000);
        const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');
        try {
            const result = await keymaster.verifyResponse(responseDID, { publish });
            expect(result.match).toBe(false);
            expect(result.vps).toStrictEqual([]);
            expect(publishReceipts).not.toHaveBeenCalled();
            expect((await keymaster.resolveDID(vc)).didDocumentMetadata?.deactivated).not.toBe(true);
        } finally {
            publishReceipts.mockRestore();
        }
    });
});

describe('verifyResponse', () => {
    it('should verify valid response to empty challenge', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');
        const challengeDID = await keymaster.createChallenge();

        await keymaster.setCurrentId('Bob');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Alice');
        const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');
        const verify = await keymaster.verifyResponse(responseDID);

        const expected = {
            challenge: challengeDID,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: true,
            responseNonce: expect.any(String),
            vps: [],
            responder: bob,
        };

        expect(verify).toStrictEqual(expected);
        expect(publishReceipts).toHaveBeenCalledWith(responseDID, alice, { verification: verify });

        publishReceipts.mockClear();
        await expect(keymaster.verifyResponse(responseDID, { publish: false })).resolves.toStrictEqual(expected);
        expect(publishReceipts).not.toHaveBeenCalled();
        publishReceipts.mockRestore();
    });

    describe('challenge ownership', () => {
        let other: Keymaster;
        let otherDID: string;
        let verifierDID: string;

        beforeEach(async () => {
            verifierDID = await keymaster.createId('Verifier');
            other = new Keymaster({ gatekeeper, wallet: new WalletJsonMemory(), cipher, passphrase: 'passphrase' });
            otherDID = await other.createId('Other');
        });

        it.each([false, true, undefined])('rejects a foreign empty challenge before publishing with publish=%s', async (publish) => {
            const challenge = await other.createChallenge({ credentials: [] });
            const response = await other.createResponse(challenge);
            const wrapper = await other.decryptJSON(response);
            const forwarded = await other.encryptJSON(wrapper, verifierDID);
            const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');

            try {
                await expect(keymaster.verifyResponse(forwarded, { publish }))
                    .rejects.toThrow('Invalid parameter: requesterDid');
                expect(publishReceipts).not.toHaveBeenCalled();
            } finally {
                publishReceipts.mockRestore();
            }
        });

        it('rejects a foreign challenge even when its credential requirements are satisfied', async () => {
            const schema = await other.createSchema(mockSchema);
            const vc = await other.issueCredential(await other.bindCredential(schema, otherDID));
            await other.acceptCredential(vc);
            const challenge = await other.createChallenge({ credentials: [{ schema, issuers: [otherDID] }] });
            const response = await other.createResponse(challenge);
            const wrapper = await other.decryptJSON(response) as { response: ChallengeResponse };
            expect(wrapper.response.fulfilled).toBe(1);

            const vp = await other.encryptMessage(await other.decryptMessage(vc), verifierDID, { includeHash: true });
            wrapper.response.credentials = [{ vc, vp }];
            const forwarded = await other.encryptJSON(wrapper, verifierDID);

            await expect(keymaster.verifyResponse(forwarded, { publish: false }))
                .rejects.toThrow('Invalid parameter: requesterDid');
        });

        it('requires the active verifier, not merely another identity in its wallet', async () => {
            const secondVerifier = await keymaster.createId('SecondVerifier');
            const challenge = await keymaster.createChallenge();
            expect((await keymaster.resolveDID(challenge)).didDocument!.controller).toBe(secondVerifier);
            const response = await other.createResponse(challenge);
            const forwarded = await other.encryptJSON(await other.decryptJSON(response), verifierDID);

            await keymaster.setCurrentId('Verifier');
            await expect(keymaster.verifyResponse(forwarded, { publish: false }))
                .rejects.toThrow('Invalid parameter: requesterDid');
        });

        it.each([false, undefined])('accepts the verifier\'s empty challenge with publish=%s', async (publish) => {
            const challenge = await keymaster.createChallenge({ credentials: [] });
            const response = await other.createResponse(challenge);

            const result = await keymaster.verifyResponse(response, { publish });
            expect(result.match).toBe(true);
            expect(result.challenge).toBe(challenge);
            expect(result.responder).toBe(otherDID);
            expect(result.vps).toStrictEqual([]);
        });

        it('rejects a revoked challenge', async () => {
            const challenge = await keymaster.createChallenge();
            const response = await other.createResponse(challenge);
            await keymaster.revokeDID(challenge);

            await expect(keymaster.verifyResponse(response, { publish: false }))
                .rejects.toThrow('Invalid parameter: challengeDID');
        });

        it.each(['missing data', 'missing challenge', 'missing controller'])('rejects a challenge with %s', async (invalid) => {
            const challenge = await keymaster.createChallenge();
            const response = await other.createResponse(challenge);
            const doc = await keymaster.resolveDID(challenge);
            if (invalid === 'missing data') {
                delete doc.didDocumentData;
            } else if (invalid === 'missing challenge') {
                doc.didDocumentData = {};
            } else {
                delete doc.didDocument!.controller;
            }
            const resolveDID = keymaster.resolveDID.bind(keymaster);
            const resolve = jest.spyOn(keymaster, 'resolveDID').mockImplementation(async (did, options) => {
                return did === challenge ? doc : resolveDID(did, options);
            });

            try {
                await expect(keymaster.verifyResponse(response, { publish: false }))
                    .rejects.toThrow(`Invalid parameter: ${invalid === 'missing controller' ? 'requesterDid' : 'challengeDID'}`);
            } finally {
                resolve.mockRestore();
            }
        });

        it('uses the same resolved challenge for ownership and credential requirements', async () => {
            const challenge = await keymaster.createChallenge();
            const response = await other.createResponse(challenge);
            const resolveDID = keymaster.resolveDID.bind(keymaster);
            let challengeReads = 0;
            const resolve = jest.spyOn(keymaster, 'resolveDID').mockImplementation(async (did, options) => {
                if (did === challenge && ++challengeReads > 1) {
                    throw new Error('challenge changed during verification');
                }
                return resolveDID(did, options);
            });

            try {
                expect((await keymaster.verifyResponse(response, { publish: false })).match).toBe(true);
                expect(challengeReads).toBe(1);
            } finally {
                resolve.mockRestore();
            }
        });
    });

    it('should verify a valid response to a single credential challenge', async () => {
        await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');

        const credential1 = await keymaster.createSchema(mockSchema);
        const bc1 = await keymaster.bindCredential(credential1, carol);
        const vc1 = await keymaster.issueCredential(bc1);

        await keymaster.setCurrentId('Carol');

        await keymaster.acceptCredential(vc1);

        await keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credential1,
                },
            ]
        };
        const challengeDID = await keymaster.createChallenge(challenge);

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(responseDID);

        expect(verify1.match).toBe(true);
        expect(verify1.challenge).toBe(challengeDID);
        expect(verify1.requested).toBe(1);
        expect(verify1.fulfilled).toBe(1);
        expect(verify1.vps!.length).toBe(1);
    });

    describe('subject and responder binding', () => {
        let other: Keymaster;
        let alice: string;
        let carol: string;
        let dave: string;
        let victor: string;
        let schema: string;
        let vc: string;
        let plaintext: string;
        let challenge: string;
        let responseDID: string;
        let payload: { response: ChallengeResponse };

        beforeEach(async () => {
            keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase', defaultRegistry: 'local' });
            alice = await keymaster.createId('Alice', { registry: 'local' });
            carol = await keymaster.createId('Carol', { registry: 'local' });
            victor = await keymaster.createId('Victor', { registry: 'local' });
            other = new Keymaster({ gatekeeper, wallet: new WalletJsonMemory(), cipher, passphrase: 'passphrase' });
            dave = await other.createId('Dave', { registry: 'local' });

            await keymaster.setCurrentId('Alice');
            schema = await keymaster.createSchema(mockSchema, { registry: 'local' });
            vc = await keymaster.issueCredential(await keymaster.bindCredential(schema, carol), { registry: 'local' });

            await keymaster.setCurrentId('Carol');
            plaintext = await keymaster.decryptMessage(vc);
            expect(await keymaster.verifySignature(JSON.parse(plaintext))).toBe(true);

            await keymaster.setCurrentId('Victor');
            challenge = await keymaster.createChallenge({ credentials: [{ schema, issuers: [alice] }] }, { registry: 'local' });

            // Dave receives the plaintext, but none of Carol's private keys.
            const vp = await other.encryptMessage(plaintext, victor, { includeHash: true, registry: 'local' });
            const vcData = await keymaster.resolveAsset(vc);
            const vpData = await keymaster.resolveAsset(vp);
            expect(vpData.encrypted.cipher_hash).toBe(vcData.encrypted.cipher_hash);
            expect(cipher.hashMessage(plaintext)).toBe(vcData.encrypted.cipher_hash);

            payload = { response: {
                challenge,
                credentials: [{ vc, vp }],
                requested: 1,
                fulfilled: 1,
                match: true,
                responseNonce: 'mock-nonce',
            } };
            responseDID = await other.encryptJSON(payload, victor, { registry: 'local' });
        });

        it.each([false, undefined])('rejects another subject\'s credential with publish=%s', async (publish) => {
            const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');
            try {
                const result = await keymaster.verifyResponse(responseDID, { publish });
                expect(result.match).toBe(false);
                expect(result.responder).toBe(dave);
                expect(result.vps).toStrictEqual([]);
                expect(publishReceipts).not.toHaveBeenCalled();
            } finally {
                publishReceipts.mockRestore();
            }
        });

        it.each([false, undefined])('rejects transferring the response to its credential subject with publish=%s', async (publish) => {
            expect(await other.transferAsset(responseDID, carol)).toBe(true);
            const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');
            try {
                await expect(keymaster.verifyResponse(responseDID, { publish }))
                    .rejects.toThrow('Invalid parameter: response sender');
                expect(publishReceipts).not.toHaveBeenCalled();
            } finally {
                publishReceipts.mockRestore();
            }
        });

        it('ignores a responder supplied inside the response payload', async () => {
            payload.response.responder = carol;
            responseDID = await other.encryptJSON(payload, victor, { registry: 'local' });

            const result = await keymaster.verifyResponse(responseDID, { publish: false });
            expect(result.match).toBe(false);
            expect(result.responder).toBe(dave);
            expect(result.vps).toStrictEqual([]);
        });

        it('binds the subject to the outer response, not the presentation sender', async () => {
            await keymaster.setCurrentId('Carol');
            const vp = await keymaster.encryptMessage(plaintext, victor, { includeHash: true, registry: 'local' });
            payload.response.credentials = [{ vc, vp }];
            responseDID = await other.encryptJSON(payload, victor, { registry: 'local' });

            await keymaster.setCurrentId('Victor');
            const result = await keymaster.verifyResponse(responseDID, { publish: false });
            expect(result.match).toBe(false);
            expect(result.responder).toBe(dave);
            expect(result.vps).toStrictEqual([]);
        });

        it('accepts the subject\'s response when its presentation asset has a delegated controller', async () => {
            await keymaster.setCurrentId('Carol');
            const vp = await keymaster.encryptMessage(plaintext, victor, { includeHash: true, controller: alice, registry: 'local' });
            expect((await keymaster.resolveDID(vp)).didDocument!.controller).toBe(alice);
            payload.response.credentials = [{ vc, vp }];
            responseDID = await keymaster.encryptJSON(payload, victor, { registry: 'local' });

            await keymaster.setCurrentId('Victor');
            const result = await keymaster.verifyResponse(responseDID, { publish: false });
            expect(result.match).toBe(true);
            expect(result.responder).toBe(carol);
            expect(result.vps).toStrictEqual([JSON.parse(plaintext)]);
        });

        it.each([undefined, null, {}, { id: '' }, { id: 123 }, []])(
            'rejects a signed credential with an invalid subject %j', async (subject) => {
                const credential = JSON.parse(plaintext) as VerifiableCredential;
                delete credential.signature;
                credential.credentialSubject = subject as VerifiableCredential['credentialSubject'];

                await keymaster.setCurrentId('Alice');
                const signed = await keymaster.addSignature(credential);
                expect(await keymaster.verifySignature(signed)).toBe(true);
                const message = JSON.stringify(signed);
                const invalidVC = await keymaster.encryptMessage(message, carol, { includeHash: true, registry: 'local' });
                const vp = await other.encryptMessage(message, victor, { includeHash: true, registry: 'local' });
                payload.response.credentials = [{ vc: invalidVC, vp }];
                responseDID = await other.encryptJSON(payload, victor, { registry: 'local' });

                await keymaster.setCurrentId('Victor');
                const result = await keymaster.verifyResponse(responseDID, { publish: false });
                expect(result.match).toBe(false);
                expect(result.vps).toStrictEqual([]);
            }
        );

        it.each([false, true])('counts only the responder\'s credentials when the foreign credential is required=%s', async (required) => {
            await keymaster.setCurrentId('Alice');
            const ownSchema = await keymaster.createSchema({ ...mockSchema, title: 'Dave credential' }, { registry: 'local' });
            const ownVC = await keymaster.issueCredential(await keymaster.bindCredential(ownSchema, dave), { registry: 'local' });
            const ownPlaintext = await other.decryptMessage(ownVC);
            const vp = await other.encryptMessage(ownPlaintext, victor, { includeHash: true, registry: 'local' });
            payload.response.credentials.push({ vc: ownVC, vp });
            responseDID = await other.encryptJSON(payload, victor, { registry: 'local' });

            await keymaster.setCurrentId('Victor');
            const credentials = [{ schema: ownSchema, issuers: [alice] }];
            if (required) {
                credentials.push({ schema, issuers: [alice] });
            }
            await keymaster.updateAsset(challenge, { challenge: { credentials } });

            const result = await keymaster.verifyResponse(responseDID, { publish: false });
            expect(result.match).toBe(!required);
            expect(result.responder).toBe(dave);
            expect(result.vps).toStrictEqual([JSON.parse(ownPlaintext)]);
        });

        it('rejects an outer response created with a different controller from its sender', async () => {
            await keymaster.setCurrentId('Alice');
            responseDID = await keymaster.encryptJSON(payload, victor, { controller: carol, registry: 'local' });

            await keymaster.setCurrentId('Victor');
            await expect(keymaster.verifyResponse(responseDID, { publish: false }))
                .rejects.toThrow('Invalid parameter: response sender');
        });

        it('cannot authenticate as the subject by changing sender metadata and transferring the response', async () => {
            const data = await other.resolveAsset(responseDID);
            data.encrypted.sender = carol;
            await other.updateAsset(responseDID, data);
            await other.transferAsset(responseDID, carol);

            await expect(keymaster.verifyResponse(responseDID, { publish: false }))
                .rejects.toThrow("ID can't decrypt ciphertext");
        });

        it('decrypts the checked response version without resolving it again', async () => {
            const resolveDID = keymaster.resolveDID.bind(keymaster);
            let responseReads = 0;
            const resolve = jest.spyOn(keymaster, 'resolveDID').mockImplementation(async (did, options) => {
                if (did === responseDID && ++responseReads > 1) {
                    throw new Error('response changed during verification');
                }
                return resolveDID(did, options);
            });
            try {
                const result = await keymaster.verifyResponse(responseDID, { publish: false });
                expect(result.match).toBe(false);
                expect(result.responder).toBe(dave);
                expect(responseReads).toBe(1);
            } finally {
                resolve.mockRestore();
            }
        });
    });

    describe('response envelope validation', () => {
        let alice: string;
        let responseDID: string;

        beforeEach(async () => {
            alice = await keymaster.createId('Alice');
            await keymaster.createId('Bob');
            await keymaster.setCurrentId('Alice');
            const challenge = await keymaster.createChallenge();
            await keymaster.setCurrentId('Bob');
            responseDID = await keymaster.createResponse(challenge);
            await keymaster.setCurrentId('Alice');
        });

        it.each([undefined, '', 123])('rejects an invalid response controller %j', async (controller) => {
            const doc = await keymaster.resolveDID(responseDID);
            doc.didDocument!.controller = controller as string;
            const resolve = jest.spyOn(keymaster, 'resolveDID').mockResolvedValueOnce(doc);
            try {
                await expect(keymaster.verifyResponse(responseDID, { publish: false }))
                    .rejects.toThrow('Invalid parameter: response controller');
            } finally {
                resolve.mockRestore();
            }
        });

        it('rejects a revoked response', async () => {
            await keymaster.setCurrentId('Bob');
            await keymaster.revokeDID(responseDID);
            await keymaster.setCurrentId('Alice');

            await expect(keymaster.verifyResponse(responseDID, { publish: false }))
                .rejects.toThrow('Invalid parameter: did not encrypted');
        });

        it('rejects a response with no document data', async () => {
            const doc = await keymaster.resolveDID(responseDID);
            delete doc.didDocumentData;
            const resolve = jest.spyOn(keymaster, 'resolveDID').mockResolvedValueOnce(doc);
            try {
                await expect(keymaster.verifyResponse(responseDID, { publish: false }))
                    .rejects.toThrow('Invalid parameter: did not encrypted');
            } finally {
                resolve.mockRestore();
            }
        });

        it('decrypts a response using the legacy flat envelope', async () => {
            const wrapper = await keymaster.decryptJSON(responseDID);
            await keymaster.setCurrentId('Bob');
            const encryptedDID = await keymaster.encryptJSON(wrapper, alice, { includeHash: true });
            const data = await keymaster.resolveAsset(encryptedDID);
            const legacyDID = await keymaster.createAsset(data.encrypted);

            await keymaster.setCurrentId('Alice');
            const result = await keymaster.verifyResponse(legacyDID, { publish: false });
            expect(result.match).toBe(true);
            expect(result.responder).toBe(data.encrypted.sender);
            expect(result.vps).toStrictEqual([]);
        });

        it.each([false, true])('decrypts a self-response with encryptForSender=%s', async (encryptForSender) => {
            const wrapper = await keymaster.decryptJSON(responseDID);
            const selfResponse = await keymaster.encryptJSON(wrapper, alice, { encryptForSender });

            const result = await keymaster.verifyResponse(selfResponse, { publish: false });
            expect(result.match).toBe(true);
            expect(result.responder).toBe(alice);
        });

        it('rejects a response that is not encrypted JSON', async () => {
            await keymaster.setCurrentId('Bob');
            responseDID = await keymaster.encryptMessage('not JSON', alice);
            await keymaster.setCurrentId('Alice');

            await expect(keymaster.verifyResponse(responseDID, { publish: false }))
                .rejects.toThrow('Invalid parameter: did not encrypted JSON');
        });

        it.each([null, 'text', {}])('rejects an invalid response wrapper %j', async (wrapper) => {
            await keymaster.setCurrentId('Bob');
            responseDID = await keymaster.encryptJSON(wrapper, alice);
            await keymaster.setCurrentId('Alice');

            await expect(keymaster.verifyResponse(responseDID, { publish: false }))
                .rejects.toThrow('Invalid parameter: responseDID not a valid challenge response');
        });
    });

    it('should reject a presentation whose signer is not its issuer', async () => {
        const alice = await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        await keymaster.createId('Mallory');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({
            credentials: [{ schema, issuers: [alice] }],
        });

        await keymaster.setCurrentId('Mallory');
        const credential = await keymaster.bindCredential(schema, carol);
        credential.issuer = alice;
        const signed = await keymaster.addSignature(credential);
        const vc = await keymaster.encryptJSON(signed, carol, { includeHash: true });

        await keymaster.setCurrentId('Carol');
        const vp = await keymaster.encryptMessage(
            await keymaster.decryptMessage(vc),
            victor,
            { includeHash: true }
        );
        const response = await keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [{ vc, vp }],
                requested: 1,
                fulfilled: 1,
                match: true,
                responseNonce: 'mock-nonce',
            },
        }, victor);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(response, { publish: false });

        expect(verification.match).toBe(false);
        expect(verification.vps).toStrictEqual([]);
    });

    it.each([undefined, null, 'https://www.w3.org/ns/credentials/v2', {}, [], ['https://www.w3.org/ns/credentials/examples/v2'], ['https://www.w3.org/ns/credentials/v2', 'not-a-url']])(
        'should reject a correctly signed presentation with invalid @context %j', async context => {
            const alice = await keymaster.createId('Alice');
            const carol = await keymaster.createId('Carol');
            const victor = await keymaster.createId('Victor');

            await keymaster.setCurrentId('Alice');
            const schema = await keymaster.createSchema(mockSchema);
            const credential: Record<string, unknown> = { ...await keymaster.bindCredential(schema, carol) };
            if (context === undefined) {
                delete credential['@context'];
            }
            else {
                credential['@context'] = context;
            }
            const signed = await keymaster.addSignature(credential);
            expect(await keymaster.verifySignature(signed)).toBe(true);
            const vc = await keymaster.encryptJSON(signed, carol, { includeHash: true });

            await keymaster.setCurrentId('Victor');
            const challenge = await keymaster.createChallenge({ credentials: [{ schema, issuers: [alice] }] });

            await keymaster.setCurrentId('Carol');
            expect(await keymaster.acceptCredential(vc)).toBe(false);
            const plaintext = await keymaster.decryptMessage(vc);
            const vp = await keymaster.encryptMessage(plaintext, victor, { includeHash: true });
            const vcData = await keymaster.resolveAsset(vc);
            const vpData = await keymaster.resolveAsset(vp);
            expect(cipher.hashMessage(plaintext)).toBe(vcData.encrypted.cipher_hash);
            expect(vpData.encrypted.cipher_hash).toBe(vcData.encrypted.cipher_hash);
            const response = await keymaster.encryptJSON({ response: {
                challenge,
                credentials: [{ vc, vp }],
                requested: 1,
                fulfilled: 1,
                match: true,
                responseNonce: 'mock-nonce',
            } }, victor);

            await keymaster.setCurrentId('Victor');
            const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');
            try {
                for (const publish of [false, true, undefined]) {
                    const verification = await keymaster.verifyResponse(response, { publish });
                    expect(verification.match).toBe(false);
                    expect(verification.vps).toStrictEqual([]);
                }
                expect(publishReceipts).not.toHaveBeenCalled();
            }
            finally {
                publishReceipts.mockRestore();
            }
        }
    );

    it.each(['missing schema', 'missing VerifiableCredential type'])('should reject a presentation with %s', async defect => {
        await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema, carol);
        credential.type = defect === 'missing schema' ? ['VerifiableCredential'] : ['NotACredential', schema];
        const vc = await keymaster.encryptJSON(await keymaster.addSignature(credential), carol, { includeHash: true });

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({
            credentials: [{ schema }],
        });

        await keymaster.setCurrentId('Carol');
        const plaintext = await keymaster.decryptMessage(vc);
        const vp = await keymaster.encryptMessage(plaintext, victor, { includeHash: true });
        const response = await keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [{ vc, vp }],
                requested: 1,
                fulfilled: 1,
                match: true,
                responseNonce: 'mock-nonce',
            },
        }, victor);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(response, { publish: false });

        expect(verification.match).toBe(false);
        expect(verification.vps).toStrictEqual([]);
    });

    it('should reject a presentation whose plaintext does not match the credential hash', async () => {
        const alice = await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schemaA = await keymaster.createSchema(mockSchema);
        const schemaB = await keymaster.createSchema(mockSchema);
        const vcA = await keymaster.issueCredential(await keymaster.bindCredential(schemaA, carol));
        const vcB = await keymaster.issueCredential(await keymaster.bindCredential(schemaB, carol));

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({
            credentials: [{ schema: schemaB, issuers: [alice] }],
        });

        await keymaster.setCurrentId('Carol');
        const vp = await keymaster.encryptMessage(
            await keymaster.decryptMessage(vcB),
            victor,
            { includeHash: true }
        );
        const vcData = await keymaster.resolveAsset(vcA);
        const vpData = await keymaster.resolveAsset(vp);
        vpData.encrypted.cipher_hash = vcData.encrypted.cipher_hash;
        await keymaster.updateAsset(vp, vpData);

        const response = await keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [{ vc: vcA, vp }],
                requested: 1,
                fulfilled: 1,
                match: true,
                responseNonce: 'mock-nonce',
            },
        }, victor);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(response, { publish: false });

        expect(verification.match).toBe(false);
        expect(verification.vps).toStrictEqual([]);
    });

    it('should reject a presentation that is not encrypted JSON', async () => {
        await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge();

        await keymaster.setCurrentId('Carol');
        const invalid = await keymaster.encryptMessage('not JSON', victor, { includeHash: true });
        const response = await keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [{ vc: invalid, vp: invalid }],
                requested: 0,
                fulfilled: 1,
                match: false,
                responseNonce: 'mock-nonce',
            },
        }, victor);

        await keymaster.setCurrentId('Victor');
        await expect(keymaster.verifyResponse(response, { publish: false }))
            .rejects.toThrow('Invalid parameter: did not encrypted JSON');
    });

    it('should not count a presentation more than once', async () => {
        const alice = await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema1 = await keymaster.createSchema(mockSchema);
        const schema2 = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema1, carol);
        const vc = await keymaster.issueCredential(credential);

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({
            credentials: [
                { schema: schema1, issuers: [alice] },
                { schema: schema2, issuers: [alice] },
            ],
        });

        await keymaster.setCurrentId('Carol');
        const plaintext = await keymaster.decryptMessage(vc);
        const vp = await keymaster.encryptMessage(plaintext, victor, { includeHash: true });
        const response = await keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [{ vc, vp }, { vc, vp }],
                requested: 2,
                fulfilled: 2,
                match: true,
                responseNonce: 'mock-nonce',
            },
        }, victor);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(response, { publish: false });

        expect(verification.match).toBe(false);
        expect(verification.vps).toHaveLength(1);
    });

    it('should match credentials independently of presentation order', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const vcAlice = await keymaster.issueCredential(await keymaster.bindCredential(schema, carol));

        await keymaster.setCurrentId('Bob');
        const vcBob = await keymaster.issueCredential(await keymaster.bindCredential(schema, carol));

        await keymaster.setCurrentId('Victor');
        const challenge = await keymaster.createChallenge({
            credentials: [
                { schema },
                { schema, issuers: [alice] },
            ],
        });

        await keymaster.setCurrentId('Carol');
        const vpAlice = await keymaster.encryptMessage(
            await keymaster.decryptMessage(vcAlice),
            victor,
            { includeHash: true }
        );
        const vpBob = await keymaster.encryptMessage(
            await keymaster.decryptMessage(vcBob),
            victor,
            { includeHash: true }
        );
        const response = await keymaster.encryptJSON({
            response: {
                challenge,
                credentials: [
                    { vc: vcAlice, vp: vpAlice },
                    { vc: vcBob, vp: vpBob },
                ],
                requested: 2,
                fulfilled: 2,
                match: true,
                responseNonce: 'mock-nonce',
            },
        }, victor);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(response, { publish: false });

        expect(verification.match).toBe(true);
        expect(verification.vps).toHaveLength(2);
    });

    it('should not verify a invalid response to a single credential challenge', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');

        const credential1 = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credential1,
                },
            ]
        };
        const challengeDID = await keymaster.createChallenge(challenge);

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Victor');

        const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');
        const verify1 = await keymaster.verifyResponse(responseDID);

        expect(verify1.match).toBe(false);
        expect(verify1.challenge).toBe(challengeDID);
        expect(verify1.requested).toBe(1);
        expect(verify1.fulfilled).toBe(0);
        expect(verify1.vps!.length).toBe(0);
        expect(publishReceipts).not.toHaveBeenCalled();
        publishReceipts.mockRestore();
    });

    it('should propagate receipt publication failures', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');
        const challengeDID = await keymaster.createChallenge();

        await keymaster.setCurrentId('Bob');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Alice');
        const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor')
            .mockRejectedValueOnce(new Error('receipt publication failed'));

        await expect(keymaster.verifyResponse(responseDID)).rejects.toThrow('receipt publication failed');
        publishReceipts.mockRestore();
    });

    it('should verify a response if credential is updated', async () => {
        await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');

        const credential1 = await keymaster.createSchema(mockSchema);
        const bc1 = await keymaster.bindCredential(credential1, carol);
        const vc1 = await keymaster.issueCredential(bc1);

        await keymaster.setCurrentId('Carol');
        await keymaster.acceptCredential(vc1);

        await keymaster.setCurrentId('Alice');
        const credential2 = (await keymaster.getCredential(vc1))!;
        credential2.credential = { email: 'updated@email.com' };
        await keymaster.updateCredential(vc1, credential2);

        await keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credential1,
                },
            ]
        };

        const challengeDID = await keymaster.createChallenge(challenge);

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(responseDID);

        expect(verify1.match).toBe(true);
        expect(verify1.challenge).toBe(challengeDID);
        expect(verify1.requested).toBe(1);
        expect(verify1.fulfilled).toBe(1);
        expect(verify1.vps!.length).toBe(1);
    });

    it('should demonstrate full workflow with credential revocations', async () => {
        const alice = await keymaster.createId('Alice', { registry: 'local' });
        const bob = await keymaster.createId('Bob', { registry: 'local' });
        const carol = await keymaster.createId('Carol', { registry: 'local' });
        await keymaster.createId('Victor', { registry: 'local' });

        await keymaster.setCurrentId('Alice');

        const schema1 = await keymaster.createSchema(mockSchema, { registry: 'local' });
        const schema2 = await keymaster.createSchema(mockSchema, { registry: 'local' });

        const bc1 = await keymaster.bindCredential(schema1, carol);
        const bc2 = await keymaster.bindCredential(schema2, carol);

        const vc1 = await keymaster.issueCredential(bc1, { registry: 'local' });
        const vc2 = await keymaster.issueCredential(bc2, { registry: 'local' });

        await keymaster.setCurrentId('Bob');

        const schema3 = await keymaster.createSchema(mockSchema, { registry: 'local' });
        const schema4 = await keymaster.createSchema(mockSchema, { registry: 'local' });

        const bc3 = await keymaster.bindCredential(schema3, carol);
        const bc4 = await keymaster.bindCredential(schema4, carol);

        const vc3 = await keymaster.issueCredential(bc3, { registry: 'local' });
        const vc4 = await keymaster.issueCredential(bc4, { registry: 'local' });

        await keymaster.setCurrentId('Carol');

        await keymaster.acceptCredential(vc1);
        await keymaster.acceptCredential(vc2);
        await keymaster.acceptCredential(vc3);
        await keymaster.acceptCredential(vc4);

        await keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: schema1,
                    issuers: [alice]
                },
                {
                    schema: schema2,
                    issuers: [alice]
                },
                {
                    schema: schema3,
                    issuers: [bob]
                },
                {
                    schema: schema4,
                    issuers: [bob]
                },
            ]
        };
        const challengeDID = await keymaster.createChallenge(challenge, { registry: 'local' });

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID, { registry: 'local' });
        const { response } = await keymaster.decryptJSON(responseDID) as { response: ChallengeResponse };

        expect(response.challenge).toBe(challengeDID);
        expect(response.credentials.length).toBe(4);

        await keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(responseDID, { publish: false });
        expect(verify1.match).toBe(true);
        expect(verify1.vps!.length).toBe(4);

        // All agents rotate keys
        await keymaster.setCurrentId('Alice');
        await keymaster.rotateKeys();

        await keymaster.setCurrentId('Bob');
        await keymaster.rotateKeys();

        await keymaster.setCurrentId('Carol');
        await keymaster.rotateKeys();

        await keymaster.setCurrentId('Victor');
        await keymaster.rotateKeys();

        const verify2 = await keymaster.verifyResponse(responseDID, { publish: false });
        expect(verify2.match).toBe(true);
        expect(verify2.vps!.length).toBe(4);

        await keymaster.setCurrentId('Alice');
        await keymaster.revokeCredential(vc1);

        await keymaster.setCurrentId('Victor');
        const verify3 = await keymaster.verifyResponse(responseDID, { publish: false })
        expect(verify3.match).toBe(false);
        expect(verify3.vps!.length).toBe(3);

        await keymaster.setCurrentId('Bob');
        await keymaster.revokeCredential(vc3);

        await keymaster.setCurrentId('Victor');
        const verify4 = await keymaster.verifyResponse(responseDID, { publish: false });
        expect(verify4.match).toBe(false);
        expect(verify4.vps!.length).toBe(2);
    });

    it('should raise exception on invalid parameter', async () => {
        const alice = await keymaster.createId('Alice');

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.verifyResponse();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.verifyResponse(alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did not encrypted');
        }

        try {
            await keymaster.verifyResponse('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

        try {
            await keymaster.verifyResponse('did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.verifyResponse('did:mock', { retries: 10, delay: 10 });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
        }
    });
});

describe('challenge receipts', () => {
    it('should build and publish receipts for successful challenge responses', async () => {
        const alice = await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schemaDid = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schemaDid, carol);
        const vcDid = await keymaster.issueCredential(credential);

        await keymaster.setCurrentId('Carol');
        await keymaster.acceptCredential(vcDid);

        await keymaster.setCurrentId('Victor');
        const challengeDID = await keymaster.createChallenge({
            credentials: [
                {
                    schema: schemaDid,
                    issuers: [alice],
                },
            ],
        });

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(responseDID);
        const responseCommitment = cipher.hashJSON({
            responseDid: responseDID,
            responseNonce: verification.responseNonce,
        });
        const expectedReceipt: ChallengeReceipt = {
            version: 1,
            attesterDid: alice,
            schemaDid,
            requesterDid: victor,
            responseCommitment,
        };

        const receipt = expectedReceipt;
        expect(receipt).not.toHaveProperty('holderDid');
        expect(receipt).not.toHaveProperty('credentialDid');
        expect(receipt).not.toHaveProperty('vpDid');
        expect(receipt).not.toHaveProperty('responseDid');
        expect(receipt).not.toHaveProperty('responseNonce');
        expect(receipt).not.toHaveProperty('credential');

        const receiptDIDs = await keymaster.publishChallengeReceipts(responseDID, {
            verification,
            registry: 'local',
        });

        expect(receiptDIDs).toHaveLength(1);

        const receiptAsset = await keymaster.resolveAsset(receiptDIDs[0]) as { challengeReceipt: ChallengeReceipt };
        expect(receiptAsset.challengeReceipt).toStrictEqual(expectedReceipt);

        const receiptDoc = await keymaster.resolveDID(receiptDIDs[0]);
        expect(receiptDoc.didDocument?.controller).toBe(victor);

        const defaultReceiptDIDs = await keymaster.publishChallengeReceipts(responseDID);
        expect(defaultReceiptDIDs).toHaveLength(1);

        const defaultReceiptAsset = await keymaster.resolveAsset(defaultReceiptDIDs[0]) as { challengeReceipt: ChallengeReceipt };
        expect(defaultReceiptAsset.challengeReceipt).toStrictEqual(expectedReceipt);
    });

    it('should reject receipts for unsuccessful challenge responses', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schemaDid = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Victor');
        const challengeDID = await keymaster.createChallenge({
            credentials: [
                {
                    schema: schemaDid,
                },
            ],
        });

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(responseDID);

        try {
            await keymaster.publishChallengeReceipts(responseDID, { verification });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: verification.match');
        }
    });

    it('should reject malformed receipt inputs', async () => {
        const victor = await keymaster.createId('Victor');
        const schemaDid = await keymaster.createSchema(mockSchema);
        const challengeDID = await keymaster.createChallenge({
            credentials: [
                {
                    schema: schemaDid,
                },
            ],
        });
        const emptyChallengeDID = await keymaster.createChallenge();
        const verification: ChallengeResponse = {
            challenge: challengeDID,
            credentials: [],
            requested: 1,
            fulfilled: 1,
            match: true,
            responseNonce: 'mock-nonce',
            vps: [],
        };
        const emptyVerification: ChallengeResponse = {
            challenge: emptyChallengeDID,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: true,
            responseNonce: 'mock-nonce',
        };

        await expect(keymaster.publishChallengeReceipts('did:mock:response', {
            verification: emptyVerification,
        })).resolves.toStrictEqual([]);

        try {
            await keymaster.publishChallengeReceipts('did:mock:response', {
                verification: {
                    ...verification,
                    responseNonce: undefined,
                },
            });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: response.responseNonce');
        }

        const resolveDID = jest.spyOn(keymaster, 'resolveDID')
            .mockResolvedValueOnce({ didDocument: {} } as any);
        try {
            await keymaster.publishChallengeReceipts('did:mock:response', { verification });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: requesterDid');
        }
        resolveDID.mockRestore();

        const resolveAsset = jest.spyOn(keymaster, 'resolveAsset')
            .mockResolvedValueOnce(null);
        try {
            await keymaster.publishChallengeReceipts('did:mock:response', { verification });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challengeDID');
        }
        resolveAsset.mockRestore();

        try {
            await keymaster.publishChallengeReceipts('did:mock:response', {
                verification: {
                    ...verification,
                    vps: undefined,
                },
            });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: verification.vps');
        }

        try {
            await keymaster.publishChallengeReceipts('did:mock:response', {
                verification: {
                    challenge: emptyChallengeDID,
                    credentials: [],
                    requested: 0,
                    fulfilled: 0,
                    match: true,
                    responseNonce: 'mock-nonce',
                    vps: [{} as any],
                },
            });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: verification.vps');
        }

        try {
            await keymaster.publishChallengeReceipts('did:mock:response', {
                verification: {
                    challenge: emptyChallengeDID,
                    credentials: [],
                    requested: 0,
                    fulfilled: 0,
                    match: true,
                    responseNonce: 'mock-nonce',
                    vps: [
                        {
                            '@context': ['https://www.w3.org/ns/credentials/v2'],
                            type: ['VerifiableCredential'],
                            issuer: victor,
                            validFrom: '2026-01-01T00:00:00.000Z',
                            credentialSubject: {
                                id: victor,
                            },
                            signature: {
                                signer: victor,
                                signed: '2026-01-01T00:00:00.000Z',
                                hash: 'mock-hash',
                                value: 'mock-signature',
                            },
                        },
                    ],
                },
            });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: verification.vps.type');
        }
    });

    it('should reject invalid receipt publish options', async () => {
        const victor = await keymaster.createId('Victor');
        const schemaDid = await keymaster.createSchema(mockSchema);
        const challengeDID = await keymaster.createChallenge();
        const vp: VerifiableCredential = {
            '@context': ['https://www.w3.org/ns/credentials/v2'],
            type: ['VerifiableCredential', schemaDid],
            issuer: victor,
            validFrom: '2026-01-01T00:00:00.000Z',
            credentialSubject: { id: victor },
            signature: {
                signer: victor,
                signed: '2026-01-01T00:00:00.000Z',
                hash: 'mock-hash',
                value: 'mock-signature',
            },
        };
        const verification: ChallengeResponse = {
            challenge: challengeDID,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: true,
            responseNonce: 'mock-nonce',
            vps: [vp, vp],
        };

        try {
            await keymaster.publishChallengeReceipts('did:mock:response', {
                verification,
                name: 'mock-receipt',
            });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.name');
        }
    });

    it('should only allow the challenge requester to publish receipts', async () => {
        const alice = await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schemaDid = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schemaDid, carol);
        const vcDid = await keymaster.issueCredential(credential);

        await keymaster.setCurrentId('Carol');
        await keymaster.acceptCredential(vcDid);

        await keymaster.setCurrentId('Victor');
        const challengeDID = await keymaster.createChallenge({
            credentials: [
                {
                    schema: schemaDid,
                    issuers: [alice],
                },
            ],
        });

        await keymaster.setCurrentId('Carol');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Victor');
        const verification = await keymaster.verifyResponse(responseDID);

        await keymaster.setCurrentId('Carol');

        try {
            await keymaster.publishChallengeReceipts(responseDID, { verification });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: requesterDid');
        }
    });
});
