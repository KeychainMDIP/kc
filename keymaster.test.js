import fs from 'fs';
import mockFs from 'mock-fs';
import canonicalize from 'canonicalize';
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

    it('should throw to create a second ID with the same name', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        try {
            await keymaster.createId(name);
            throw ('Expected createId to throw an exception');
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

    it('should throw to remove an non-existent ID', async () => {
        mockFs({});

        const name1 = 'Bob';
        const name2 = 'Alice';

        await keymaster.createId(name1);

        try {
            keymaster.removeId(name2);
            throw ('Expected createId to throw an exception');
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

describe('createData', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from an object anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createData(mockAnchor);
        const doc = await keymaster.resolveDid(dataDid);

        expect(doc.didDocument.id).toBe(dataDid);
        expect(doc.didDocument.controller).toBe(ownerDid);
        expect(doc.didDocumentMetadata.data).toStrictEqual(mockAnchor);
    });

    it('should create DID from a string anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = "mockAnchor";
        const dataDid = await keymaster.createData(mockAnchor);
        const doc = await keymaster.resolveDid(dataDid);

        expect(doc.didDocument.id).toBe(dataDid);
        expect(doc.didDocument.controller).toBe(ownerDid);
        expect(doc.didDocumentMetadata.data).toStrictEqual(mockAnchor);
    });

    it('should create DID from a list anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = [1, 2, 3];
        const dataDid = await keymaster.createData(mockAnchor);
        const doc = await keymaster.resolveDid(dataDid);

        expect(doc.didDocument.id).toBe(dataDid);
        expect(doc.didDocument.controller).toBe(ownerDid);
        expect(doc.didDocumentMetadata.data).toStrictEqual(mockAnchor);
    });

    it('should throw an exception if no ID selected', async () => {
        mockFs({});

        try {
            const mockAnchor = { name: 'mockAnchor' };
            await keymaster.createData(mockAnchor);
            throw 'Expected createData to throw an exception';
        } catch (error) {
            expect(error).toBe('No current ID');
        }
    });

    it('should throw an exception for null anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createData();
            throw ('Expected createData to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });

    it('should throw an exception for an empty string anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createData("");
            throw ('Expected createData to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });

    it('should throw an exception for an empty list anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createData([]);
            throw ('Expected createData to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });

    it('should throw an exception for an empty object anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createData({});
            throw ('Expected createData to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
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

        const msg = generateRandomString(1024);
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

        const msg = generateRandomString(1024);
        const encryptDid = await keymaster.encrypt(msg, did2);

        keymaster.useId(name2);
        const decipher = await keymaster.decrypt(encryptDid);

        expect(decipher).toBe(msg);
    });
});

describe('addSignature', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should add a signature to the object', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        const json = {
            key: "value",
            list: [1, 2, 3],
            obj: { name: "some object" }
        };

        const hash = cipher.hashMessage(canonicalize(json));
        const signed = await keymaster.addSignature(json);

        expect(signed.signature.signer).toBe(did);
        expect(signed.signature.hash).toBe(hash);
    });

    it('should throw an exception if no ID selected', async () => {
        mockFs({});

        const json = {
            key: "value",
            list: [1, 2, 3],
            obj: { name: "some object" }
        };

        try {
            await keymaster.addSignature(json);
            throw ('Expected addSignature to throw an exception');
        } catch (error) {
            expect(error).toBe('No current ID');
        }
    });

    it('should throw an exception if null parameter', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.addSignature();
            throw ('Expected addSignature to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });

    it('should throw an exception if invalid object', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.addSignature("not an object");
            throw ('Expected addSignature to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });
});

describe('verifySignature', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return true for valid signature', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const json = {
            key: "value",
            list: [1, 2, 3],
            obj: { name: "some object" }
        };

        const signed = await keymaster.addSignature(json);
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(true);
    });

    it('should return false for missing signature', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const json = {
            key: "value",
            list: [1, 2, 3],
            obj: { name: "some object" }
        };

        const isValid = await keymaster.verifySignature(json);

        expect(isValid).toBe(false);
    });

    it('should return false for invalid signature', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const json = {
            key: "value",
            list: [1, 2, 3],
            obj: { name: "some object" }
        };

        const signed = await keymaster.addSignature(json);
        signed.signature.value = signed.signature.value.substring(1);
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(false);
    });

    it('should return false for null parameter', async () => {
        mockFs({});

        const isValid = await keymaster.verifySignature();

        expect(isValid).toBe(false);
    });

    it('should return false for invalid JSON', async () => {
        mockFs({});

        const isValid = await keymaster.verifySignature("not JSON");

        expect(isValid).toBe(false);
    });
});

describe('createSchema', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a schema DID', async () => {
        mockFs({});

        const mockSchema = {
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

        await keymaster.createId('Bob');

        const did = await keymaster.createSchema(mockSchema);
        const doc = await keymaster.resolveDid(did);

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocumentMetadata.data).toStrictEqual(mockSchema);
    });
});

describe('createVC', () => {

    const mockSchema = {
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

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a VC from a schema', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const schemaDid = await keymaster.createSchema(mockSchema);

        const vc = await keymaster.createVC(schemaDid, userDid);

        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject.id).toBe(userDid);
        expect(vc.credential.email).toEqual(expect.any(String));
    });

    it('should create a VC for a different user', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const schemaDid = await keymaster.createSchema(mockSchema);

        keymaster.useId('Alice')
        const vc = await keymaster.createVC(schemaDid, bob);

        expect(vc.issuer).toBe(alice);
        expect(vc.credentialSubject.id).toBe(bob);
        expect(vc.credential.email).toEqual(expect.any(String));
    });
});

describe('attestVC', () => {

    const mockSchema = {
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

    afterEach(() => {
        mockFs.restore();
    });

    it('should attest a VC when user is issuer', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const schemaDid = await keymaster.createSchema(mockSchema);
        const vcdoc = await keymaster.createVC(schemaDid, userDid);

        const did = await keymaster.attestVC(vcdoc);

        const vc = JSON.parse(await keymaster.decrypt(did));
        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject.id).toBe(userDid);
        expect(vc.credential.email).toEqual(expect.any(String));

        const isValid = await keymaster.verifySignature(vc);
        expect(isValid).toBe(true);

        const wallet = keymaster.loadWallet();
        expect(wallet.ids['Bob'].manifest.includes(did)).toEqual(true);
    });

    it('should throw an exception if user is not issuer', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.useId('Alice');

        const schemaDid = await keymaster.createSchema(mockSchema);
        const vcdoc = await keymaster.createVC(schemaDid, bob);

        keymaster.useId('Bob');

        try {
            await keymaster.attestVC(vcdoc);
            throw ('Expected attestVC to throw an exception');
        }
        catch (error) {
            expect(error).toBe('Invalid VC');
        }
    });
});
