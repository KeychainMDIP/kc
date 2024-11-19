import mockFs from 'mock-fs';
import canonicalize from 'canonicalize';

import * as keymaster from '@mdip/keymaster/lib';
import * as gatekeeper from '@mdip/gatekeeper/lib';
import * as cipher from '@mdip/cipher/node';
import * as db_json from '@mdip/gatekeeper/db/json';
import * as wallet from '@mdip/keymaster/db/json';
import * as exceptions from '@mdip/exceptions';

beforeEach(async () => {
    await db_json.start('mdip');
    await gatekeeper.start({ db: db_json });
    await keymaster.start({ gatekeeper, wallet, cipher });
});

afterEach(async () => {
    await keymaster.stop();
    await gatekeeper.stop();
    await db_json.stop();
});

describe('start', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should throw exception on invalid parameters', async () => {
        mockFs({});

        try {
            await keymaster.start();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.start({ wallet, cipher });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.start({ gatekeeper, cipher });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.start({ gatekeeper, wallet });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.start({ gatekeeper: {}, wallet, cipher });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.start({ gatekeeper, wallet: {}, cipher });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.start({ gatekeeper, wallet, cipher: {} });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('loadWallet', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a wallet on first load', async () => {
        mockFs({});

        const wallet = await keymaster.loadWallet();

        expect(wallet.seed.mnemonic.length > 0).toBe(true);
        expect(wallet.seed.hdkey.xpub.length > 0).toBe(true);
        expect(wallet.seed.hdkey.xpriv.length > 0).toBe(true);
        expect(wallet.counter).toBe(0);
        expect(wallet.ids).toStrictEqual({});
    });

    it('should return the same wallet on second load', async () => {
        mockFs({});

        const wallet1 = await keymaster.loadWallet();
        const wallet2 = await keymaster.loadWallet();

        expect(wallet2).toStrictEqual(wallet1);
    });
});

describe('saveWallet', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should save a wallet', async () => {
        mockFs({});
        const mockWallet = { mock: 0 };

        const ok = await keymaster.saveWallet(mockWallet);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should ignore overwrite flag if unnecessary', async () => {
        mockFs({});
        const mockWallet = { mock: 0 };

        const ok = await keymaster.saveWallet(mockWallet, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should handle data folder existing already', async () => {
        mockFs({
            data: {}
        });
        const mockWallet = { mock: 0 };

        const ok = await keymaster.saveWallet(mockWallet);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should overwrite an existing wallet', async () => {
        mockFs({});
        const mockWallet1 = { mock: 1 };
        const mockWallet2 = { mock: 2 };

        await keymaster.saveWallet(mockWallet1);
        const ok = await keymaster.saveWallet(mockWallet2);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet2);
    });

    it('should not overwrite an existing wallet if specified', async () => {
        mockFs({});
        const mockWallet1 = { mock: 1 };
        const mockWallet2 = { mock: 2 };

        await keymaster.saveWallet(mockWallet1);
        const ok = await keymaster.saveWallet(mockWallet2, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(false);
        expect(wallet).toStrictEqual(mockWallet1);
    });

    it('should overwrite an existing wallet in a loop', async () => {
        mockFs({});

        for (let i = 0; i < 10; i++) {
            const mockWallet = { mock: i };

            const ok = await keymaster.saveWallet(mockWallet);
            const wallet = await keymaster.loadWallet();

            expect(ok).toBe(true);
            expect(wallet).toStrictEqual(mockWallet);
        }
    });
});

