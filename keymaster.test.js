import mockFs from 'mock-fs';
import canonicalize from 'canonicalize';
import * as keymaster from './keymaster-lib.js';
import * as gatekeeper from './gatekeeper-lib.js';
import * as cipher from './cipher-lib.js';
import * as db_json from './db-json.js';
import * as db_wallet from './db-wallet-json.js';

beforeEach(async () => {
    db_json.start('mdip');
    await gatekeeper.start(db_json);
    await keymaster.start(gatekeeper, db_wallet);
});

afterEach(async () => {
    await keymaster.stop();
});

describe('loadWallet', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a wallet on first load', async () => {
        mockFs({});

        const wallet = keymaster.loadWallet();

        expect(wallet.seed.mnemonic.length > 0).toBe(true);
        expect(wallet.seed.hdkey.xpub.length > 0).toBe(true);
        expect(wallet.seed.hdkey.xpriv.length > 0).toBe(true);
        expect(wallet.counter).toBe(0);
        expect(wallet.ids).toStrictEqual({});
    });

    it('should return the same wallet on second load', async () => {
        mockFs({});

        const wallet1 = keymaster.loadWallet();
        const wallet2 = keymaster.loadWallet();

        expect(wallet2).toStrictEqual(wallet1);
    });
});

describe('decryptMnemonic', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return 12 words', async () => {
        mockFs({});

        const wallet = keymaster.loadWallet();
        const mnemonic = keymaster.decryptMnemonic();

        expect(mnemonic !== wallet.seed.mnemonic).toBe(true);

        // Split the mnemonic into words
        const words = mnemonic.split(' ');
        expect(words.length).toBe(12);
    });
});

describe('newWallet', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should overwrite an existing wallet when allowed', async () => {
        mockFs({});

        const wallet1 = keymaster.loadWallet();
        keymaster.newWallet(null, true);
        const wallet2 = keymaster.loadWallet();

        expect(wallet1.seed.mnemonic !== wallet2.seed.mnemonic).toBe(true);
    });

    it('should not overwrite an existing wallet by default', async () => {
        mockFs({});

        keymaster.loadWallet();

        try {
            keymaster.newWallet();
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Wallet already exists');
        }
    });

    it('should create a wallet from a mnemonic', async () => {
        mockFs({});

        const mnemonic1 = cipher.generateMnemonic();
        keymaster.newWallet(mnemonic1);
        const mnemonic2 = keymaster.decryptMnemonic();

        expect(mnemonic1 === mnemonic2).toBe(true);
    });
});

describe('resolveSeedBank', () => {

    it('should create a deterministic seed bank ID', async () => {
        mockFs({});

        const bank1 = keymaster.resolveSeedBank();
        const bank2 = keymaster.resolveSeedBank();

        expect(bank1).toStrictEqual(bank2);
    });
});

describe('backupWallet', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return a valid DID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        const doc = await keymaster.resolveDID(did);

        expect(did === doc.didDocument.id).toBe(true);
    });

    it('should store backup in seed bank', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        const bank = await keymaster.resolveSeedBank();

        expect(did === bank.didDocumentData.wallet).toBe(true);
    });
});

describe('recoverWallet', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should recover wallet from seed bank', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const wallet = keymaster.loadWallet();
        const mnemonic = keymaster.decryptMnemonic();
        await keymaster.backupWallet();

        // Recover wallet from mnemonic
        keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(wallet).toStrictEqual(recovered);
    });

    it('should recover wallet from backup DID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const wallet = keymaster.loadWallet();
        const mnemonic = keymaster.decryptMnemonic();
        const did = await keymaster.backupWallet();

        // Recover wallet from mnemonic and recovery DID
        keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet(did);

        expect(wallet).toStrictEqual(recovered);
    });
});

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
        await keymaster.createId(name);

        try {
            await keymaster.createId(name);
            throw ('Expected to throw an exception');
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
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`No ID named ${name2}`);
        }
    });
});

describe('setCurrentId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should switch to another ID', async () => {
        mockFs({});

        const name1 = 'Bob';
        await keymaster.createId(name1);

        const name2 = 'Alice';
        await keymaster.createId(name2);

        keymaster.setCurrentId(name1);

        const wallet = keymaster.loadWallet();
        expect(wallet.current).toBe(name1);
    });

    it('should not switch to an invalid ID', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            keymaster.setCurrentId('Alice');
            throw "Expected to throw an exception";
        }
        catch (error) {
            expect(error).toBe(`Unknown ID`);
        }
    });
});

describe('resolveId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should resolve a new ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveId();

        expect(doc.didDocument.id).toBe(did);
    });
});

describe('backupId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should backup a new ID', async () => {
        mockFs({});

        const name = 'Bob';
        await keymaster.createId(name);

        const ok = await keymaster.backupId();

        const doc = await keymaster.resolveId();
        const vault = await keymaster.resolveDID(doc.didDocumentData.vault);

        expect(ok).toBe(true);
        expect(vault.didDocumentData.backup.length > 0).toBe(true);
    });

    it('should backup a non-current ID', async () => {
        mockFs({});

        const aliceDid = await keymaster.createId('Alice');
        await keymaster.createId('Bob'); // Bob will be current ID
        const ok = await keymaster.backupId('Alice');

        const doc = await keymaster.resolveDID(aliceDid);
        const vault = await keymaster.resolveDID(doc.didDocumentData.vault);

        expect(ok).toBe(true);
        expect(vault.didDocumentData.backup.length > 0).toBe(true);
    });
});

describe('recoverId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should recover an id from backup', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);
        let wallet = keymaster.loadWallet();
        const bob = wallet.ids['Bob'];
        const mnemonic = keymaster.decryptMnemonic();

        await keymaster.backupId();

        // reset wallet
        keymaster.newWallet(mnemonic, true);
        wallet = keymaster.loadWallet();
        expect(wallet.ids).toStrictEqual({});

        await keymaster.recoverId(did);
        wallet = keymaster.loadWallet();
        expect(wallet.ids[name]).toStrictEqual(bob);
        expect(wallet.current === name);
        expect(wallet.counter === 1);
    });

    it('should not recover an id to a different wallet', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');
        await keymaster.backupId();

        // reset to a different wallet
        keymaster.newWallet(null, true);

        try {
            await keymaster.recoverId(did);
            throw "Expected to throw an exception";
        }
        catch (error) {
            expect(error).toBe('Cannot recover ID');
        }
    });
});

