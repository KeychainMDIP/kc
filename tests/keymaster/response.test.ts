import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import { ChallengeReceipt, ChallengeResponse } from '@mdip/keymaster/types';
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