describe('decryptMnemonic', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return 12 words', async () => {
        mockFs({});

        const wallet = await keymaster.loadWallet();
        const mnemonic = await keymaster.decryptMnemonic();

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

        const wallet1 = await keymaster.loadWallet();
        await keymaster.newWallet(null, true);
        const wallet2 = await keymaster.loadWallet();

        expect(wallet1.seed.mnemonic !== wallet2.seed.mnemonic).toBe(true);
    });

    it('should not overwrite an existing wallet by default', async () => {
        mockFs({});

        await keymaster.loadWallet();

        try {
            await keymaster.newWallet();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UPDATE_FAILED);
        }
    });

    it('should create a wallet from a mnemonic', async () => {
        mockFs({});

        const mnemonic1 = cipher.generateMnemonic();
        await keymaster.newWallet(mnemonic1);
        const mnemonic2 = await keymaster.decryptMnemonic();

        expect(mnemonic1 === mnemonic2).toBe(true);
    });

    it('should throw exception on invalid mnemonic', async () => {
        mockFs({});

        try {
            await keymaster.newWallet([]);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('resolveSeedBank', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should create a deterministic seed bank ID', async () => {
        mockFs({});

        const bank1 = await keymaster.resolveSeedBank();
        const bank2 = await keymaster.resolveSeedBank();

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
        const wallet = await keymaster.loadWallet();
        const mnemonic = await keymaster.decryptMnemonic();
        await keymaster.backupWallet();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(wallet).toStrictEqual(recovered);
    });

    it('should recover wallet from backup DID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();
        const mnemonic = await keymaster.decryptMnemonic();
        const did = await keymaster.backupWallet();

        // Recover wallet from mnemonic and recovery DID
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet(did);

        expect(wallet).toStrictEqual(recovered);
    });

    it('should do nothing if wallet was not backed up', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const mnemonic = await keymaster.decryptMnemonic();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(recovered.ids).toStrictEqual({});
    });

    it('should do nothing if backup DID is invalid', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Bob');
        const mnemonic = await keymaster.decryptMnemonic();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet(agentDID);

        expect(recovered.ids).toStrictEqual({});
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
        const wallet = await keymaster.loadWallet();

        expect(wallet.ids[name].did).toBe(did);
        expect(wallet.current).toBe(name);
    });

    it('should throw to create a second ID with the same name', async () => {
        mockFs({});

        const name = 'Bob';
        await keymaster.createId(name);

        try {
            await keymaster.createId(name);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should create a second ID with a different name', async () => {
        mockFs({});

        const name1 = 'Bob';
        const did1 = await keymaster.createId(name1);

        const name2 = 'Alice';
        const did2 = await keymaster.createId(name2);

        const wallet = await keymaster.loadWallet();

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

        await keymaster.removeId(name);

        const wallet = await keymaster.loadWallet();

        expect(wallet.ids).toStrictEqual({});
        expect(wallet.current).toBe('');
    });

    it('should throw to remove an non-existent ID', async () => {
        mockFs({});

        const name1 = 'Bob';
        const name2 = 'Alice';

        await keymaster.createId(name1);

        try {
            await keymaster.removeId(name2);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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

        await keymaster.setCurrentId(name1);

        const wallet = await keymaster.loadWallet();
        expect(wallet.current).toBe(name1);
    });

    it('should not switch to an invalid ID', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.setCurrentId('Alice');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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
        let wallet = await keymaster.loadWallet();
        const bob = wallet.ids['Bob'];
        const mnemonic = await keymaster.decryptMnemonic();

        await keymaster.backupId();

        // reset wallet
        await keymaster.newWallet(mnemonic, true);
        wallet = await keymaster.loadWallet();
        expect(wallet.ids).toStrictEqual({});

        await keymaster.recoverId(did);
        wallet = await keymaster.loadWallet();
        expect(wallet.ids[name]).toStrictEqual(bob);
        expect(wallet.current === name);
        expect(wallet.counter === 1);
    });

    it('should not recover an id to a different wallet', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');
        await keymaster.backupId();

        // reset to a different wallet
        await keymaster.newWallet(null, true);

        try {
            await keymaster.recoverId(did);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
        const dataDid = await keymaster.createAsset({ name: 'mockAnchor' });
        const isAgent = await keymaster.testAgent(dataDid);

        expect(isAgent).toBe(false);
    });

    it('should raise an exception if no DID specified', async () => {
        mockFs({});

        try {
            await keymaster.testAgent();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }
    });

    it('should raise an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.testAgent('mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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

        const alice = await keymaster.createId('Alice', { registry: 'local' });
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

        await keymaster.createId('Alice', { registry: 'local' });
        const bob = await keymaster.createId('Bob', { registry: 'local' });
        const secrets = [];
        const msg = "Hi Bob!";

        for (let i = 0; i < 3; i++) {
            await keymaster.setCurrentId('Alice');

            const did = await keymaster.encryptMessage(msg, bob, { registry: 'local' });
            secrets.push(did);

            await keymaster.rotateKeys();

            await keymaster.setCurrentId('Bob');
            await keymaster.rotateKeys();
        }

        for (let secret of secrets) {
            await keymaster.setCurrentId('Alice');

            const decipher1 = await keymaster.decryptMessage(secret);
            expect(decipher1).toBe(msg);

            await keymaster.setCurrentId('Bob');

            const decipher2 = await keymaster.decryptMessage(secret);
            expect(decipher2).toBe(msg);
        }
    });

    it('should raise an exception if latest version is not confirmed', async () => {
        mockFs({});

        await keymaster.createId('Alice', 'TFTC');
        await keymaster.rotateKeys();

        try {
            await keymaster.rotateKeys();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe('Cannot rotate keys');
        }
    });
});

