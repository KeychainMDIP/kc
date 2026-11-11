import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import {
    ChallengeResponse,
    PaymentInfo,
    PaymentInfoInput,
    UnsignedPaymentInfo,
} from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import HeliaClient from '@mdip/ipfs/helia';
import { generateCID } from '@mdip/ipfs/utils';
import { jest } from '@jest/globals';
import { mockSchema } from './helper.ts';

let ipfs: HeliaClient;
let keymaster: Keymaster;
let attestor: string;
let subject: string;
let requestor: string;
let schema: string;
let otherSchema: string;
let challenge: string;
let paymentInfo: PaymentInfo;

beforeAll(async () => {
    ipfs = new HeliaClient();
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
});

beforeEach(async () => {
    const gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('test'),
        ipfs,
        registries: ['local', 'hyperswarm'],
    });
    keymaster = new Keymaster({
        gatekeeper,
        wallet: new WalletJsonMemory(),
        cipher: new CipherNode(),
        passphrase: 'passphrase',
    });

    attestor = await keymaster.createId('Attestor');
    subject = await keymaster.createId('Subject');
    requestor = await keymaster.createId('Requestor');

    await keymaster.setCurrentId('Attestor');
    schema = await keymaster.createSchema(mockSchema);
    otherSchema = await keymaster.createSchema({ ...mockSchema, title: 'Other' });
    paymentInfo = await keymaster.createPaymentInfo(paymentInfoInput());

    await keymaster.setCurrentId('Requestor');
    challenge = await keymaster.createChallenge({
        credentials: [{ schema, issuers: [attestor] }],
    });
});

function paymentInfoInput(): PaymentInfoInput {
    return {
        network: 'testnet',
        schema,
        subject,
        outputs: [
            { role: 'subject', address: 'tb1qsubject', amountSats: 1_000 },
            { role: 'attestor', address: 'tb1qattestor', amountSats: 2_000 },
            { role: 'platform', address: 'tb1qplatform', amountSats: 500 },
        ],
    };
}

async function signUncheckedPaymentInfo(overrides: Record<string, unknown> = {}): Promise<PaymentInfo> {
    const unsigned: UnsignedPaymentInfo = {
        version: 1,
        type: 'bitcoin',
        ...paymentInfoInput(),
    };

    return keymaster.addSignature({ ...unsigned, ...overrides }) as Promise<PaymentInfo>;
}

async function createPaymentResponse(
    responder: 'Attestor' | 'Subject' = 'Attestor',
    info: PaymentInfo = paymentInfo,
    challengeDid: string = challenge
) {
    await keymaster.setCurrentId(responder);
    return keymaster.createResponse(challengeDid, {
        paymentOnly: true,
        paymentInfo: info,
    });
}