describe('testAgent', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return true for agent DID', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');
        const isAgent = await keymaster.testAgent(did);

        expect(isAgent).toBe(true);
    });

    it('should return false for non-agent DID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const dataDID = await keymaster.createAsset({ name: 'mockAnchor' });
        const isAgent = await keymaster.testAgent(dataDID);

        expect(isAgent).toBe(false);
    });

    it('should raise an exception if no DID specified', async () => {
        mockFs({});

        try {
            await keymaster.testAgent();
            throw "Expected to throw an exception";
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }
    });

    it('should raise an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.testAgent('mock');
            throw "Expected to throw an exception";
        }
        catch (error) {
            expect(error).toBe('Unknown DID');
        }
    });
});

describe('resolveDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should resolve a new ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveDID(did);

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
        let doc = await keymaster.resolveDID(alice);
        let vm = doc.didDocument.verificationMethod[0];
        let pubkey = vm.publicKeyJwk;

        for (let i = 0; i < 3; i++) {
            await keymaster.rotateKeys();

            doc = await keymaster.resolveDID(alice);
            vm = doc.didDocument.verificationMethod[0];

            expect(pubkey.x !== vm.publicKeyJwk.x).toBe(true);
            expect(pubkey.y !== vm.publicKeyJwk.y).toBe(true);

            pubkey = vm.publicKeyJwk;
        }
    });

    it('should decrypt messages encrypted with rotating keys', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const secrets = [];
        const msg = "Hi Bob!";

        for (let i = 0; i < 3; i++) {
            keymaster.setCurrentId('Alice');

            const did = await keymaster.encrypt(msg, bob);
            secrets.push(did);

            await keymaster.rotateKeys();

            keymaster.setCurrentId('Bob');
            await keymaster.rotateKeys();
        }

        for (let secret of secrets) {
            keymaster.setCurrentId('Alice');

            const decipher1 = await keymaster.decrypt(secret);
            expect(decipher1).toBe(msg);

            keymaster.setCurrentId('Bob');

            const decipher2 = await keymaster.decrypt(secret);
            expect(decipher2).toBe(msg);
        }
    });

    it('should import DID with multiple key rotations', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const rotations = 10;

        for (let i = 0; i < rotations; i++) {
            await keymaster.rotateKeys();
        }

        const events = await keymaster.exportDID(alice);

        await gatekeeper.resetDb();

        const { updated } = await keymaster.importDID(events);

        expect(updated).toBe(rotations + 1);
    });
});

describe('addName', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a new name', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const ok = keymaster.addName('Jack', bob);
        const wallet = keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.names['Jack'] === bob).toBe(true);
    });

    it('should not add duplicate name', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        try {
            keymaster.addName('Jack', alice);
            keymaster.addName('Jack', bob);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Name already in use');
        }
    });

    it('should not add a name that is same as an ID', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            keymaster.addName('Alice', alice);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Name already in use');
        }
    });
});

describe('removeName', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should remove a valid name', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');

        keymaster.addName('Jack', bob);
        keymaster.removeName('Jack');

        const wallet = keymaster.loadWallet();

        expect(wallet.names['Jack'] === bob).toBe(false);
    });

    it('should return true if name is missing', async () => {
        mockFs({});

        const ok = keymaster.removeName('Jack');

        expect(ok).toBe(true);
    });
});

describe('listNames', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return current list of wallet names', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');

        for (let i = 0; i < 10; i++) {
            keymaster.addName(`name-${i}`, bob);
        }

        const names = keymaster.listNames();

        expect(Object.keys(names).length).toBe(10);

        for (const name of Object.keys(names)) {
            expect(names[name]).toBe(bob);
        }
    });

    it('should return empty list if no names added', async () => {
        mockFs({});

        const names = keymaster.listNames();

        expect(Object.keys(names).length).toBe(0);
    });
});

describe('resolveDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should resolve a valid id name', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const doc1 = await keymaster.resolveId();
        const doc2 = await keymaster.resolveDID('Bob');

        expect(doc1).toStrictEqual(doc2);
    });

    it('should resolve a valid asset name', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        keymaster.addName('mock', dataDid);

        const doc1 = await keymaster.resolveDID(dataDid);
        const doc2 = await keymaster.resolveDID('mock');

        expect(doc1).toStrictEqual(doc2);
    });

    it('should throw an exception for invalid name', async () => {
        mockFs({});

        try {
            await keymaster.resolveDID('mock');
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Unknown DID');
        }
    });
});

describe('createAsset', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from an object anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument.id).toBe(dataDid);
        expect(doc.didDocument.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID from a string anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = "mockAnchor";
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument.id).toBe(dataDid);
        expect(doc.didDocument.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID from a list anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = [1, 2, 3];
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument.id).toBe(dataDid);
        expect(doc.didDocument.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID for a different valid ID', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = "mockAnchor";

        await keymaster.createId('Alice');

        const dataDid = await keymaster.createAsset(mockAnchor, 'hyperswarm', 'Bob');
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument.id).toBe(dataDid);
        expect(doc.didDocument.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should throw an exception if no ID selected', async () => {
        mockFs({});

        try {
            const mockAnchor = { name: 'mockAnchor' };
            await keymaster.createAsset(mockAnchor);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('No current ID');
        }
    });

    it('should throw an exception for null anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset();
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });

    it('should throw an exception for an empty string anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset("");
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });

    it('should throw an exception for an empty list anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset([]);
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });

    it('should throw an exception for an empty object anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset({});
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe('Invalid input');
        }
    });
});

