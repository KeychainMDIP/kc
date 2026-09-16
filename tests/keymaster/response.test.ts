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
    it('should create a valid response to a simple challenge', async () => {
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

        const challenge = {
            credentials: [
                {
                    schema: credentialDid,
                    issuers: [alice]
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
        expect(response.responseNonce).toEqual(expect.any(String));

        const publicAsset = await keymaster.resolveAsset(responseDID) as Record<string, unknown>;
        expect(publicAsset).not.toHaveProperty('response');
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

describe('verifyResponse', () => {
    it('should verify valid response to empty challenge', async () => {
        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');
        const challengeDID = await keymaster.createChallenge();

        await keymaster.setCurrentId('Bob');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Alice');
        const publishReceipts = jest.spyOn(keymaster, 'publishChallengeReceipts');
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
        expect(publishReceipts).toHaveBeenCalledWith(responseDID, { verification: verify });

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
            const publishReceipts = jest.spyOn(keymaster, 'publishChallengeReceipts');

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
            const publishReceipts = jest.spyOn(keymaster, 'publishChallengeReceipts');
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
            const publishReceipts = jest.spyOn(keymaster, 'publishChallengeReceipts');
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

    it('should reject a presentation without the requested schema', async () => {
        await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        await keymaster.setCurrentId('Alice');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.bindCredential(schema, carol);
        credential.type = ['VerifiableCredential'];
        const vc = await keymaster.issueCredential(credential);

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

        const publishReceipts = jest.spyOn(keymaster, 'publishChallengeReceipts');
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
        const publishReceipts = jest.spyOn(keymaster, 'publishChallengeReceipts')
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

        const verifyResponse = jest.spyOn(keymaster, 'verifyResponse');
        const defaultReceiptDIDs = await keymaster.publishChallengeReceipts(responseDID);
        expect(defaultReceiptDIDs).toHaveLength(1);
        expect(verifyResponse).toHaveBeenCalledTimes(1);
        expect(verifyResponse).toHaveBeenCalledWith(responseDID, {
            retries: undefined,
            delay: undefined,
            publish: false,
        });
        verifyResponse.mockRestore();

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
                            '@context': [],
                            type: ['VerifiableCredential'],
                            issuer: victor,
                            validFrom: '2026-01-01T00:00:00.000Z',
                            credentialSubject: {
                                id: victor,
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
        const verification: ChallengeResponse = {
            challenge: challengeDID,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: true,
            responseNonce: 'mock-nonce',
            vps: [
                {
                    '@context': [],
                    type: ['VerifiableCredential', schemaDid],
                    issuer: victor,
                    validFrom: '2026-01-01T00:00:00.000Z',
                    credentialSubject: {
                        id: victor,
                    },
                },
                {
                    '@context': [],
                    type: ['VerifiableCredential', schemaDid],
                    issuer: victor,
                    validFrom: '2026-01-01T00:00:00.000Z',
                    credentialSubject: {
                        id: victor,
                    },
                },
            ],
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