describe('addName', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a new name', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const ok = await keymaster.addName('Jack', bob);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.names['Jack'] === bob).toBe(true);
    });

    it('should not add duplicate name', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.addName('Jack', alice);
            await keymaster.addName('Jack', bob);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should not add a name that is same as an ID', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.addName('Alice', alice);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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

        await keymaster.addName('Jack', bob);
        await keymaster.removeName('Jack');

        const wallet = await keymaster.loadWallet();

        expect(wallet.names['Jack'] === bob).toBe(false);
    });

    it('should return true if name is missing', async () => {
        mockFs({});

        const ok = await keymaster.removeName('Jack');

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
            await keymaster.addName(`name-${i}`, bob);
        }

        const names = await keymaster.listNames();

        expect(Object.keys(names).length).toBe(10);

        for (const name of Object.keys(names)) {
            expect(names[name]).toBe(bob);
        }
    });

    it('should return empty list if no names added', async () => {
        mockFs({});

        const names = await keymaster.listNames();

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

        await keymaster.addName('mock', dataDid);

        const doc1 = await keymaster.resolveDID(dataDid);
        const doc2 = await keymaster.resolveDID('mock');

        expect(doc1).toStrictEqual(doc2);
    });

    it('should throw an exception for invalid name', async () => {
        mockFs({});

        try {
            await keymaster.resolveDID('mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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

        const dataDid = await keymaster.createAsset(mockAnchor, { registry: 'hyperswarm', controller: 'Bob' });
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.NO_CURRENT_ID);
        }
    });

    it('should throw an exception for null anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should throw an exception for an empty string anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset("");
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should throw an exception for an empty list anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset([]);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should throw an exception for an empty object anchor', async () => {
        mockFs({});

        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset({});
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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

        const ok = await keymaster.updateDID(doc);
        const doc2 = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc2.didDocumentData).toStrictEqual(dataUpdated);
        expect(doc2.didDocumentMetadata.version).toBe(2);
    });

    it('should update an asset DID when current ID is not owner ID', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');

        await keymaster.setCurrentId('Bob');

        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        const dataUpdated = { name: 'updated' };
        doc.didDocumentData = dataUpdated;

        await keymaster.setCurrentId('Alice');

        const ok = await keymaster.updateDID(doc);
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

        await keymaster.setCurrentId('Bob');

        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.setCurrentId('Alice');

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

describe('encryptMessage', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should encrypt a short message', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encryptMessage(msg, did);
        const doc = await keymaster.resolveDID(encryptDid);
        const data = doc.didDocumentData;
        const msgHash = cipher.hashMessage(msg);

        expect(data.encrypted.cipher_hash).toBe(msgHash);
    });

    it('should encrypt a long message', async () => {
        mockFs({});


        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = generateRandomString(1024);
        const encryptDid = await keymaster.encryptMessage(msg, did);
        const doc = await keymaster.resolveDID(encryptDid);
        const data = doc.didDocumentData;
        const msgHash = cipher.hashMessage(msg);

        expect(data.encrypted.cipher_hash).toBe(msgHash);
    });
});

describe('decryptMessage', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should decrypt a short message encrypted by same ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        const msg = 'Hi Bob!';
        const encryptDid = await keymaster.encryptMessage(msg, did);
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a short message after rotating keys (confirmed)', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob', { registry: 'local' });
        const msg = 'Hi Bob!';
        await keymaster.rotateKeys();
        const encryptDid = await keymaster.encryptMessage(msg, did, { encryptForSender: true, registry: 'local' });
        await keymaster.rotateKeys();
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a short message after rotating keys (unconfirmed)', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob', { registry: 'hyperswarm' });
        const msg = 'Hi Bob!';
        await keymaster.rotateKeys();
        const encryptDid = await keymaster.encryptMessage(msg, did, { encryptForSender: true, registry: 'hyperswarm' });
        const decipher = await keymaster.decryptMessage(encryptDid);

        expect(decipher).toBe(msg);
    });

    it('should decrypt a short message encrypted by another ID', async () => {
        mockFs({});

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
        mockFs({});

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

        expect(data.encrypted.sender).toStrictEqual(bob);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.NO_CURRENT_ID);
        }
    });

    it('should throw an exception if null parameter', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.addSignature();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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

describe('bindCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a bound credential', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        const vc = await keymaster.bindCredential(credentialDid, userDid);

        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject.id).toBe(userDid);
        expect(vc.credential.email).toEqual(expect.any(String));
    });

    it('should create a bound credential with provided default', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        const credential = { email: 'bob@mock.com' };
        const vc = await keymaster.bindCredential(credentialDid, userDid, { credential });

        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject.id).toBe(userDid);
        expect(vc.credential.email).toEqual(credential.email);
    });

    it('should create a bound credential for a different user', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Alice')
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
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);

        const did = await keymaster.issueCredential(boundCredential);

        const vc = await keymaster.decryptJSON(did);
        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject.id).toBe(userDid);
        expect(vc.credential.email).toEqual(expect.any(String));

        const isValid = await keymaster.verifySignature(vc);
        expect(isValid).toBe(true);

        const wallet = await keymaster.loadWallet();
        expect(wallet.ids['Bob'].owned.includes(did)).toEqual(true);
    });

    it('should throw an exception if user is not issuer', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);

        await keymaster.setCurrentId('Bob');

        try {
            await keymaster.issueCredential(boundCredential);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);

        const issued = await keymaster.listIssued();

        expect(issued).toStrictEqual([did]);
    });
});

