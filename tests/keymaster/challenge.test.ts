import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';

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
    keymaster = new Keymaster({ gatekeeper, wallet, cipher });
});

const mockSchema = {    // eslint-disable-next-line
    "$schema": "http://json-schema.org/draft-07/schema#",
    "properties": {
        "email": {
            "format": "email",
            "type": "string"
        }
    },
    "required": [
        "email"
    ],
    "type": "object"
};

describe('createChallenge', () => {
    it('should create a valid empty challenge', async () => {
        const alice = await keymaster.createId('Alice');
        const did = await keymaster.createChallenge();
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
        expect(doc.didDocument!.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge: {} });

        const now = Date.now();
        const validUntil = new Date(doc.mdip!.validUntil!).getTime();
        const ttl = validUntil - now;

        expect(ttl < 60 * 60 * 1000).toBe(true);
    });

    it('should create an empty challenge with specified expiry', async () => {
        const alice = await keymaster.createId('Alice');
        const validUntil = '2025-01-01';
        const did = await keymaster.createChallenge({}, { validUntil });
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
        expect(doc.didDocument!.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge: {} });
        expect(doc.mdip!.validUntil).toBe(validUntil);
    });

    it('should create a valid challenge', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const challenge = {
            credentials: [
                {
                    schema: credentialDid,
                    issuers: [alice, bob]
                }
            ]
        };

        const did = await keymaster.createChallenge(challenge);
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
        expect(doc.didDocument!.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge });
    });

    it('should throw an exception if challenge spec is invalid', async () => {
        await keymaster.createId('Alice');

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.createChallenge(null);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challenge');
        }

        try {
            await keymaster.createChallenge([]);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challenge');
        }

        try {
            await keymaster.createChallenge({
                // @ts-expect-error Testing invalid usage, invalid arg
                credentials: 123
            });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challenge.credentials');
        }
    });

    it('should throw an exception if validUntil is not a valid date', async () => {
        await keymaster.createId('Alice');

        try {
            const validUntil = 'mockDate';
            await keymaster.createChallenge({}, { validUntil });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.validUntil');
        }
    });
});