describe('updateDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should update an asset DID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        const dataUpdated = { name: 'updated' };
        doc.didDocumentData = dataUpdated;

        const ok = await keymaster.updateDID(dataDid, doc);
        const doc2 = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc2.didDocumentData).toStrictEqual(dataUpdated);
        expect(doc2.didDocumentMetadata.version).toBe(2);
    });

    it('should update an asset DID when current ID is not owner ID', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');

        keymaster.setCurrentId('Bob');

        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        const dataUpdated = { name: 'updated' };
        doc.didDocumentData = dataUpdated;

        keymaster.setCurrentId('Alice');

        const ok = await keymaster.updateDID(dataDid, doc);
        const doc2 = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc2.didDocument.controller).toBe(bob);
        expect(doc2.didDocumentData).toStrictEqual(dataUpdated);
        expect(doc2.didDocumentMetadata.version).toBe(2);
    });
});

describe('revokeDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should revoke an asset DID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const ok = await keymaster.revokeDID(dataDid);
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument).toStrictEqual({});
        expect(doc.didDocumentData).toStrictEqual({});
        expect(doc.didDocumentMetadata.deactivated).toBe(true);
    });

    it('should revoke an asset DID when current ID is not owner ID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        await keymaster.createId('Alice');

        keymaster.setCurrentId('Bob');

        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        keymaster.setCurrentId('Alice');

        const ok = await keymaster.revokeDID(dataDid);
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument).toStrictEqual({});
        expect(doc.didDocumentData).toStrictEqual({});
        expect(doc.didDocumentMetadata.deactivated).toBe(true);
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
        const doc = await keymaster.resolveDID(encryptDid);
        const data = doc.didDocumentData;
        const msgHash = cipher.hashMessage(msg);

        expect(data.cipher_hash).toBe(msgHash);
    });

    it('should encrypt a long message', async () => {
        mockFs({});


        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = generateRandomString(1024);
        const encryptDid = await keymaster.encrypt(msg, did);
        const doc = await keymaster.resolveDID(encryptDid);
        const data = doc.didDocumentData;
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
        await keymaster.createId(name1);

        const name2 = 'Bob';
        const did = await keymaster.createId(name2);

        keymaster.setCurrentId(name1);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encrypt(msg, did);

        keymaster.setCurrentId(name2);
        const decipher = await keymaster.decrypt(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a long message encrypted by another ID', async () => {
        mockFs({});

        const name1 = 'Alice';
        await keymaster.createId(name1);

        const name2 = 'Bob';
        const did = await keymaster.createId(name2);

        keymaster.setCurrentId(name1);

        const msg = generateRandomString(1024);
        const encryptDid = await keymaster.encrypt(msg, did);

        keymaster.setCurrentId(name2);
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
        await keymaster.resolveDID(bob);

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
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe('No current ID');
        }
    });

    it('should throw an exception if null parameter', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.addSignature();
            throw ('Expected to throw an exception');
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
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocumentData).toStrictEqual(mockSchema);
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

        keymaster.setCurrentId('Alice')
        const vc = await keymaster.bindCredential(credentialDid, bob);

        expect(vc.issuer).toBe(alice);
        expect(vc.credentialSubject.id).toBe(bob);
        expect(vc.credential.email).toEqual(expect.any(String));
    });
});

describe('issueCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should issue a bound credential when user is issuer', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);

        const did = await keymaster.issueCredential(boundCredential);

        const vc = await keymaster.decryptJSON(did);
        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject.id).toBe(userDid);
        expect(vc.credential.email).toEqual(expect.any(String));

        const isValid = await keymaster.verifySignature(vc);
        expect(isValid).toBe(true);

        const wallet = keymaster.loadWallet();
        expect(wallet.ids['Bob'].owned.includes(did)).toEqual(true);
    });

    it('should throw an exception if user is not issuer', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);

        keymaster.setCurrentId('Bob');

        try {
            await keymaster.issueCredential(boundCredential);
            throw ('Expected to throw an exception');
        }
        catch (error) {
            expect(error).toBe('Invalid VC');
        }
    });
});

describe('listIssued', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return empty list for new ID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const issued = await keymaster.listIssued();

        expect(issued).toStrictEqual([]);
    });

    it('should return list containing one issued credential', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);

        const issued = await keymaster.listIssued();

        expect(issued).toStrictEqual([did]);
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
        const did = await keymaster.issueCredential(boundCredential);

        const ok = await keymaster.revokeCredential(did);
        expect(ok).toBe(true);

        const revoked = await keymaster.resolveDID(did);
        expect(revoked.didDocument).toStrictEqual({});
        expect(revoked.didDocumentMetadata.deactivated).toBe(true);
    });

    it('should return false if verifiable credential is already revoked', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);

        const ok1 = await keymaster.revokeCredential(did);
        expect(ok1).toBe(true);

        const revoked = await keymaster.resolveDID(did);
        expect(revoked.didDocument).toStrictEqual({});
        expect(revoked.didDocumentMetadata.deactivated).toBe(true);

        const ok2 = await keymaster.revokeCredential(did);
        expect(ok2).toBe(false);
    });

    it('should throw exception if user does not control verifiable credential', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        keymaster.setCurrentId('Bob');
        keymaster.removeId('Alice');

        try {
            await keymaster.revokeCredential(did);
            throw ('Expected to throw an exception');
        }
        catch (error) {
            expect(error).toBe('Unknown ID');
        }

    });

    it('should import a revoked credential', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);
        const ok = await keymaster.revokeCredential(did);
        expect(ok).toBe(true);

        const userExport = await keymaster.exportDID(userDid);
        const credentialExport = await keymaster.exportDID(did);

        await gatekeeper.resetDb();

        await keymaster.importDID(userExport);
        const { updated } = await keymaster.importDID(credentialExport);

        expect(updated).toBe(2);
    });
});

describe('acceptCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should add a valid verifiable credential to user wallet', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        keymaster.setCurrentId('Bob');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(true);

        const wallet = keymaster.loadWallet();
        expect(wallet.ids['Alice'].owned.includes(did));
        expect(wallet.ids['Bob'].held.includes(did));
    });

    it('should return false if user is not the credential subject', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Carol');

        keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        keymaster.setCurrentId('Carol');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(false);
    });

    it('should return false if the verifiable credential is invalid', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);

        keymaster.setCurrentId('Bob');

        const ok = await keymaster.acceptCredential(credentialDid);
        expect(ok).toBe(false);
    });
});