describe('updateCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should update a valid verifiable credential', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);
        const vc = await keymaster.getCredential(did);

        const validUntilDate = new Date();
        validUntilDate.setHours(validUntilDate.getHours() + 24);
        vc.validUntil = validUntilDate.toISOString();
        const ok = await keymaster.updateCredential(did, vc);
        expect(ok).toBe(true);

        const updated = await keymaster.getCredential(did);
        expect(updated.validUntil).toBe(vc.validUntil);

        const doc = await keymaster.resolveDID(did);
        expect(doc.didDocumentMetadata.version).toBe(2);
    });

    it('should throw exception on invalid parameters', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);
        const vc = await keymaster.getCredential(did);

        try {
            await keymaster.updateCredential();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            // Pass agent DID instead of credential DID
            await keymaster.updateCredential(bob, vc);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            // Pass cipher DID instead of credential DID
            const cipherDID = await keymaster.encryptMessage('mock', bob);
            await keymaster.updateCredential(cipherDID, vc);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            // Pass cipher DID instead of credential DID
            const cipherDID = await keymaster.encryptJSON({ bob }, bob);
            await keymaster.updateCredential(cipherDID, vc);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.updateCredential(did);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.updateCredential(did, {});
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const vc2 = gatekeeper.copyJSON(vc);
            delete vc2.credential;
            await keymaster.updateCredential(did, vc2);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const vc2 = gatekeeper.copyJSON(vc);
            delete vc2.credentialSubject;
            await keymaster.updateCredential(did, vc2);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('revokeCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should revoke a valid verifiable credential', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
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
        const credentialDid = await keymaster.createSchema(mockSchema);
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

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.setCurrentId('Bob');
        await keymaster.removeId('Alice');

        try {
            await keymaster.revokeCredential(did);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
        }

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

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.setCurrentId('Bob');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(true);

        const wallet = await keymaster.loadWallet();
        expect(wallet.ids['Alice'].owned.includes(did));
        expect(wallet.ids['Bob'].held.includes(did));
    });

    it('should return false if user is not the credential subject', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Carol');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.setCurrentId('Carol');

        const ok = await keymaster.acceptCredential(did);
        expect(ok).toBe(false);
    });

    it('should return false if the verifiable credential is invalid', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Bob');

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
        expect(doc.didDocumentData).toStrictEqual({ challenge: {} });

        const now = new Date();
        const validUntil = new Date(doc.mdip.validUntil);
        const ttl = validUntil - now;

        expect(ttl < 60 * 60 * 1000).toBe(true);
    });

    it('should create an empty challenge with specified expiry', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const validUntil = '2025-01-01';
        const did = await keymaster.createChallenge({}, { validUntil });
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocument.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge: {} });
        expect(doc.mdip.validUntil).toBe(validUntil);
    });

    it('should create a valid challenge', async () => {
        mockFs({});

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

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocument.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge });
    });

    it('should throw an exception if challenge spec is invalid', async () => {
        mockFs({});

        await keymaster.createId('Alice');

        try {
            await keymaster.createChallenge([]);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.createChallenge({
                credentials: 123
            });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should throw an exception if validUntil is not a valid date', async () => {
        mockFs({});

        await keymaster.createId('Alice');

        try {
            const validUntil = 'mockDate';
            await keymaster.createChallenge({}, { validUntil });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('createResponse', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a valid response to a simple challenge', async () => {
        mockFs({});

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
        expect(wallet.ids['Alice'].owned.includes(vcDid));
        expect(wallet.ids['Bob'].held.includes(vcDid));

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
        const { response } = await keymaster.decryptJSON(responseDID);

        expect(response.challenge).toBe(challengeDID);
        expect(response.credentials.length).toBe(1);
        expect(response.credentials[0].vc).toBe(vcDid);
    });

    it('should throw an exception on invalid challenge', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.createResponse();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.createResponse('mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
        }

        try {
            await keymaster.createResponse('did:mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.createResponse('did:mock', { retries: 10, delay: 10 });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.createResponse(alice);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('verifyResponse', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should verify valid response to empty challenge', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');
        const challengeDID = await keymaster.createChallenge();

        await keymaster.setCurrentId('Bob');
        const responseDID = await keymaster.createResponse(challengeDID);

        await keymaster.setCurrentId('Alice');
        const verify = await keymaster.verifyResponse(responseDID);

        const expected = {
            challenge: challengeDID,
            credentials: [],
            requested: 0,
            fulfilled: 0,
            match: true,
            vps: [],
            responder: bob,
        };

        expect(verify).toStrictEqual(expected);
    });

    it('should verify a valid response to a single credential challenge', async () => {
        mockFs({});

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
        expect(verify1.vps.length).toBe(1);
    });

    it('should verify a valid response to a single credential challenge', async () => {
        mockFs({});

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

        const verify1 = await keymaster.verifyResponse(responseDID);

        expect(verify1.match).toBe(false);
        expect(verify1.challenge).toBe(challengeDID);
        expect(verify1.requested).toBe(1);
        expect(verify1.fulfilled).toBe(0);
        expect(verify1.vps.length).toBe(0);
    });

    it('should demonstrate full workflow with credential revocations', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice', { registry: 'local' });
        const bob = await keymaster.createId('Bob', { registry: 'local' });
        const carol = await keymaster.createId('Carol', { registry: 'local' });
        await keymaster.createId('Victor', 'local');

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
        const { response } = await keymaster.decryptJSON(responseDID);

        expect(response.challenge).toBe(challengeDID);
        expect(response.credentials.length).toBe(4);

        await keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(responseDID);
        expect(verify1.match).toBe(true);
        expect(verify1.vps.length).toBe(4);

        // All agents rotate keys
        await keymaster.setCurrentId('Alice');
        await keymaster.rotateKeys();

        await keymaster.setCurrentId('Bob');
        await keymaster.rotateKeys();

        await keymaster.setCurrentId('Carol');
        await keymaster.rotateKeys();

        await keymaster.setCurrentId('Victor');
        await keymaster.rotateKeys();

        const verify2 = await keymaster.verifyResponse(responseDID);
        expect(verify2.match).toBe(true);
        expect(verify2.vps.length).toBe(4);

        await keymaster.setCurrentId('Alice');
        await keymaster.revokeCredential(vc1);

        await keymaster.setCurrentId('Victor');
        const verify3 = await keymaster.verifyResponse(responseDID)
        expect(verify3.match).toBe(false);
        expect(verify3.vps.length).toBe(3);

        await keymaster.setCurrentId('Bob');
        await keymaster.revokeCredential(vc3);

        await keymaster.setCurrentId('Victor');
        const verify4 = await keymaster.verifyResponse(responseDID);
        expect(verify4.match).toBe(false);
        expect(verify4.vps.length).toBe(2);
    });

    it('should raise exception on invalid parameter', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.verifyResponse();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.verifyResponse(alice);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.verifyResponse('mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
        }

        try {
            await keymaster.verifyResponse('did:mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.verifyResponse('did:mock', { retries: 10, delay: 10 });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }
    });
});

describe('publishCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should reveal a valid credential', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.publishCredential(did, { reveal: true });

        const doc = await keymaster.resolveDID(bob);
        const vc = await keymaster.decryptJSON(did);
        const manifest = doc.didDocumentData.manifest;

        expect(manifest[did]).toStrictEqual(vc);
    });

    it('should publish a valid credential without revealing', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.publishCredential(did, { reveal: false });

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
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);
        await keymaster.publishCredential(did, { reveal: true });

        await keymaster.unpublishCredential(did);

        const doc = await keymaster.resolveDID(bob);
        const manifest = doc.didDocumentData.manifest;

        expect(manifest).toStrictEqual({});
    });

    it('should throw an exception when no current ID', async () => {
        mockFs({});

        try {
            await keymaster.unpublishCredential('mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.NO_CURRENT_ID);
        }
    });

    it('should throw an exception when credential invalid', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.unpublishCredential('did:test:mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should throw an exception when credential not found', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        try {
            await keymaster.unpublishCredential(did);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
            group: {
                name: groupName,
                members: [],
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expectedGroup);
    });

    it('should create a new group with members', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName, { members: [ownerDid] });
        const doc = await keymaster.resolveDID(groupDid);

        expect(doc.didDocument.id).toBe(groupDid);
        expect(doc.didDocument.controller).toBe(ownerDid);

        const expectedGroup = {
            group: {
                name: groupName,
                members: [ownerDid],
            }
        };

        expect(doc.didDocumentData).toStrictEqual(expectedGroup);
    });
});

