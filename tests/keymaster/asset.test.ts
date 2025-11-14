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
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
});

describe('createAsset', () => {
    it('should create DID from an object anchor', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID from a string anchor', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = "mockAnchor";
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID from a list anchor', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = [1, 2, 3];
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID for a different valid ID', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = "mockAnchor";

        await keymaster.createId('Alice');

        const dataDid = await keymaster.createAsset(mockAnchor, { registry: 'hyperswarm', controller: 'Bob' });
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create asset with specified name', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const mockName = 'mockName'
        const dataDid = await keymaster.createAsset(mockAnchor, { name: mockName });
        const doc = await keymaster.resolveDID(mockName);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should throw an exception if no ID selected', async () => {
        try {
            const mockAnchor = { name: 'mockAnchor' };
            await keymaster.createAsset(mockAnchor);
            throw new ExpectedExceptionError();
        } catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Keymaster: No current ID');
        }
    });

    it('should throw an exception for an empty string anchor', async () => {
        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset({}, { name: 'Bob' });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name already used');
        }
    });

    it('should throw an exception for an invalid name', async () => {
        try {
            await keymaster.createId('Bob');
            await keymaster.createAsset("");
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: data');
        }
    });
});

describe('cloneAsset', () => {
    it('should clone an asset DID', async () => {
        const ownerDid = await keymaster.createId('Bob');
        const mockData = { name: 'mockData' };
        const assetDid = await keymaster.createAsset(mockData);
        const cloneDid = await keymaster.cloneAsset(assetDid);
        const doc = await keymaster.resolveDID(cloneDid);

        expect(assetDid).not.toBe(cloneDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expectedData = {
            ...mockData,
            cloned: assetDid,
        };

        expect(doc.didDocumentData).toStrictEqual(expectedData);
    });

    it('should clone an asset name', async () => {
        await keymaster.createId('Bob');
        const mockData = { name: 'mockData' };
        const assetDid = await keymaster.createAsset(mockData);
        await keymaster.addName('asset', assetDid);
        const cloneDid = await keymaster.cloneAsset('asset');
        const doc = await keymaster.resolveDID(cloneDid);

        const expectedData = {
            ...mockData,
            cloned: assetDid,
        };

        expect(doc.didDocumentData).toStrictEqual(expectedData);
    });

    it('should clone an empty asset', async () => {
        await keymaster.createId('Bob');
        const assetDid = await keymaster.createAsset({});
        await keymaster.addName('asset', assetDid);
        const cloneDid = await keymaster.cloneAsset('asset');
        const doc = await keymaster.resolveDID(cloneDid);

        const expectedData = {
            cloned: assetDid,
        };

        expect(doc.didDocumentData).toStrictEqual(expectedData);
    });

    it('should clone a clone', async () => {
        await keymaster.createId('Bob');
        const mockData = { name: 'mockData' };
        const assetDid = await keymaster.createAsset(mockData);
        const cloneDid1 = await keymaster.cloneAsset(assetDid);
        const cloneDid2 = await keymaster.cloneAsset(cloneDid1);
        const doc = await keymaster.resolveDID(cloneDid2);

        const expectedData = {
            ...mockData,
            cloned: cloneDid1,
        };

        expect(doc.didDocumentData).toStrictEqual(expectedData);
    });

    it('should throw an exception if invalid asset provided', async () => {
        try {
            const bob = await keymaster.createId('Bob');
            await keymaster.cloneAsset(bob);
            throw new ExpectedExceptionError();
        } catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: id');
        }
    });
});