describe('createChallenge', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a valid empty challenge', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const did = await keymaster.createChallenge();
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocument.controller).toBe(alice);
        const expected = {
            ephemeral: {
                validUntil: expect.any(String),
            },
            credentials: []
        };
        expect(doc.didDocumentData).toStrictEqual(expected);
    });

    it('should create a valid challenge', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
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

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocument.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual(challenge);
    });

    it('should throw an exception if challenge spec is invalid', async () => {
        mockFs({});

        await keymaster.createId('Alice');

        try {
            await keymaster.createChallenge([]);
            throw ('Expected to throw an exception');
        }
        catch (error) {
            expect(error).toBe('Invalid input');
        }

        try {
            await keymaster.createChallenge({ credentials: 123 });
            throw ('Expected to throw an exception');
        }
        catch (error) {
            expect(error).toBe('Invalid input');
        }

        try {
            await keymaster.createChallenge({ mock: [] });
            throw ('Expected to throw an exception');
        }
        catch (error) {
            expect(error).toBe('Invalid input');
        }
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
        await keymaster.createId('Victor');

        keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const vcDid = await keymaster.issueCredential(boundCredential);

        keymaster.setCurrentId('Bob');

        const ok = await keymaster.acceptCredential(vcDid);
        expect(ok).toBe(true);

        const wallet = keymaster.loadWallet();
        expect(wallet.ids['Alice'].owned.includes(vcDid));
        expect(wallet.ids['Bob'].held.includes(vcDid));

        keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credentialDid,
                    issuers: [alice]
                }
            ]
        };
        const challengeDid = await keymaster.createChallenge(challenge);

        keymaster.setCurrentId('Bob');
        const vpDid = await keymaster.createResponse(challengeDid);
        const data = await keymaster.decryptJSON(vpDid);

        expect(data.challenge).toBe(challengeDid);
        expect(data.credentials.length).toBe(1);
        expect(data.credentials[0].vc).toBe(vcDid);
    });
});

describe('verifyResponse', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should verify valid response to empty challenge', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');
        const challenge = { credentials: [] };
        const challengeDid = await keymaster.createChallenge(challenge);

        keymaster.setCurrentId('Bob');
        const responseDid = await keymaster.createResponse(challengeDid);

        keymaster.setCurrentId('Alice');
        const verify = await keymaster.verifyResponse(responseDid, challengeDid);

        const expected = {
            challenge: challengeDid,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: true,
            vps: [],
        };

        expect(verify).toStrictEqual(expected);
    });

    it('should not verify valid response to a invalid challenge', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');
        const challenge = { credentials: [] };
        const challengeDid = await keymaster.createChallenge(challenge);

        keymaster.setCurrentId('Bob');
        const responseDid = await keymaster.createResponse(challengeDid);

        keymaster.setCurrentId('Alice');
        const verify = await keymaster.verifyResponse(responseDid, responseDid);

        const expected = {
            challenge: challengeDid,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: false,
        };

        expect(verify).toStrictEqual(expected);
    });

    it('should not verify valid response to a different challenge', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        keymaster.setCurrentId('Alice');
        const challenge = { credentials: [] };
        const challengeDid = await keymaster.createChallenge(challenge);

        keymaster.setCurrentId('Bob');
        const responseDid = await keymaster.createResponse(challengeDid);

        keymaster.setCurrentId('Alice');
        const differentChallengeDid = await keymaster.createChallenge(challenge);
        const verify = await keymaster.verifyResponse(responseDid, differentChallengeDid);

        const expected = {
            challenge: challengeDid,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: false,
        };

        expect(verify).toStrictEqual(expected);
    });

    it('should verify a valid response to a single credential challenge', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const carol = await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        keymaster.setCurrentId('Alice');

        const credential1 = await keymaster.createCredential(mockSchema);
        const bc1 = await keymaster.bindCredential(credential1, carol);
        const vc1 = await keymaster.issueCredential(bc1);

        keymaster.setCurrentId('Carol');

        await keymaster.acceptCredential(vc1);

        keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credential1,
                },
            ]
        };
        const challengeDid = await keymaster.createChallenge(challenge);

        keymaster.setCurrentId('Carol');
        const vpDid = await keymaster.createResponse(challengeDid);

        keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(vpDid, challengeDid);

        expect(verify1.match).toBe(true);
        expect(verify1.challenge).toBe(challengeDid);
        expect(verify1.requested).toBe(1);
        expect(verify1.fulfilled).toBe(1);
        expect(verify1.vps.length).toBe(1);
    });

    it('should verify a valid response to a single credential challenge', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        keymaster.setCurrentId('Alice');

        const credential1 = await keymaster.createCredential(mockSchema);

        keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credential1,
                },
            ]
        };
        const challengeDid = await keymaster.createChallenge(challenge);

        keymaster.setCurrentId('Carol');
        const vpDid = await keymaster.createResponse(challengeDid);

        keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(vpDid, challengeDid);

        expect(verify1.match).toBe(false);
        expect(verify1.challenge).toBe(challengeDid);
        expect(verify1.requested).toBe(1);
        expect(verify1.fulfilled).toBe(0);
        expect(verify1.vps.length).toBe(0);
    });

    it('should demonstrate full workflow with credential revocations', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        keymaster.setCurrentId('Alice');

        const credential1 = await keymaster.createCredential(mockSchema);
        const credential2 = await keymaster.createCredential(mockSchema);

        const bc1 = await keymaster.bindCredential(credential1, carol);
        const bc2 = await keymaster.bindCredential(credential2, carol);

        const vc1 = await keymaster.issueCredential(bc1);
        const vc2 = await keymaster.issueCredential(bc2);

        keymaster.setCurrentId('Bob');

        const credential3 = await keymaster.createCredential(mockSchema);
        const credential4 = await keymaster.createCredential(mockSchema);

        const bc3 = await keymaster.bindCredential(credential3, carol);
        const bc4 = await keymaster.bindCredential(credential4, carol);

        const vc3 = await keymaster.issueCredential(bc3);
        const vc4 = await keymaster.issueCredential(bc4);

        keymaster.setCurrentId('Carol');

        await keymaster.acceptCredential(vc1);
        await keymaster.acceptCredential(vc2);
        await keymaster.acceptCredential(vc3);
        await keymaster.acceptCredential(vc4);

        keymaster.setCurrentId('Victor');

        const challenge = {
            credentials: [
                {
                    schema: credential1,
                    issuers: [alice]
                },
                {
                    schema: credential2,
                    issuers: [alice]
                },
                {
                    schema: credential3,
                    issuers: [bob]
                },
                {
                    schema: credential4,
                    issuers: [bob]
                },
            ]
        };
        const challengeDid = await keymaster.createChallenge(challenge);

        keymaster.setCurrentId('Carol');
        const vpDid = await keymaster.createResponse(challengeDid);
        const data = await keymaster.decryptJSON(vpDid);

        expect(data.challenge).toBe(challengeDid);
        expect(data.credentials.length).toBe(4);

        keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(vpDid, challengeDid);
        expect(verify1.match).toBe(true);
        expect(verify1.vps.length).toBe(4);

        // All agents rotate keys
        keymaster.setCurrentId('Alice');
        await keymaster.rotateKeys();

        keymaster.setCurrentId('Bob');
        await keymaster.rotateKeys();

        keymaster.setCurrentId('Carol');
        await keymaster.rotateKeys();

        keymaster.setCurrentId('Victor');
        await keymaster.rotateKeys();

        const verify2 = await keymaster.verifyResponse(vpDid, challengeDid);
        expect(verify2.match).toBe(true);
        expect(verify2.vps.length).toBe(4);

        keymaster.setCurrentId('Alice');
        await keymaster.revokeCredential(vc1);

        keymaster.setCurrentId('Victor');
        const verify3 = await keymaster.verifyResponse(vpDid, challengeDid)
        expect(verify3.match).toBe(false);
        expect(verify3.vps.length).toBe(3);

        keymaster.setCurrentId('Bob');
        await keymaster.revokeCredential(vc3);

        keymaster.setCurrentId('Victor');
        const verify4 = await keymaster.verifyResponse(vpDid, challengeDid);
        expect(verify4.match).toBe(false);
        expect(verify4.vps.length).toBe(2);
    });
});