describe('addGroupMember', () => {

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

        const ok = await keymaster.addGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const data = await keymaster.getGroup(groupDid);
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
        await keymaster.addName(alias, dataDid);
        const ok = await keymaster.addGroupMember(groupDid, alias);
        expect(ok).toBe(true);

        const data = await keymaster.getGroup(groupDid);
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
            await keymaster.addGroupMember(groupDid, 'mockAlias');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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
        await keymaster.addName(alias, groupDid);
        const ok = await keymaster.addGroupMember(alias, dataDid);
        expect(ok).toBe(true);

        const data = await keymaster.getGroup(groupDid);
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
            await keymaster.addGroupMember('mockAlias', dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
        }
    });

    it('should add a member to the group only once', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.addGroupMember(groupDid, dataDid);
        await keymaster.addGroupMember(groupDid, dataDid);
        await keymaster.addGroupMember(groupDid, dataDid);

        const ok = await keymaster.addGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [dataDid],
        };

        expect(group).toStrictEqual(expectedGroup);
    });

    it('should not increment version when adding a member a 2nd time', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.addGroupMember(groupDid, dataDid);
        const dox1 = await keymaster.resolveDID(groupDid);
        const version1 = dox1.didDocumentMetadata.version;

        await keymaster.addGroupMember(groupDid, dataDid);
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
            await keymaster.addGroupMember(groupDid, dataDid);
        }

        const group = await keymaster.getGroup(groupDid);

        expect(group.members.length).toBe(memberCount);
    });

    it('should not add a non-DID to the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            await keymaster.addGroupMember(groupDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember(groupDid, 100);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember(groupDid, [1, 2, 3]);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember(groupDid, { name: 'mock' });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember(groupDid, 'did:mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }
    });

    it('should not add a member to a non-group', async () => {
        mockFs({});

        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.addGroupMember(null, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember(100, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember([1, 2, 3], dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember({ name: 'mock' }, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.addGroupMember(agentDid, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.addGroupMember(dataDid, agentDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should not add a group to itself', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupDid = await keymaster.createGroup('group');

        try {
            await keymaster.addGroupMember(groupDid, groupDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should not add a member that contains group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const group1Did = await keymaster.createGroup('group-1');
        const group2Did = await keymaster.createGroup('group-2');
        const group3Did = await keymaster.createGroup('group-3');

        await keymaster.addGroupMember(group1Did, group2Did);
        await keymaster.addGroupMember(group2Did, group3Did);

        try {
            await keymaster.addGroupMember(group3Did, group1Did);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('removeGroupMember', () => {

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
        await keymaster.addGroupMember(groupDid, dataDid);

        const ok = await keymaster.removeGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(group).toStrictEqual(expectedGroup);
    });

    it('should remove a DID alias from a group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.addGroupMember(groupDid, dataDid);

        const alias = 'mockAlias';
        await keymaster.addName(alias, dataDid);

        const ok = await keymaster.removeGroupMember(groupDid, alias);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(group).toStrictEqual(expectedGroup);
    });

    it('should be OK to remove a DID that is not in the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const ok = await keymaster.removeGroupMember(groupDid, dataDid);
        expect(ok).toBe(true);

        const group = await keymaster.getGroup(groupDid);

        const expectedGroup = {
            name: groupName,
            members: [],
        };

        expect(group).toStrictEqual(expectedGroup);
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
        await keymaster.removeGroupMember(groupDid, dataDid);
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
            await keymaster.removeGroupMember(groupDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember(groupDid, 100);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember(groupDid, [1, 2, 3]);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember(groupDid, { name: 'mock' });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember(groupDid, 'did:mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }
    });

    it('should not remove a member from a non-group', async () => {
        mockFs({});

        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.removeGroupMember();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember(null, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember(100, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember([1, 2, 3], dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember({ name: 'mock' }, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }

        try {
            await keymaster.removeGroupMember(agentDid, dataDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            await keymaster.removeGroupMember(dataDid, agentDid);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('testGroup', () => {

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
        await keymaster.addGroupMember(groupDid, dataDid);

        const test = await keymaster.testGroup(groupDid, dataDid);

        expect(test).toBe(true);
    });

    it('should return false when member not in group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const test = await keymaster.testGroup(groupDid, dataDid);

        expect(test).toBe(false);
    });

    it('should return true when testing group only', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        const test = await keymaster.testGroup(groupDid);

        expect(test).toBe(true);
    });

    it('should return false when testing non-group only', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const test = await keymaster.testGroup(dataDid);

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

        await keymaster.addGroupMember(group1Did, group2Did);
        await keymaster.addGroupMember(group2Did, group3Did);
        await keymaster.addGroupMember(group3Did, group4Did);
        await keymaster.addGroupMember(group4Did, group5Did);

        const test1 = await keymaster.testGroup(group1Did, group2Did);
        expect(test1).toBe(true);

        const test2 = await keymaster.testGroup(group1Did, group3Did);
        expect(test2).toBe(true);

        const test3 = await keymaster.testGroup(group1Did, group4Did);
        expect(test3).toBe(true);

        const test4 = await keymaster.testGroup(group1Did, group5Did);
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
        const groupDid = await keymaster.createGroup(groupName);

        const group = await keymaster.getGroup(groupDid);

        expect(group.name).toBe(groupName);
        expect(group.members).toStrictEqual([]);
    });

    it('should return old style group (TEMP during did:test)', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const oldGroup = {
            name: 'mock',
            members: [],
        };
        const groupDid = await keymaster.createAsset(oldGroup);

        const group = await keymaster.getGroup(groupDid);

        expect(group).toStrictEqual(oldGroup);
    });

    it('should return null if non-group DID specified', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Bob');
        const group = await keymaster.getGroup(agentDID);

        expect(group).toBe(null);
    });

    it('should raise an exception if no DID specified', async () => {
        mockFs({});

        try {
            await keymaster.getGroup();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }
    });
});

describe('listGroups', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of schemas', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const group1 = await keymaster.createGroup('mock-1');
        const group2 = await keymaster.createGroup('mock-2');
        const group3 = await keymaster.createGroup('mock-3');
        const schema1 = await keymaster.createSchema();
        // add a bogus DID to trigger the exception case
        await keymaster.addToOwned('did:test:mock');

        const groups = await keymaster.listGroups();

        expect(groups.includes(group1)).toBe(true);
        expect(groups.includes(group2)).toBe(true);
        expect(groups.includes(group3)).toBe(true);
        expect(groups.includes(schema1)).toBe(false);
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
        const asset = await keymaster.resolveAsset(did);

        expect(asset.poll).toStrictEqual(template);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.version = 0;
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.description;
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.roster;
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.options;
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = ['one option'];
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = "not a list";
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.deadline;
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.deadline = "not a date";
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));

            const now = new Date();
            const lastWeek = new Date();
            lastWeek.setDate(now.getDate() - 7);

            poll.deadline = lastWeek.toISOString();
            await keymaster.createPoll(poll);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('getPoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return the specified poll', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createPoll(template);
        const poll = await keymaster.getPoll(did);

        expect(poll).toStrictEqual(template);
    });

    it('should return old style poll (TEMP during did:test)', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const did = await keymaster.createAsset(template);
        const poll = await keymaster.getPoll(did);

        expect(poll).toStrictEqual(template);
    });

    it('should return null if non-poll DID specified', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Bob');
        const group = await keymaster.getPoll(agentDID);

        expect(group).toBe(null);
    });

    it('should raise an exception if no poll DID specified', async () => {
        mockFs({});

        try {
            await keymaster.getPoll();
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
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
        await keymaster.addGroupMember(rosterDid, bobDid);
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
        await keymaster.addGroupMember(rosterDid, bobDid);
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
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.votePoll(pollDid, 5);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);

        const ok = await keymaster.updatePoll(ballotDid);
        const poll = await keymaster.getPoll(pollDid);

        expect(ok).toBe(true);
        expect(poll.ballots[bobDid].ballot).toBe(ballotDid);
    });

    it('should reject non-ballots', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.updatePoll(pollDid)
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        }
        catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        const ok = await keymaster.publishPoll(pollDid);

        const poll = await keymaster.getPoll(pollDid);

        expect(ok).toBe(true);
        expect(poll.results.final).toBe(true);
        expect(poll.results.votes.eligible).toBe(1);
        expect(poll.results.votes.pending).toBe(0);
        expect(poll.results.votes.received).toBe(1);
        expect(poll.results.tally.length).toBe(4);
        expect(poll.results.tally[0]).toStrictEqual({
            vote: 0,
            option: 'spoil',
            count: 0,
        });
        expect(poll.results.tally[1]).toStrictEqual({
            vote: 1,
            option: 'yes',
            count: 1,
        });
        expect(poll.results.tally[2]).toStrictEqual({
            vote: 2,
            option: 'no',
            count: 0,
        });
        expect(poll.results.tally[3]).toStrictEqual({
            vote: 3,
            option: 'abstain',
            count: 0,
        });
    });

    it('should reveal results to poll', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        const ok = await keymaster.publishPoll(pollDid, { reveal: true });
        const poll = await keymaster.getPoll(pollDid);

        expect(ok).toBe(true);
        expect(poll.results.ballots.length).toBe(1);
        expect(poll.results.ballots[0]).toStrictEqual({
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
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();
        template.roster = rosterDid;
        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1);
        await keymaster.updatePoll(ballotDid);
        await keymaster.publishPoll(pollDid);
        const ok = await keymaster.unpublishPoll(pollDid);

        const poll = await keymaster.getPoll(pollDid);

        expect(ok).toBe(true);
        expect(poll.results).toBe(undefined);
    });
});

describe('createSchema', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a credential from a schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const did = await keymaster.createSchema(mockSchema);
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocumentData.schema).toStrictEqual(mockSchema);
    });

    it('should create a default schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocumentData.schema).toStrictEqual(keymaster.defaultSchema);
    });

    it('should create a simple schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema(mockSchema);
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocumentData.schema).toStrictEqual(mockSchema);
    });

    it('should throw an exception on create invalid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.createSchema({ mock: 'not a schema' });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });

    it('should throw an exception on schema missing properties', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.createSchema({ "$schema": "http://json-schema.org/draft-07/schema#" });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
        }
    });
});

