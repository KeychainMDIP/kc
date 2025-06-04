import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import { EncryptedMessage } from '@mdip/keymaster/types';
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

function generateRandomString(length: number) {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

describe('encryptMessage', () => {
    it('should encrypt a short message', async () => {
        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encryptMessage(msg, did, { includeHash: true });
        const doc = await keymaster.resolveDID(encryptDid);
        const data = doc.didDocumentData;
        const msgHash = cipher.hashMessage(msg);

        expect((data as { encrypted: EncryptedMessage }).encrypted.cipher_hash).toBe(msgHash);
    });

    it('should encrypt a long message', async () => {

        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = generateRandomString(1024);
        const encryptDid = await keymaster.encryptMessage(msg, did, { includeHash: true });
        const doc = await keymaster.resolveDID(encryptDid);
        const data = doc.didDocumentData;
        const msgHash = cipher.hashMessage(msg);

        expect((data as { encrypted: EncryptedMessage }).encrypted.cipher_hash).toBe(msgHash);
    });
});

describe('decryptMessage', () => {
    it('should decrypt a short message encrypted by same ID', async () => {
        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encryptMessage(msg, did);
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a short message after rotating keys (confirmed)', async () => {
        const did = await keymaster.createId('Bob', { registry: 'local' });
        const msg = 'Hi Bob!';
        await keymaster.rotateKeys();
        const encryptDid = await keymaster.encryptMessage(msg, did, { encryptForSender: true, registry: 'local' });
        await keymaster.rotateKeys();
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a short message after rotating keys (unconfirmed)', async () => {
        const did = await keymaster.createId('Bob', { registry: 'hyperswarm' });
        const msg = 'Hi Bob!';
        await keymaster.rotateKeys();
        const encryptDid = await keymaster.encryptMessage(msg, did, { encryptForSender: true, registry: 'hyperswarm' });
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a short message encrypted by another ID', async () => {
        const name1 = 'Alice';
        await keymaster.createId(name1);

        const name2 = 'Bob';
        const did = await keymaster.createId(name2);

        await keymaster.setCurrentId(name1);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encryptMessage(msg, did);

        await keymaster.setCurrentId(name2);
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a long message encrypted by another ID', async () => {
        const name1 = 'Alice';
        await keymaster.createId(name1);

        const name2 = 'Bob';
        const did = await keymaster.createId(name2);

        await keymaster.setCurrentId(name1);

        const msg = generateRandomString(1024);
        const encryptDid = await keymaster.encryptMessage(msg, did);

        await keymaster.setCurrentId(name2);
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should throw an exception on invalid DID', async () => {
        const name = await keymaster.createId("Alice");

        try {
            await keymaster.decryptMessage(name);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toContain('did not encrypted');
        }
    });
});

const mockJson = {
    key: "value",
    list: [1, 2, 3],
    obj: { name: "some object" }
};

describe('encryptJSON', () => {
    it('should encrypt valid JSON', async () => {
        const bob = await keymaster.createId('Bob');
        await keymaster.resolveDID(bob);

        const did = await keymaster.encryptJSON(mockJson, bob);
        const data = await keymaster.resolveAsset(did);
        expect((data as { encrypted: EncryptedMessage }).encrypted.sender).toStrictEqual(bob);
    });
});

describe('decryptJSON', () => {
    it('should decrypt valid JSON', async () => {
        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);
        const decipher = await keymaster.decryptJSON(did);

        expect(decipher).toStrictEqual(mockJson);
    });
});

describe('addSignature', () => {
    it('should add a signature to the object', async () => {
        const name = 'Bob';
        const did = await keymaster.createId(name);
        const hash = cipher.hashJSON(mockJson);
        const signed = await keymaster.addSignature(mockJson);

        expect(signed.signature.signer).toBe(did);
        expect(signed.signature.hash).toBe(hash);
    });

    it('should throw an exception if no ID selected', async () => {
        try {
            await keymaster.addSignature(mockJson);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: No current ID');
        }
    });

    it('should throw an exception if null parameter', async () => {
        await keymaster.createId('Bob');

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.addSignature();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: obj');
        }
    });
});

describe('verifySignature', () => {
    it('should return true for valid signature', async () => {
        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(true);
    });

    it('should return false for missing signature', async () => {
        await keymaster.createId('Bob');

        // @ts-expect-error Testing invalid usage, invalid arg
        const isValid = await keymaster.verifySignature(mockJson);

        expect(isValid).toBe(false);
    });

    it('should return false for invalid signature', async () => {
        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
        signed.signature.value = signed.signature.value.substring(1);
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(false);
    });

    it('should return false for missing signer', async () => {
        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
        delete signed.signature.signer;
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(false);
    });

    it('should return false for invalid hash', async () => {
        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
        signed.signature.hash = "1";
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(false);
    });

    it('should return false for null parameter', async () => {
        // @ts-expect-error Testing invalid usage, missing arg
        const isValid = await keymaster.verifySignature();

        expect(isValid).toBe(false);
    });

    it('should return false for invalid JSON', async () => {
        // @ts-expect-error Testing invalid usage, invalid arg
        const isValid = await keymaster.verifySignature("not JSON");

        expect(isValid).toBe(false);
    });
});