describe('publishCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should reveal a valid credential', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.publishCredential(did, true);

        const doc = await keymaster.resolveDID(bob);
        const vc = await keymaster.decryptJSON(did);
        const manifest = doc.didDocumentData.manifest;

        expect(manifest[did]).toStrictEqual(vc);
    });

    it('should publish a valid credential without revealing', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.publishCredential(did, false);

        const doc = await keymaster.resolveDID(bob);
        const vc = await keymaster.decryptJSON(did);
        const manifest = doc.didDocumentData.manifest;

        vc.credential = null;

        expect(manifest[did]).toStrictEqual(vc);
    });
});

describe('unpublishCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should unpublish a published credential', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);
        await keymaster.publishCredential(did, true);

        await keymaster.unpublishCredential(did);

        const doc = await keymaster.resolveDID(bob);
        const manifest = doc.didDocumentData.manifest;

        expect(manifest).toStrictEqual({});
    });

    it('should throw an exception when no current ID', async () => {
        mockFs({});

        try {
            await keymaster.unpublishCredential('mock');
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('No current ID');
        }
    });

    it('should throw an exception when credential invalid', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.unpublishCredential('did:test:mock');
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Error: credential did:test:mock not found in manifest');
        }
    });

    it('should throw an exception when credential not found', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createCredential(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        try {
            await keymaster.unpublishCredential(did);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe(`Error: credential ${did} not found in manifest`);
        }
    });
});

describe('createGroup', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a new named group', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const doc = await keymaster.resolveDID(groupDid);

        expect(doc.didDocument.id).toBe(groupDid);
        expect(doc.didDocument.controller).toBe(ownerDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(doc.didDocumentData).toStrictEqual(expectedGroup);
    });
});