describe('payment-only challenge responses', () => {
    it('creates a validated payment packet signed by the current ID', async () => {
        await keymaster.setCurrentId('Attestor');
        const created = await keymaster.createPaymentInfo({
            ...paymentInfoInput(),
            subject: 'Subject',
        });

        expect(created).toMatchObject({
            version: 1,
            type: 'bitcoin',
            network: 'testnet',
            schema,
            subject,
            outputs: paymentInfoInput().outputs,
            signature: { signer: attestor },
        });
        await expect(keymaster.verifySignature(created)).resolves.toBe(true);
    });

    it.each([null, [], 'payment'])('rejects invalid payment input: %j', async input => {
        await expect(keymaster.createPaymentInfo(input as unknown as PaymentInfoInput))
            .rejects.toThrow('paymentInfo');
    });

    it('creates and verifies signed payment information without selecting credentials', async () => {
        await keymaster.setCurrentId('Attestor');
        const findCredential = jest.spyOn(keymaster as any, 'findMatchingCredential');
        const responseDid = await keymaster.createResponse(challenge, {
            paymentOnly: true,
            paymentInfo,
        });
        expect(findCredential).not.toHaveBeenCalled();

        const { response } = await keymaster.decryptJSON(responseDid) as { response: ChallengeResponse };
        expect(response).toMatchObject({
            challenge,
            credentials: [],
            requested: 1,
            fulfilled: 0,
            match: false,
            paymentInfo,
        });

        await keymaster.setCurrentId('Requestor');
        const publishReceipts = jest.spyOn(keymaster as any, 'publishChallengeReceiptsFor');
        const verified = await keymaster.verifyResponse(responseDid);
        expect(verified).toMatchObject({
            requested: 1,
            fulfilled: 0,
            match: false,
            vps: [],
            responder: attestor,
            paymentInfo,
        });
        expect(publishReceipts).not.toHaveBeenCalled();
    });

    it('allows the subject to reuse payment information signed by the attestor', async () => {
        const responseDid = await createPaymentResponse('Subject');

        await keymaster.setCurrentId('Requestor');
        const verified = await keymaster.verifyResponse(responseDid, { publish: false });
        expect(verified.responder).toBe(subject);
        expect(verified.paymentInfo?.signature.signer).toBe(attestor);
        expect(verified.paymentInfo).toStrictEqual(paymentInfo);
    });

    it('accepts optional, application-defined output roles', async () => {
        await keymaster.setCurrentId('Attestor');
        const singleOutput = await keymaster.createPaymentInfo({
            ...paymentInfoInput(),
            outputs: [
                { role: 'self', address: 'tb1qself', amountSats: 2_000 },
                { address: 'tb1qunlabelled', amountSats: 1_000 },
            ],
        });
        await expect(keymaster.createResponse(challenge, {
            paymentOnly: true,
            paymentInfo: singleOutput,
        })).resolves.toEqual(expect.any(String));
    });

    it('recomputes payment response counts from the challenge', async () => {
        const responseDid = await createPaymentResponse();
        const { response } = await keymaster.decryptJSON(responseDid) as { response: ChallengeResponse };
        response.requested = 99;
        response.fulfilled = 99;
        response.match = true;
        response.vps = [{} as any];
        const supplied = await keymaster.encryptJSON({ response }, requestor);

        await keymaster.setCurrentId('Requestor');
        await expect(keymaster.verifyResponse(supplied, { publish: false })).resolves.toMatchObject({
            requested: 1,
            fulfilled: 0,
            match: false,
            vps: [],
        });
    });

    it('rejects ambiguous creation options', async () => {
        await keymaster.setCurrentId('Attestor');
        await expect(keymaster.createResponse(challenge, { paymentOnly: true }))
            .rejects.toThrow('paymentInfo');
        await expect(keymaster.createResponse(challenge, { paymentInfo }))
            .rejects.toThrow('options.paymentInfo');
        await expect(keymaster.createResponse(challenge, { paymentOnly: 'yes' } as any))
            .rejects.toThrow('options.paymentOnly');
    });

    it.each([null, [], 'payment'])('rejects non-object payment information: %j', async invalid => {
        await keymaster.setCurrentId('Attestor');
        await expect(keymaster.createResponse(challenge, {
            paymentOnly: true,
            paymentInfo: invalid as unknown as PaymentInfo,
        })).rejects.toThrow('paymentInfo');
    });

    it('requires the signer and schema to be authorized by the same challenge request', async () => {
        await keymaster.setCurrentId('Requestor');
        const mixedChallenge = await keymaster.createChallenge({ credentials: [
            { schema, issuers: [subject] },
            { schema: otherSchema, issuers: [attestor] },
        ] });

        await expect(createPaymentResponse('Attestor', paymentInfo, mixedChallenge))
            .rejects.toThrow('paymentInfo');
    });

    it.each([
        ['invalid version', { version: 2 }],
        ['unsupported type', { type: 'litecoin' }],
        ['unsupported network', { network: 'signet' }],
        ['invalid schema', { schema: 'not-a-did' }],
        ['invalid subject', { subject: 'not-a-did' }],
        ['no outputs', { outputs: [] }],
        ['null output', { outputs: [null] }],
        ['array output', { outputs: [[]] }],
        ['non-string role', { outputs: [{ role: 42, address: 'tb1qother', amountSats: 1 }] }],
        ['empty role', { outputs: [{ role: ' ', address: 'tb1qother', amountSats: 1 }] }],
        ['non-string address', { outputs: [{ role: 'subject', address: 42, amountSats: 1 }] }],
        ['empty address', { outputs: [{ role: 'subject', address: ' ', amountSats: 1 }] }],
        ['non-numeric amount', { outputs: [{ role: 'subject', address: 'tb1qsubject', amountSats: '1' }] }],
        ['zero amount', { outputs: [{ role: 'subject', address: 'tb1qsubject', amountSats: 0 }] }],
        ['fractional amount', { outputs: [{ role: 'subject', address: 'tb1qsubject', amountSats: 1.5 }] }],
        ['unsafe amount', { outputs: [{ role: 'subject', address: 'tb1qsubject', amountSats: Number.MAX_SAFE_INTEGER + 1 }] }],
        ['invalid expiry', { validUntil: 'tomorrow' }],
        ['expired terms', { validUntil: new Date(Date.now() - 1_000).toISOString() }],
    ])('rejects cryptographically signed but structurally invalid terms: %s', async (_name, overrides) => {
        await keymaster.setCurrentId('Attestor');
        const invalid = await signUncheckedPaymentInfo(overrides);
        await expect(keymaster.createResponse(challenge, { paymentOnly: true, paymentInfo: invalid }))
            .rejects.toThrow('paymentInfo');
    });

    it('rejects tampered and unsigned payment information', async () => {
        const tampered = structuredClone(paymentInfo);
        tampered.outputs[0].amountSats++;
        const unsigned = structuredClone(paymentInfo) as Partial<PaymentInfo>;
        delete unsigned.signature;

        await expect(createPaymentResponse('Attestor', tampered)).rejects.toThrow('paymentInfo');
        await expect(createPaymentResponse('Attestor', unsigned as PaymentInfo)).rejects.toThrow('paymentInfo');
    });

    it.each([
        ['version', (info: any) => { info.version = 2; }],
        ['type', (info: any) => { info.type = 'litecoin'; }],
        ['network', (info: any) => { info.network = 'bitcoin'; }],
        ['schema', (info: any) => { info.schema = otherSchema; }],
        ['subject', (info: any) => { info.subject = attestor; }],
        ['output role', (info: any) => { info.outputs[0].role = 'platform'; }],
        ['output address', (info: any) => { info.outputs[0].address = 'tb1qchanged'; }],
        ['output amount', (info: any) => { info.outputs[0].amountSats++; }],
        ['output order', (info: any) => { info.outputs.reverse(); }],
        ['expiry', (info: any) => { info.validUntil = new Date(Date.now() + 60_000).toISOString(); }],
    ])('rejects a packet whose signed %s was changed', async (_field, tamper) => {
        const invalid = structuredClone(paymentInfo);
        tamper(invalid);
        await expect(createPaymentResponse('Attestor', invalid)).rejects.toThrow('paymentInfo');
    });

    it.each([
        ['signer', undefined],
        ['signed', 'not-a-date'],
        ['hash', ''],
        ['value', ''],
    ] as const)('rejects an invalid signature %s', async (field, value) => {
        const invalid = structuredClone(paymentInfo);
        Object.assign(invalid.signature, { [field]: value });
        await expect(createPaymentResponse('Attestor', invalid)).rejects.toThrow('paymentInfo');
    });

    it('independently rejects payment information tampered after response creation', async () => {
        const responseDid = await createPaymentResponse();
        const { response } = await keymaster.decryptJSON(responseDid) as { response: ChallengeResponse };
        response.paymentInfo!.outputs.reverse();
        const supplied = await keymaster.encryptJSON({ response }, requestor);

        await keymaster.setCurrentId('Requestor');
        await expect(keymaster.verifyResponse(supplied, { publish: false }))
            .rejects.toThrow('paymentInfo');
    });

    it('rejects an otherwise shaped packet whose signer cannot be resolved', async () => {
        await keymaster.setCurrentId('Requestor');
        const unrestricted = await keymaster.createChallenge({ credentials: [{ schema }] });
        const missingSigner = structuredClone(paymentInfo);
        missingSigner.signature.signer = `did:test:${await generateCID('missing signer')}`;

        await expect(createPaymentResponse('Attestor', missingSigner, unrestricted))
            .rejects.toThrow('paymentInfo');
    });

    it('rejects payment responses that also contain credential presentations', async () => {
        const responseDid = await createPaymentResponse();
        const { response } = await keymaster.decryptJSON(responseDid) as { response: ChallengeResponse };
        response.credentials = [{ vc: schema, vp: otherSchema }];
        const supplied = await keymaster.encryptJSON({ response }, requestor);

        await keymaster.setCurrentId('Requestor');
        await expect(keymaster.verifyResponse(supplied, { publish: false }))
            .rejects.toThrow('response.paymentInfo');
    });

    it.each([null, 'response', []])('rejects an invalid response value: %j', async response => {
        await keymaster.setCurrentId('Attestor');
        const supplied = await keymaster.encryptJSON({ response }, requestor);
        await keymaster.setCurrentId('Requestor');
        await expect(keymaster.verifyResponse(supplied, { publish: false }))
            .rejects.toThrow('responseDID not a valid challenge response');
    });

    it.each([
        ['challenge', () => ({ challenge: 'not-a-did', credentials: [] })],
        ['credentials', () => ({ challenge, credentials: null })],
    ] as const)('rejects a malformed response %s field', async (_field, makeResponse) => {
        await keymaster.setCurrentId('Attestor');
        const supplied = await keymaster.encryptJSON({ response: makeResponse() }, requestor);
        await keymaster.setCurrentId('Requestor');
        await expect(keymaster.verifyResponse(supplied, { publish: false }))
            .rejects.toThrow('responseDID not a valid challenge response');
    });

    it('rejects malformed credential requirements in the resolved challenge', async () => {
        await keymaster.setCurrentId('Requestor');
        const malformedChallenge = await keymaster.createAsset({
            challenge: { credentials: 'invalid' },
        });
        await keymaster.setCurrentId('Attestor');
        const supplied = await keymaster.encryptJSON({
            response: { challenge: malformedChallenge, credentials: [] },
        }, requestor);

        await keymaster.setCurrentId('Requestor');
        await expect(keymaster.verifyResponse(supplied, { publish: false }))
            .rejects.toThrow('challenge.credentials');
    });

    it('supports the complete paid attestation and credential reuse flow', async () => {
        await keymaster.setCurrentId('Requestor');
        const paidChallenge = await keymaster.createChallenge({
            credentials: [{ schema, issuers: [attestor] }],
        });

        await keymaster.setCurrentId('Attestor');
        const terms = await keymaster.createPaymentInfo({
            network: 'testnet',
            schema,
            subject,
            outputs: [
                { role: 'subject', address: 'tb1qsubject', amountSats: 1_000 },
                { role: 'attestor', address: 'tb1qattestor', amountSats: 2_000 },
                { role: 'platform', address: 'tb1qplatform', amountSats: 500 },
            ],
        });

        const attestorResponse = await keymaster.createResponse(paidChallenge, {
            paymentOnly: true,
            paymentInfo: terms,
        });

        await keymaster.setCurrentId('Requestor');
        await expect(keymaster.verifyResponse(attestorResponse, { publish: false })).resolves.toMatchObject({
            responder: attestor,
            paymentInfo: terms,
        });

        await keymaster.setCurrentId('Attestor');
        const bound = await keymaster.bindCredential(schema, subject, {
            credential: { email: 'subject@example.com', paymentInfo: terms },
        });
        const credentialDid = await keymaster.issueCredential(bound);

        await keymaster.setCurrentId('Subject');
        expect(await keymaster.acceptCredential(credentialDid)).toBe(true);
        const credentialResponse = await keymaster.createResponse(paidChallenge);

        await keymaster.setCurrentId('Requestor');
        const verified = await keymaster.verifyResponse(credentialResponse, { publish: false });
        expect(verified).toMatchObject({
            responder: subject,
            requested: 1,
            fulfilled: 1,
            match: true,
            credentials: [{ vc: credentialDid }],
        });
        expect(verified.vps).toHaveLength(1);
        expect(verified.vps?.[0]).toMatchObject({
            issuer: attestor,
            credentialSubject: { id: subject },
        });
        expect(verified.vps?.[0].credential?.paymentInfo).toStrictEqual(terms);
    });

    it('supports paid reuse of an existing credential', async () => {
        await keymaster.setCurrentId('Attestor');
        const terms = await keymaster.createPaymentInfo(paymentInfoInput());
        const bound = await keymaster.bindCredential(schema, subject, {
            credential: { email: 'subject@example.com', paymentInfo: terms },
        });
        const credentialDid = await keymaster.issueCredential(bound);

        await keymaster.setCurrentId('Subject');
        expect(await keymaster.acceptCredential(credentialDid)).toBe(true);

        await keymaster.setCurrentId('Requestor');
        const reuseChallenge = await keymaster.createChallenge({
            credentials: [{ schema, issuers: [attestor] }],
        });

        await keymaster.setCurrentId('Subject');
        const heldCredential = await keymaster.decryptJSON(credentialDid) as {
            credential: { paymentInfo: PaymentInfo };
        };
        const reuseTerms = heldCredential.credential.paymentInfo;
        expect(reuseTerms).toStrictEqual(terms);
        const paymentResponse = await keymaster.createResponse(reuseChallenge, {
            paymentOnly: true,
            paymentInfo: reuseTerms,
        });

        await keymaster.setCurrentId('Requestor');
        const verifiedPayment = await keymaster.verifyResponse(paymentResponse, { publish: false });
        expect(verifiedPayment).toMatchObject({
            challenge: reuseChallenge,
            responder: subject,
            requested: 1,
            fulfilled: 0,
            match: false,
            paymentInfo: {
                schema,
                subject,
                signature: { signer: attestor },
            },
        });
        expect(verifiedPayment.paymentInfo).toStrictEqual(terms);

        // Bitcoin payment and observation happen outside Keymaster.
        await keymaster.setCurrentId('Subject');
        const credentialResponse = await keymaster.createResponse(reuseChallenge);

        await keymaster.setCurrentId('Requestor');
        const verifiedCredential = await keymaster.verifyResponse(credentialResponse, { publish: false });
        expect(verifiedCredential).toMatchObject({
            challenge: reuseChallenge,
            responder: subject,
            requested: 1,
            fulfilled: 1,
            match: true,
            credentials: [{ vc: credentialDid }],
        });
        expect(verifiedCredential.vps).toHaveLength(1);
        expect(verifiedCredential.vps?.[0]).toMatchObject({
            issuer: attestor,
            credentialSubject: { id: subject },
        });
        expect(verifiedCredential.vps?.[0].credential?.paymentInfo)
            .toStrictEqual(verifiedPayment.paymentInfo);
    });
});
