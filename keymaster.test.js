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

describe('rotateKeys', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should update DID doc with new keys', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        let doc = await keymaster.resolveDid(alice);
        let vm = doc.didDocument.verificationMethod[0];
        let pubkey = vm.publicKeyJwk;

        for (let i = 0; i < 3; i++) {
            await keymaster.rotateKeys();

            doc = await keymaster.resolveDid(alice);
            vm = doc.didDocument.verificationMethod[0];

            expect(pubkey.x !== vm.publicKeyJwk.x).toBe(true);
            expect(pubkey.y !== vm.publicKeyJwk.y).toBe(true);

            pubkey = vm.publicKeyJwk;
        }
    });

    it('should decrypt messages encrypted with rotating keys', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const secrets = [];
        const msg = "Hi Bob!";

        keymaster.useId('Alice');

        for (let i = 0; i < 3; i++) {
            keymaster.useId('Alice');

            const did = await keymaster.encrypt(msg, bob);
            secrets.push(did);

            await keymaster.rotateKeys();

            keymaster.useId('Bob');
            await keymaster.rotateKeys();
        }

        for (let secret of secrets) {
            keymaster.useId('Alice');

            const decipher1 = await keymaster.decrypt(secret);
            expect(decipher1).toBe(msg);

            keymaster.useId('Bob');

            const decipher2 = await keymaster.decrypt(secret);
            expect(decipher2).toBe(msg);
        }
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

const mockJson = {
    key: "value",
    list: [1, 2, 3],
    obj: { name: "some object" }
};

describe('encryptJSON', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should encrypt valid JSON', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const bobDoc = await keymaster.resolveDid(bob);

        const did = await keymaster.encryptJSON(mockJson, bob);
        const data = await keymaster.resolveAsset(did);

        expect(data.sender).toStrictEqual(bob);
    });
});

describe('decryptJSON', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should decrypt valid JSON', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);
        const decipher = await keymaster.decryptJSON(did);

        expect(decipher).toStrictEqual(mockJson);
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
        const hash = cipher.hashMessage(canonicalize(mockJson));
        const signed = await keymaster.addSignature(mockJson);

        expect(signed.signature.signer).toBe(did);
        expect(signed.signature.hash).toBe(hash);
    });

    it('should throw an exception if no ID selected', async () => {
        mockFs({});

        try {
            await keymaster.addSignature(mockJson);
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
});

describe('verifySignature', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return true for valid signature', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(true);
    });

    it('should return false for missing signature', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const isValid = await keymaster.verifySignature(mockJson);

        expect(isValid).toBe(false);
    });

    it('should return false for invalid signature', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
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

describe('createCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a credential from a schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const did = await keymaster.createCredential(mockSchema);
        const doc = await keymaster.resolveDid(did);

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocumentMetadata.data).toStrictEqual(mockSchema);
    });
});

describe('bindCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a bound credential', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);

        const vc = await keymaster.bindCredential(credentialDid, userDid);

        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject.id).toBe(userDid);
        expect(vc.credential.email).toEqual(expect.any(String));
    });

    it('should create a bound credential for a different user', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);

        keymaster.useId('Alice')
        const vc = await keymaster.bindCredential(credentialDid, bob);

        expect(vc.issuer).toBe(alice);
        expect(vc.credentialSubject.id).toBe(bob);
        expect(vc.credential.email).toEqual(expect.any(String));
    });
});

describe('attestCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should attest a bound credential when user is issuer', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);

        const did = await keymaster.attestCredential(boundCredential);

        const vc = await keymaster.decryptJSON(did);
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

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);

        keymaster.useId('Bob');

        try {
            await keymaster.attestCredential(boundCredential);
            throw ('Expected attestCredential to throw an exception');
        }
        catch (error) {
            expect(error).toBe('Invalid VC');
        }
    });
});

describe('revokeCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should revoke an valid verifiable credential', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.attestCredential(boundCredential);

        const ok = await keymaster.revokeCredential(did);
        expect(ok).toBe(true);

        const revoked = await keymaster.resolveDid(did);
        expect(revoked.didDocument).toStrictEqual({});
        expect(revoked.didDocumentMetadata.deactivated).toBe(true);
    });

    it('should return false if verifiable credential is already revoked', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.attestCredential(boundCredential);

        const ok1 = await keymaster.revokeCredential(did);
        expect(ok1).toBe(true);

        const revoked = await keymaster.resolveDid(did);
        expect(revoked.didDocument).toStrictEqual({});
        expect(revoked.didDocumentMetadata.deactivated).toBe(true);

        const ok2 = await keymaster.revokeCredential(did);
        expect(ok2).toBe(false);
    });

    it('should return false if user does not control verifiable credential', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.useId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.attestCredential(boundCredential);

        keymaster.useId('Bob');

        const ok = await keymaster.revokeCredential(did);
        expect(ok).toBe(false);
    });
});

describe('acceptCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should add a valid verifiable credential to user wallet', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.useId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.attestCredential(boundCredential);

        keymaster.useId('Bob');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(true);

        const wallet = keymaster.loadWallet();
        expect(wallet.ids['Alice'].manifest.includes(did));
        expect(wallet.ids['Bob'].manifest.includes(did));
    });

    it('should return false if user is not the credential subject', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');

        keymaster.useId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.attestCredential(boundCredential);

        keymaster.useId('Carol');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(false);
    });

    it('should return false if the verifiable credential is invalid', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.useId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);

        keymaster.useId('Bob');

        const ok = await keymaster.acceptCredential(credentialDid);
        expect(ok).toBe(false);
    });
});