describe('listSchemas', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of schemas', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const schema1 = await keymaster.createSchema();
        const schema2 = await keymaster.createSchema();
        const schema3 = await keymaster.createSchema();
        const group1 = await keymaster.createGroup('mockGroup');

        const schemas = await keymaster.listSchemas();

        expect(schemas.includes(schema1)).toBe(true);
        expect(schemas.includes(schema2)).toBe(true);
        expect(schemas.includes(schema3)).toBe(true);
        expect(schemas.includes(group1)).toBe(false);
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

    it('should return the old style schema (TEMP during did:test)', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createAsset(mockSchema);
        const schema = await keymaster.getSchema(did);

        expect(schema).toStrictEqual(mockSchema);
    });

    it('should throw an exception on get invalid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.getSchema('bogus');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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

    it('should throw an exception on set invalid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();

        try {
            await keymaster.setSchema(did, { mock: 'not a schema' });
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
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
        expect(registries.includes('TFTC')).toBe(true);
    });
});

async function setupCredentials() {
    await keymaster.createId('Alice');
    await keymaster.createId('Bob');
    const carol = await keymaster.createId('Carol');
    await keymaster.createId('Victor');

    await keymaster.setCurrentId('Alice');

    const credential1 = await keymaster.createSchema(mockSchema);
    const credential2 = await keymaster.createSchema(mockSchema);

    const bc1 = await keymaster.bindCredential(credential1, carol);
    const bc2 = await keymaster.bindCredential(credential2, carol);

    const vc1 = await keymaster.issueCredential(bc1);
    const vc2 = await keymaster.issueCredential(bc2);

    await keymaster.setCurrentId('Bob');

    const credential3 = await keymaster.createSchema(mockSchema);
    const credential4 = await keymaster.createSchema(mockSchema);

    const bc3 = await keymaster.bindCredential(credential3, carol);
    const bc4 = await keymaster.bindCredential(credential4, carol);

    const vc3 = await keymaster.issueCredential(bc3);
    const vc4 = await keymaster.issueCredential(bc4);

    await keymaster.setCurrentId('Carol');

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

    it('should detect removed DIDs', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Alice');
        const schemaDID = await keymaster.createSchema();
        await keymaster.addName('schema', schemaDID);
        await gatekeeper.removeDIDs([agentDID, schemaDID]);

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(3);
        expect(invalid).toBe(3);
        expect(deleted).toBe(0);
    });

    it('should detect invalid DIDs', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.addToOwned('did:test:mock1');
        await keymaster.addToHeld('did:test:mock2');

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(3);
        expect(invalid).toBe(2);
        expect(deleted).toBe(0);
    });

    it('should detect revoked credentials in wallet', async () => {
        mockFs({});

        const credentials = await setupCredentials();
        await keymaster.addName('credential-0', credentials[0]);
        await keymaster.addName('credential-2', credentials[2]);
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

    it('should remove deleted DIDs', async () => {
        mockFs({});

        const agentDID = await keymaster.createId('Alice');
        const schemaDID = await keymaster.createSchema();
        await keymaster.addName('schema', schemaDID);
        await gatekeeper.removeDIDs([agentDID, schemaDID]);

        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(1);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(1);
    });

    it('should remove invalid DIDs', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.addToOwned('did:test:mock1');
        await keymaster.addToHeld('did:test:mock2');

        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(0);
        expect(ownedRemoved).toBe(1);
        expect(heldRemoved).toBe(1);
        expect(namesRemoved).toBe(0);
    });

    it('should remove revoked credentials', async () => {
        mockFs({});

        const credentials = await setupCredentials();
        await keymaster.addName('credential-0', credentials[0]);
        await keymaster.addName('credential-2', credentials[2]);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
        }
    });

    it('raises an exception if DID specified that is not a credential', async () => {
        mockFs({});

        try {
            const agentDID = await keymaster.createId('Rando');
            await keymaster.getCredential(agentDID);
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_PARAMETER);
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
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.INVALID_DID);
        }
    });

    it('raises an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.removeCredential('mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
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

        const ids = await keymaster.listIds();

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

        const current = await keymaster.getCurrentId();

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

        await keymaster.setCurrentId('Carol');
        const current = await keymaster.getCurrentId();

        expect(current).toBe('Carol');
    });

    it('should throw an exception on invalid ID', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        try {
            await keymaster.setCurrentId('mock');
            throw new Error(exceptions.EXPECTED_EXCEPTION);
        } catch (error) {
            expect(error.message).toBe(exceptions.UNKNOWN_ID);
        }
    });
});