describe('groupAdd', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should add a DID member to the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const data = await keymaster.groupAdd(groupDid, dataDid);

        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should add a DID alias to the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const alias = 'mockAlias';
        keymaster.addName(alias, dataDid);
        const data = await keymaster.groupAdd(groupDid, alias);

        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should not add an unknown DID alias to the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            await keymaster.groupAdd(groupDid, 'mockAlias');
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Unknown DID');
        }
    });

    it('should add a DID to a group alias', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const alias = 'mockAlias';
        keymaster.addName(alias, groupDid);
        const data = await keymaster.groupAdd(alias, dataDid);

        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should not add a DID member to an unknown group alias', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.groupAdd('mockAlias', dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Unknown DID');
        }
    });

    it('should add a member to the group only once', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.groupAdd(groupDid, dataDid);
        await keymaster.groupAdd(groupDid, dataDid);
        await keymaster.groupAdd(groupDid, dataDid);

        const data = await keymaster.groupAdd(groupDid, dataDid);

        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should not increment version when adding a member a 2nd time', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.groupAdd(groupDid, dataDid);
        const dox1 = await keymaster.resolveDID(groupDid);
        const version1 = dox1.didDocumentMetadata.version;

        await keymaster.groupAdd(groupDid, dataDid);
        const dox2 = await keymaster.resolveDID(groupDid);
        const version2 = dox2.didDocumentMetadata.version;

        expect(version2).toBe(version1);
    });

    it('should add multiple members to the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const memberCount = 5;

        for (let i = 0; i < memberCount; i++) {
            const mockAnchor = { name: `mock-${i}` };
            const dataDid = await keymaster.createAsset(mockAnchor);
            await keymaster.groupAdd(groupDid, dataDid);
        }

        const data = await keymaster.resolveAsset(groupDid);

        expect(data.members.length).toBe(memberCount);
    });

    it('should not add a non-DID to the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            await keymaster.groupAdd(groupDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd(groupDid, 100);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd(groupDid, [1, 2, 3]);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd(groupDid, { name: 'mock' });
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd(groupDid, 'did:mock');
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }
    });

    it('should not add a member to a non-group', async () => {
        mockFs({});

        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.groupAdd(null, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd(100, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd([1, 2, 3], dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd({ name: 'mock' }, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupAdd(agentDid, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid group');
        }

        try {
            await keymaster.groupAdd(dataDid, agentDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid group');
        }
    });

    it('should not add a group to itself', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupDid = await keymaster.createGroup('group');

        try {
            await keymaster.groupAdd(groupDid, groupDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid member');
        }
    });

    it('should not add a member that contains group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const group1Did = await keymaster.createGroup('group-1');
        const group2Did = await keymaster.createGroup('group-2');
        const group3Did = await keymaster.createGroup('group-3');

        await keymaster.groupAdd(group1Did, group2Did);
        await keymaster.groupAdd(group2Did, group3Did);

        try {
            await keymaster.groupAdd(group3Did, group1Did);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid member');
        }
    });
});

describe('groupRemove', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should remove a DID member from a group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.groupAdd(groupDid, dataDid);

        const data = await keymaster.groupRemove(groupDid, dataDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should remove a DID alias from a group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.groupAdd(groupDid, dataDid);

        const alias = 'mockAlias';
        keymaster.addName(alias, dataDid);

        const data = await keymaster.groupRemove(groupDid, alias);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should be OK to remove a DID that is not in the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const data = await keymaster.groupRemove(groupDid, dataDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(data).toStrictEqual(expectedGroup);
    });

    it('should not increment version when removing a non-existent member', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dox1 = await keymaster.resolveDID(groupDid);
        const version1 = dox1.didDocumentMetadata.version;

        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.groupRemove(groupDid, dataDid);
        const dox2 = await keymaster.resolveDID(groupDid);
        const version2 = dox2.didDocumentMetadata.version;

        expect(version2).toBe(version1);
    });

    it('should not remove a non-DID from the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            await keymaster.groupRemove(groupDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove(groupDid, 100);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove(groupDid, [1, 2, 3]);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove(groupDid, { name: 'mock' });
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove(groupDid, 'did:mock');
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }
    });

    it('should not remove a member from a non-group', async () => {
        mockFs({});

        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.groupRemove();
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove(null, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove(100, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove([1, 2, 3], dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove({ name: 'mock' }, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }

        try {
            await keymaster.groupRemove(agentDid, dataDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid group');
        }

        try {
            await keymaster.groupRemove(dataDid, agentDid);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid group');
        }
    });
});

describe('groupTest', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return true when member in group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.groupAdd(groupDid, dataDid);

        const test = await keymaster.groupTest(groupDid, dataDid);

        expect(test).toBe(true);
    });

    it('should return false when member not in group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const test = await keymaster.groupTest(groupDid, dataDid);

        expect(test).toBe(false);
    });

    it('should return true when testing group only', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        const test = await keymaster.groupTest(groupDid);

        expect(test).toBe(true);
    });

    it('should return false when testing non-group only', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const test = await keymaster.groupTest(dataDid);

        expect(test).toBe(false);
    });

    it('should return true when testing recursive groups', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const group1Did = await keymaster.createGroup('level-1');
        const group2Did = await keymaster.createGroup('level-2');
        const group3Did = await keymaster.createGroup('level-3');
        const group4Did = await keymaster.createGroup('level-4');
        const group5Did = await keymaster.createGroup('level-5');

        await keymaster.groupAdd(group1Did, group2Did);
        await keymaster.groupAdd(group2Did, group3Did);
        await keymaster.groupAdd(group3Did, group4Did);
        await keymaster.groupAdd(group4Did, group5Did);

        const test1 = await keymaster.groupTest(group1Did, group2Did);
        expect(test1).toBe(true);

        const test2 = await keymaster.groupTest(group1Did, group3Did);
        expect(test2).toBe(true);

        const test3 = await keymaster.groupTest(group1Did, group4Did);
        expect(test3).toBe(true);

        const test4 = await keymaster.groupTest(group1Did, group5Did);
        expect(test4).toBe(true);
    });
});

describe('getGroup', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return the specified group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mock';
        const groupDID = await keymaster.createGroup(groupName);

        const group = await keymaster.getGroup(groupDID);

        expect(group.name).toBe(groupName);
        expect(group.members).toStrictEqual([]);
    });

    it('should raise an exception if no DID specified', async () => {
        mockFs({});

        try {
            await keymaster.getGroup();
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid DID');
        }
    });

    it('should raise an exception non-group DID specified', async () => {
        mockFs({});

        try {
            const agentDID = await keymaster.createId('Bob');
            await keymaster.getGroup(agentDID);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid group');
        }
    });
});

describe('pollTemplate', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return a poll template', async () => {
        mockFs({});

        const template = await keymaster.pollTemplate();

        const expectedTemplate = {
            type: 'poll',
            version: 1,
            description: 'What is this poll about?',
            roster: 'DID of the eligible voter group',
            options: ['yes', 'no', 'abstain'],
            deadline: expect.any(String),
        };

        expect(template).toStrictEqual(expectedTemplate);
    });
});

describe('createPoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a poll from a valid template', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createPoll(template);
        const data = await keymaster.resolveAsset(did);

        expect(data).toStrictEqual(template);
    });

    it('should not create a poll from an invalid template', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.type = "wrong type";
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll type');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.version = 0;
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll version');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.description;
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll description');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.roster;
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll roster');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.options;
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = ['one option'];
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = "not a list";
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.deadline;
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll deadline');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.deadline = "not a date";
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll deadline');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));

            const now = new Date();
            const lastWeek = new Date();
            lastWeek.setDate(now.getDate() - 7);

            poll.deadline = lastWeek.toISOString();
            await keymaster.createPoll(poll);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid poll deadline');
        }
    });
});

