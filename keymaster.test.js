import fs from 'fs';
import mockFs from 'mock-fs';
import * as keymaster from './keymaster.js';
import * as cipher from './cipher.js';

describe('createId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a new ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);
        const wallet = keymaster.loadWallet();

        expect(wallet.ids[name].did).toBe(did);
        expect(wallet.current).toBe(name);
    });

    it('should fail to create a second ID with the same name', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        try {
            await keymaster.createId(name);
            fail('Expected createId to throw an exception');
        } catch (error) {
            expect(error).toBe(`Already have an ID named ${name}`);
        }
    });

    it('should create a second ID with a different name', async () => {
        mockFs({});

        const name1 = 'Bob';
        const did1 = await keymaster.createId(name1);

        const name2 = 'Alice';
        const did2 = await keymaster.createId(name2);

        const wallet = keymaster.loadWallet();

        expect(wallet.ids[name1].did).toBe(did1);
        expect(wallet.ids[name2].did).toBe(did2);
        expect(wallet.current).toBe(name2);
    });
});

describe('removeId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should remove an existing ID', async () => {
        mockFs({});

        const name = 'Bob';
        await keymaster.createId(name);

        keymaster.removeId(name);

        const wallet = keymaster.loadWallet();

        expect(wallet.ids).toStrictEqual({});
        expect(wallet.current).toBe('');
    });

    it('should fail to remove an non-existent ID', async () => {
        mockFs({});

        const name1 = 'Bob';
        const name2 = 'Alice';

        await keymaster.createId(name1);

        try {
            keymaster.removeId(name2);
            fail('Expected createId to throw an exception');
        } catch (error) {
            expect(error).toBe(`No ID named ${name2}`);
        }
    });
});

describe('useId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should switch to another ID', async () => {
        mockFs({});

        const name1 = 'Bob';
        await keymaster.createId(name1);

        const name2 = 'Alice';
        await keymaster.createId(name2);

        keymaster.useId(name1);

        const wallet = keymaster.loadWallet();
        expect(wallet.current).toBe(name1);
    });
});

describe('resolveDid', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should resolve a new ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveDid(did);

        expect(doc.didDocument.id).toBe(did);
    });
});

function generateRandomString(length) {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

describe('encrypt', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should encrypt a short message', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encrypt(msg, did);
        const doc = await keymaster.resolveDid(encryptDid);
        const data = doc.didDocumentMetadata.data;
        const msgHash = cipher.hashMessage(msg);

        expect(data.cipher_hash).toBe(msgHash);
    });

    it('should encrypt a long message', async () => {
        mockFs({});


        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = generateRandomString(1024 * 1024);
        const encryptDid = await keymaster.encrypt(msg, did);
        const doc = await keymaster.resolveDid(encryptDid);
        const data = doc.didDocumentMetadata.data;
        const msgHash = cipher.hashMessage(msg);

        expect(data.cipher_hash).toBe(msgHash);
    });
});

describe('decrypt', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should decrypt a short message encrypted by same ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encrypt(msg, did);
        const decipher = await keymaster.decrypt(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a short message encrypted by another ID', async () => {
        mockFs({});

        const name1 = 'Alice';
        const did1 = await keymaster.createId(name1);

        const name2 = 'Bob';
        const did2 = await keymaster.createId(name2);

        keymaster.useId(name1);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encrypt(msg, did2);

        keymaster.useId(name2);
        const decipher = await keymaster.decrypt(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a long message encrypted by another ID', async () => {
        mockFs({});

        const name1 = 'Alice';
        const did1 = await keymaster.createId(name1);

        const name2 = 'Bob';
        const did2 = await keymaster.createId(name2);

        keymaster.useId(name1);

        const msg = generateRandomString(1024 * 1024);
        const encryptDid = await keymaster.encrypt(msg, did2);

        keymaster.useId(name2);
        const decipher = await keymaster.decrypt(encryptDid);

        expect(decipher).toBe(msg);
    });
});