describe('createChallenge', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a valid challenge', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.useId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const challenge = {
            credentials: [
                {
                    schema: credentialDid,
                    attestors: [alice, bob]
                }
            ]
        };
        const did = await keymaster.createChallenge(challenge);
        const doc = await keymaster.resolveDid(did);

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocument.controller).toBe(alice);
        expect(doc.didDocumentMetadata.data).toStrictEqual(challenge);
    });
});

describe('issueChallenge', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a challenge bound to a user', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.useId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const challenge = {
            credentials: [
                {
                    schema: credentialDid,
                    attestors: [alice, bob]
                }
            ]
        };
        const challengeDid = await keymaster.createChallenge(challenge);
        const challengeForBob = await keymaster.issueChallenge(challengeDid, bob);
        const boundChallenge = await keymaster.decryptJSON(challengeForBob);

        expect(boundChallenge.challenge).toBe(challengeDid);
        expect(boundChallenge.from).toBe(alice);
        expect(boundChallenge.to).toBe(bob);

        const isValid = await keymaster.verifySignature(boundChallenge);
        expect(isValid).toBe(true);

        const validFrom = new Date(boundChallenge.validFrom);
        const validUntil = new Date(boundChallenge.validUntil);
        const now = new Date();

        expect(validFrom < now).toBe(true);
        expect(validUntil > now).toBe(true);
    });
});

describe('createResponse', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a valid presentation from a simple challenge', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const victor = await keymaster.createId('Victor');

        keymaster.useId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const vcDid = await keymaster.attestCredential(boundCredential);

        keymaster.useId('Bob');

        const ok = await keymaster.acceptCredential(vcDid);
        expect(ok).toBe(true);

        const wallet = keymaster.loadWallet();
        expect(wallet.ids['Alice'].manifest.includes(vcDid));
        expect(wallet.ids['Bob'].manifest.includes(vcDid));

        keymaster.useId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credentialDid,
                    attestors: [alice]
                }
            ]
        };
        const challengeDid = await keymaster.createChallenge(challenge);
        const challengeForBob = await keymaster.issueChallenge(challengeDid, bob);

        keymaster.useId('Bob');
        const vpDid = await keymaster.createResponse(challengeForBob);
        const vpDoc = await keymaster.resolveDid(vpDid);
        const data = vpDoc.didDocumentMetadata.data;

        expect(data.challenge).toBe(challengeForBob);
        expect(data.credentials.length).toBe(1);
        expect(data.credentials[0].vc).toBe(vcDid);
    });
});

describe('verifyResponse', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should demonstrate full workflow', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');
        const victor = await keymaster.createId('Victor');

        keymaster.useId('Alice');

        const credential1 = await keymaster.createCredential(mockSchema);
        const credential2 = await keymaster.createCredential(mockSchema);

        const bc1 = await keymaster.bindCredential(credential1, carol);
        const bc2 = await keymaster.bindCredential(credential2, carol);

        const vc1 = await keymaster.attestCredential(bc1);
        const vc2 = await keymaster.attestCredential(bc2);

        keymaster.useId('Bob');

        const credential3 = await keymaster.createCredential(mockSchema);
        const credential4 = await keymaster.createCredential(mockSchema);

        const bc3 = await keymaster.bindCredential(credential3, carol);
        const bc4 = await keymaster.bindCredential(credential4, carol);

        const vc3 = await keymaster.attestCredential(bc3);
        const vc4 = await keymaster.attestCredential(bc4);

        keymaster.useId('Carol');

        await keymaster.acceptCredential(vc1);
        await keymaster.acceptCredential(vc2);
        await keymaster.acceptCredential(vc3);
        await keymaster.acceptCredential(vc4);

        keymaster.useId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credential1,
                    attestors: [alice]
                },
                {
                    schema: credential2,
                    attestors: [alice]
                },
                {
                    schema: credential3,
                    attestors: [bob]
                },
                {
                    schema: credential4,
                    attestors: [bob]
                },
            ]
        };
        const challengeDid = await keymaster.createChallenge(challenge);
        const challengeForCarol = await keymaster.issueChallenge(challengeDid, carol);

        keymaster.useId('Carol');
        const vpDid = await keymaster.createResponse(challengeForCarol);
        const data = await keymaster.resolveAsset(vpDid);

        expect(data.challenge).toBe(challengeForCarol);
        expect(data.credentials.length).toBe(4);

        keymaster.useId('Victor');

        const vcList = await keymaster.verifyResponse(vpDid);
        expect(vcList.length).toBe(4);

        // All agents rotate keys
        keymaster.useId('Alice');
        await keymaster.rotateKeys();

        keymaster.useId('Bob');
        await keymaster.rotateKeys();

        keymaster.useId('Carol');
        await keymaster.rotateKeys();

        keymaster.useId('Victor');
        await keymaster.rotateKeys();

        const vcList2 = await keymaster.verifyResponse(vpDid);
        expect(vcList2.length).toBe(4);

        keymaster.useId('Alice');
        await keymaster.revokeCredential(vc1);

        keymaster.useId('Victor');
        const vcList3 = await keymaster.verifyResponse(vpDid);
        expect(vcList3.length).toBe(3);

        keymaster.useId('Bob');
        await keymaster.revokeCredential(vc3);

        keymaster.useId('Victor');
        const vcList4 = await keymaster.verifyResponse(vpDid);
        expect(vcList4.length).toBe(2);
    });
});