describe('viewPoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return a valid view from a new poll', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createPoll(template);
        const view = await keymaster.viewPoll(did);

        expect(view.deadline).toBe(template.deadline);
        expect(view.description).toBe(template.description);
        expect(view.options).toStrictEqual(template.options);
        expect(view.hasVoted).toBe(false);
        expect(view.isEligible).toBe(true);
        expect(view.isOwner).toBe(true);
        expect(view.voteExpired).toBe(false);
        expect(view.results.ballots).toStrictEqual([]);
        expect(view.results.tally.length).toBe(4);
        expect(view.results.votes.eligible).toBe(1);
        expect(view.results.votes.pending).toBe(1);
        expect(view.results.votes.received).toBe(0);
        expect(view.results.final).toBe(false);
    });
});

describe('votePoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return a valid ballot', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        const ballot = await keymaster.decryptJSON(ballotDid);

        const expectedBallot = {
            poll: pollDid,
            vote: 1,
        };

        expect(ballot).toStrictEqual(expectedBallot);
    });

    it('should not return a ballot for an invalid vote', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.votePoll(pollDid, 5);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Vote must be a number between 1 and 3');
        }
    });

    it('should not return a ballot for an ineligiblew voter', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.votePoll(pollDid, 5);
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Not eligible to vote on this poll');
        }
    });
});

describe('updatePoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should update poll with valid ballot', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);

        const ok = await keymaster.updatePoll(ballotDid);
        const pollData = await keymaster.resolveAsset(pollDid);

        expect(ok).toBe(true);
        expect(pollData.ballots[bobDid].ballot).toBe(ballotDid);
    });

    it('should reject non-ballots', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.updatePoll(pollDid)
            throw 'Expected to throw an exception';
        }
        catch (error) {
            expect(error).toBe('Invalid ballot');
        }
    });
});

describe('publishPoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should publish results to poll', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        const ok = await keymaster.publishPoll(pollDid);

        const pollData = await keymaster.resolveAsset(pollDid);

        expect(ok).toBe(true);
        expect(pollData.results.final).toBe(true);
        expect(pollData.results.votes.eligible).toBe(1);
        expect(pollData.results.votes.pending).toBe(0);
        expect(pollData.results.votes.received).toBe(1);
        expect(pollData.results.tally.length).toBe(4);
        expect(pollData.results.tally[0]).toStrictEqual({
            vote: 0,
            option: 'spoil',
            count: 0,
        });
        expect(pollData.results.tally[1]).toStrictEqual({
            vote: 1,
            option: 'yes',
            count: 1,
        });
        expect(pollData.results.tally[2]).toStrictEqual({
            vote: 2,
            option: 'no',
            count: 0,
        });
        expect(pollData.results.tally[3]).toStrictEqual({
            vote: 3,
            option: 'abstain',
            count: 0,
        });
    });

    it('should reveal results to poll', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        const ok = await keymaster.publishPoll(pollDid, true);
        const pollData = await keymaster.resolveAsset(pollDid);

        expect(ok).toBe(true);
        expect(pollData.results.ballots.length).toBe(1);
        expect(pollData.results.ballots[0]).toStrictEqual({
            ballot: ballotDid,
            voter: bobDid,
            vote: 1,
            option: 'yes',
            received: expect.any(String),
        });
    });
});

describe('unpublishPoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should remove results from poll', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.groupAdd(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        await keymaster.publishPoll(pollDid);
        const ok = await keymaster.unpublishPoll(pollDid);

        const pollData = await keymaster.resolveAsset(pollDid);

        expect(ok).toBe(true);
        expect(pollData.results).toBe(undefined);
    });
});

describe('createSchema', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a default schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocumentData).toStrictEqual(keymaster.defaultSchema);
    });

    it('should create a simple schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema(mockSchema);
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocumentData).toStrictEqual(mockSchema);
    });


    it('should throw an exception on invalid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.createSchema({ mock: 'not a schema' });
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Invalid schema`);
        }
    });
});

describe('getSchema', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return the schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema(mockSchema);
        const schema = await keymaster.getSchema(did);

        expect(schema).toStrictEqual(mockSchema);
    });

    it('should throw an exception on invalid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.getSchema('bogus');
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Unknown DID`);
        }
    });
});

describe('setSchema', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should update the schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        const ok = await keymaster.setSchema(did, mockSchema);
        const newSchema = await keymaster.getSchema(did);

        expect(ok).toBe(true);
        expect(newSchema).toStrictEqual(mockSchema);
    });

    it('should throw an exception on invalid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();

        try {
            await keymaster.setSchema(did, { mock: 'not a schema' });
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Invalid schema`);
        }
    });
});

describe('testSchema', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return true for a valid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        await keymaster.setSchema(did, mockSchema);

        const isSchema = await keymaster.testSchema(did);

        expect(isSchema).toBe(true);
    });

    it('should return false for a non-schema DID', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Bob');
        const isSchema = await keymaster.testSchema(agentDID);

        expect(isSchema).toBe(false);
    });

    it('should raise an exception when no DID provided', async () => {
        mockFs({});

        try {
            await keymaster.testSchema();
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Invalid DID`);
        }
    });
});