describe('transferAsset', () => {
    it('should transfer an asset DID to an agent DID', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const ok = await keymaster.transferAsset(dataDid, alice);
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument!.controller).toBe(alice);

        const assetsAlice = await keymaster.listAssets('Alice');
        const assetsBob = await keymaster.listAssets('Bob');

        expect(assetsAlice).toStrictEqual([dataDid]);
        expect(assetsBob).toStrictEqual([]);
    });

    it('should transfer an asset name to an agent name', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.addName('asset', dataDid);

        const ok = await keymaster.transferAsset('asset', 'Alice');
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument!.controller).toBe(alice);

        const assetsAlice = await keymaster.listAssets('Alice');
        const assetsBob = await keymaster.listAssets('Bob');

        expect(assetsAlice).toStrictEqual([dataDid]);
        expect(assetsBob).toStrictEqual([]);
    });

    it('should not update if controller does not change', async () => {
        const bob = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const ok = await keymaster.transferAsset(dataDid, bob);
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument!.controller).toBe(bob);
        expect(doc.didDocumentMetadata!.version).toBe(1);
    });

    it('should throw an exception on invalid did', async () => {
        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.transferAsset('mockDID', bob);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Unknown ID');
        }
    });

    it('should throw if did is an agent', async () => {
        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.transferAsset(bob, bob);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: id');
        }
    });

    it('should throw an exception on invalid controller', async () => {
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.transferAsset(dataDid, dataDid);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: controller');
        }
    });

    it('should throw an exception if asset not owned by this wallet', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            await keymaster.removeId(bob);
            await keymaster.transferAsset(dataDid, alice);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Unknown ID');
        }
    });
});

describe('listAssets', () => {
    it('should return empty list when no assets', async () => {
        await keymaster.createId('Bob');
        const assets = await keymaster.listAssets();

        expect(assets).toStrictEqual([]);
    });

    it('should return assets owned by current ID', async () => {
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const assets = await keymaster.listAssets();

        expect(assets).toStrictEqual([dataDid]);
    });

    it('should return assets owned by specified ID', async () => {
        await keymaster.createId('Alice');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.createId('Bob');
        const assetsBob = await keymaster.listAssets();
        const assetsAlice = await keymaster.listAssets('Alice');

        expect(assetsBob).toStrictEqual([]);
        expect(assetsAlice).toStrictEqual([dataDid]);
    });

    it('should not include ephemeral assets', async () => {
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const validUntil = new Date();
        validUntil.setMinutes(validUntil.getMinutes() + 1);
        await keymaster.createAsset(mockAnchor, { validUntil: validUntil.toISOString() });
        const assets = await keymaster.listAssets();

        expect(assets).toStrictEqual([]);
    });
});

describe('resolveAsset', () => {
    it('should resolve a new asset', async () => {
        await keymaster.createId('Bob');
        const mockAsset = { name: 'mockAnchor' };
        const did = await keymaster.createAsset(mockAsset);
        const asset = await keymaster.resolveAsset(did);

        expect(asset).toStrictEqual(mockAsset);
    });

    it('should return empty asset on invalid DID', async () => {
        const agentDID = await keymaster.createId('Bob');
        const asset = await keymaster.resolveAsset(agentDID);

        expect(asset).toStrictEqual({});
    });

    it('should return empty asset when revoked', async () => {
        await keymaster.createId('Bob');
        const mockAsset = { name: 'mockAnchor' };
        const did = await keymaster.createAsset(mockAsset);
        await keymaster.revokeDID(did);

        const asset = await keymaster.resolveAsset(did);

        expect(asset).toStrictEqual({});
    });
});

describe('updateAsset', () => {
    it('should update an asset', async () => {
        await keymaster.createId('Bob');
        const mockAsset1 = { name: 'original' };
        const mockAsset2 = { name: 'updated' };
        const did = await keymaster.createAsset(mockAsset1);
        const ok = await keymaster.updateAsset(did, mockAsset2);
        const asset = await keymaster.resolveAsset(did);

        expect(ok).toBe(true);
        expect(asset).toStrictEqual(mockAsset2);
    });

    it('should update an asset with merged data', async () => {
        await keymaster.createId('Bob');
        const mockAsset1 = { key1: 'val1' };
        const mockAsset2 = { key2: 'val2' };
        const did = await keymaster.createAsset(mockAsset1);
        const ok = await keymaster.updateAsset(did, mockAsset2);
        const asset = await keymaster.resolveAsset(did);

        expect(ok).toBe(true);
        expect(asset).toStrictEqual({ key1: 'val1', key2: 'val2' });
    });

    it('should remove a property when updated to be undefined ', async () => {
        await keymaster.createId('Bob');
        const mockAsset1 = { key1: 'val1', key2: 'val2' };
        const mockAsset2 = { key2: undefined };
        const did = await keymaster.createAsset(mockAsset1);
        const ok = await keymaster.updateAsset(did, mockAsset2);
        const asset = await keymaster.resolveAsset(did);

        expect(ok).toBe(true);
        expect(asset).toStrictEqual({ key1: 'val1' });
    });
});