describe('createTemplate', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create template from a valid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        await keymaster.setSchema(did, mockSchema);

        const template = await keymaster.createTemplate(did);
        const expectedTemplate = {
            "$schema": did,
            email: expect.any(String),
        };

        expect(template).toStrictEqual(expectedTemplate);
    });

    it('should raise an exception when no DID provided', async () => {
        mockFs({});

        try {
            await keymaster.createTemplate();
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Invalid DID`);
        }
    });
});

describe('listRegistries', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of valid registries', async () => {
        mockFs({});

        const registries = await keymaster.listRegistries();

        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TESS')).toBe(true);
    });
});

async function setupCredentials() {
    await keymaster.createId('Alice');
    await keymaster.createId('Bob');
    const carol = await keymaster.createId('Carol');
    await keymaster.createId('Victor');

    keymaster.setCurrentId('Alice');

    const credential1 = await keymaster.createCredential(mockSchema);
    const credential2 = await keymaster.createCredential(mockSchema);

    const bc1 = await keymaster.bindCredential(credential1, carol);
    const bc2 = await keymaster.bindCredential(credential2, carol);

    const vc1 = await keymaster.issueCredential(bc1);
    const vc2 = await keymaster.issueCredential(bc2);

    keymaster.setCurrentId('Bob');

    const credential3 = await keymaster.createCredential(mockSchema);
    const credential4 = await keymaster.createCredential(mockSchema);

    const bc3 = await keymaster.bindCredential(credential3, carol);
    const bc4 = await keymaster.bindCredential(credential4, carol);

    const vc3 = await keymaster.issueCredential(bc3);
    const vc4 = await keymaster.issueCredential(bc4);

    keymaster.setCurrentId('Carol');

    await keymaster.acceptCredential(vc1);
    await keymaster.acceptCredential(vc2);
    await keymaster.acceptCredential(vc3);
    await keymaster.acceptCredential(vc4);

    return [vc1, vc2, vc3, vc4];
}

describe('checkWallet', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should report no problems with empty wallet', async () => {
        mockFs({});

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(0);
        expect(invalid).toBe(0);
        expect(deleted).toBe(0);
    });

    it('should report no problems with wallet with only one ID', async () => {
        mockFs({});

        await keymaster.createId('Alice');

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(1);
        expect(invalid).toBe(0);
        expect(deleted).toBe(0);
    });

    it('should detect revoked ID', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Alice');
        await keymaster.revokeDID(agentDID);

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(1);
        expect(invalid).toBe(0);
        expect(deleted).toBe(1);
    });

    it('should detect invalid DIDs', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Alice');
        const schemaDID = await keymaster.createSchema();
        keymaster.addName('schema', schemaDID);
        await gatekeeper.removeDIDs([agentDID, schemaDID]);

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(3);
        expect(invalid).toBe(3);
        expect(deleted).toBe(0);
    });

    it('should detect revoked credentials in wallet', async () => {
        mockFs({});

        const credentials = await setupCredentials();
        keymaster.addName('credential-0', credentials[0]);
        keymaster.addName('credential-2', credentials[2]);
        await keymaster.revokeCredential(credentials[0]);
        await keymaster.revokeCredential(credentials[2]);

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(18);
        expect(invalid).toBe(0);
        expect(deleted).toBe(6); // 2 credentials mentioned in owned and held and name lists
    });
});

describe('fixWallet', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should report no problems with empty wallet', async () => {
        mockFs({});

        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(0);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(0);
    });

    it('should report no problems with wallet with only one ID', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(0);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(0);
    });

    it('should remove revoked ID', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Alice');
        await keymaster.revokeDID(agentDID);

        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(1);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(0);
    });

    it('should remove invalid DIDs', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Alice');
        const schemaDID = await keymaster.createSchema();
        keymaster.addName('schema', schemaDID);
        await gatekeeper.removeDIDs([agentDID, schemaDID]);

        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(1);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(1);
    });

    it('should remove revoked credentials', async () => {
        mockFs({});

        const credentials = await setupCredentials();
        keymaster.addName('credential-0', credentials[0]);
        keymaster.addName('credential-2', credentials[2]);
        await keymaster.revokeCredential(credentials[0]);
        await keymaster.revokeCredential(credentials[2]);

        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(0);
        expect(ownedRemoved).toBe(2);
        expect(heldRemoved).toBe(2);
        expect(namesRemoved).toBe(2);
    });
});

describe('listCredentials', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('return list of held credentials', async () => {
        mockFs({});

        const expectedCredentials = await setupCredentials();
        const credentials = await keymaster.listCredentials('Carol');

        expect(credentials).toStrictEqual(expectedCredentials);
    });

    it('return empty list if specified ID holds no credentials', async () => {
        mockFs({});

        await setupCredentials();
        const credentials = await keymaster.listCredentials('Bob');

        expect(credentials).toStrictEqual([]);
    });

    it('raises an exception if invalid ID specified', async () => {
        mockFs({});

        try {
            await keymaster.listCredentials('mock');
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Unknown ID`);
        }
    });
});

describe('getCredential', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('returns decrypted credential for valid DID', async () => {
        mockFs({});

        const credentials = await setupCredentials();

        for (const did of credentials) {
            const credential = await keymaster.getCredential(did);
            expect(credential.type[0]).toBe('VerifiableCredential');
        }
    });

    it('raises an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.getCredential('mock');
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Unknown DID`);
        }
    });

    it('raises an exception if DID specified that is not a credential', async () => {
        mockFs({});

        try {
            const agentDID = await keymaster.createId('Rando');
            await keymaster.getCredential(agentDID);
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`DID is not encrypted`);
        }
    });
});

describe('removeCredential', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('removes specified credential from held credentials list', async () => {
        mockFs({});

        const credentials = await setupCredentials();

        const ok1 = await keymaster.removeCredential(credentials[1]);
        const ok2 = await keymaster.removeCredential(credentials[3]);

        expect(ok1).toBe(true);
        expect(ok2).toBe(true);

        const held = await keymaster.listCredentials('Carol');

        expect(held).toStrictEqual([credentials[0], credentials[2]]);
    });

    it('returns false if DID not previously held', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Rando');
        const ok = await keymaster.removeCredential(agentDID);

        expect(ok).toBe(false);
    });

    it('raises an exception if no DID specified', async () => {
        mockFs({});

        try {
            await keymaster.removeCredential();
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Invalid DID`);
        }
    });

    it('raises an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.removeCredential('mock');
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Unknown DID`);
        }
    });
});

describe('listIds', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should list all IDs wallet', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        const ids = keymaster.listIds();

        expect(ids.length).toBe(4);
        expect(ids.includes('Alice')).toBe(true);
        expect(ids.includes('Bob')).toBe(true);
        expect(ids.includes('Carol')).toBe(true);
        expect(ids.includes('Victor')).toBe(true);
    });
});

describe('getCurrentId', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should list all IDs wallet', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        const current = keymaster.getCurrentId();

        expect(current).toBe('Victor');
    });
});

describe('setCurrentId', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should set current ID', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        keymaster.setCurrentId('Carol');
        const current = keymaster.getCurrentId();

        expect(current).toBe('Carol');
    });

    it('should throw an exception on invalid ID', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        try {
            keymaster.setCurrentId('mock');
            throw ('Expected to throw an exception');
        } catch (error) {
            expect(error).toBe(`Unknown ID`);
        }
    });
});
