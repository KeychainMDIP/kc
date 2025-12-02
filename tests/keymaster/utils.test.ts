import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError, UnknownIDError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { MdipDocument } from "@mdip/gatekeeper/types";

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;

const PASSPHRASE = 'passphrase';

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
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
});

describe('constructor', () => {
    it('should throw exception on invalid parameters', async () => {
        try {
            // @ts-expect-error Testing invalid usage, missing args
            new Keymaster();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: options.gatekeeper');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing gatekeeper arg
            new Keymaster({ wallet, cipher, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.gatekeeper');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing wallet arg
            new Keymaster({ gatekeeper, cipher, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.wallet');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing cipher arg
            new Keymaster({ gatekeeper, wallet, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.cipher');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid gatekeeper arg
            new Keymaster({ gatekeeper: {}, wallet, cipher, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.gatekeeper');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid wallet arg
            new Keymaster({ gatekeeper, wallet: {}, cipher, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.wallet');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid cipher arg
            new Keymaster({ gatekeeper, wallet, cipher: {}, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.cipher');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid search arg
            new Keymaster({ gatekeeper, wallet, cipher, search: {}, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.search');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing passphrase arg
            new Keymaster({ gatekeeper, wallet, cipher });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.passphrase');
        }

        // Cover the ExpectedExceptionError class for completeness
        try {
            new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Expected to throw an exception');
        }
    });
});

describe('resolveDID', () => {
    it('should resolve a new ID', async () => {
        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
    });
});

describe('resolveDID', () => {
    it('should resolve a valid id name', async () => {
        const did = await keymaster.createId('Bob');
        const doc = await keymaster.resolveDID('Bob');

        expect(doc.didDocument!.id).toBe(did);
    });

    it('should resolve a valid asset name', async () => {
        await keymaster.createId('Bob');

        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        await keymaster.addName('mock', dataDid);

        const doc1 = await keymaster.resolveDID(dataDid);
        const doc2 = await keymaster.resolveDID('mock');

        expect(doc1).toStrictEqual(doc2);
    });

    it('should throw an exception for invalid name', async () => {
        try {
            await keymaster.resolveDID('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('updateDID', () => {
    it('should throw if doc missing id', async () => {
        const doc: MdipDocument = {};

        try {
            await keymaster.updateDID(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toContain('doc.didDocument.id');
        }
    });

    it('should update an asset DID', async () => {
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
        expect(doc2.didDocumentMetadata!.version).toBe("2");
    });

    it('should not update an asset DID if no changes', async () => {
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor', val: 1234 };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        // Changing the order should be ignored
        doc.didDocumentData = { val: 1234, name: 'mockAnchor' };
        const ok = await keymaster.updateDID(doc);
        const doc2 = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc2.didDocumentData).toStrictEqual(mockAnchor);
        expect(doc2.didDocumentMetadata!.version).toBe("1");
    });

    it('should update an asset DID when owner ID is in the wallet', async () => {
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
        expect(doc2.didDocument!.controller).toBe(bob);
        expect(doc2.didDocumentData).toStrictEqual(dataUpdated);
        expect(doc2.didDocumentMetadata!.version).toBe("2");
    });

    it('should not update an asset DID when owner ID is not in the wallet', async () => {
        await keymaster.createId('Bob');
        await keymaster.createId('Alice');
        await keymaster.setCurrentId('Bob');

        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        const dataUpdated = { name: 'updated' };
        doc.didDocumentData = dataUpdated;

        await keymaster.setCurrentId('Alice');
        await keymaster.removeId('Bob');

        try {
            await keymaster.updateDID(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Unknown ID');
        }
    });
});

describe('revokeDID', () => {
    it('should revoke an asset DID', async () => {
        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        const ok = await keymaster.revokeDID(dataDid);
        const doc = await keymaster.resolveDID(dataDid);

        expect(ok).toBe(true);
        expect(doc.didDocument).toStrictEqual({});
        expect(doc.didDocumentData).toStrictEqual({});
        expect(doc.didDocumentMetadata!.deactivated).toBe(true);
    });

    it('should revoke an asset DID when current ID is not owner ID', async () => {
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
        expect(doc.didDocumentMetadata!.deactivated).toBe(true);
    });
});

describe('removeFromOwned', () => {
    it('should return false if nothing owned', async () => {
        const owner = await keymaster.createId('Alice');
        const ok = await keymaster.removeFromOwned("did:mock", owner);

        expect(ok).toBe(false);
    });
});

describe('rotateKeys', () => {
    it('should update DID doc with new keys', async () => {
        const alice = await keymaster.createId('Alice', { registry: 'local' });
        let doc = await keymaster.resolveDID(alice);
        let vm = doc.didDocument!.verificationMethod![0];
        let pubkey = vm.publicKeyJwk!;

        for (let i = 0; i < 3; i++) {
            await keymaster.rotateKeys();

            doc = await keymaster.resolveDID(alice);
            vm = doc.didDocument!.verificationMethod![0];

            expect(pubkey.x !== vm.publicKeyJwk!.x).toBe(true);
            expect(pubkey.y !== vm.publicKeyJwk!.y).toBe(true);

            pubkey = vm.publicKeyJwk!;
        }
    });

    it('should decrypt messages encrypted with rotating keys', async () => {
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
        await keymaster.createId('Alice', { registry: 'TFTC' });
        await keymaster.rotateKeys();

        try {
            await keymaster.rotateKeys();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Keymaster: Cannot rotate keys');
        }
    });
});

describe('getPublicKeyJwk', () => {
    it('should return the public key from an MDIP document', async () => {
        const bob = await keymaster.createId('Bob');
        const doc = await keymaster.resolveDID(bob);
        const publicKeyJwk = keymaster.getPublicKeyJwk(doc);

        expect(publicKeyJwk).toStrictEqual(doc.didDocument!.verificationMethod![0].publicKeyJwk!);
    });

    it('should throw exception when not an agent doc', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createAsset({ name: 'mockAnchor' });
        const doc = await keymaster.resolveDID(did);

        try {
            keymaster.getPublicKeyJwk(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.detail).toBe('The DID document does not contain any verification methods.');
        }
    });

    it('should throw exception when didDocument missing', async () => {
        const bob = await keymaster.createId('Bob');
        const doc = await keymaster.resolveDID(bob);

        try {
            delete doc.didDocument;
            keymaster.getPublicKeyJwk(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.detail).toBe('Missing didDocument.');
        }
    });

    it('should throw exception when key is missing', async () => {
        const bob = await keymaster.createId('Bob');
        const doc = await keymaster.resolveDID(bob);

        try {
            delete doc.didDocument!.verificationMethod![0].publicKeyJwk;
            keymaster.getPublicKeyJwk(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.detail).toBe('The publicKeyJwk is missing in the first verification method.');
        }
    });
});

describe('getAgentDID', () => {
    it('should return the DID from an MDIP document', async () => {
        const bob = await keymaster.createId('Bob');
        const doc = await keymaster.resolveDID(bob);
        const did = keymaster.getAgentDID(doc);

        expect(did).toBe(bob);
    });

    it('should throw exception when not an agent doc', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createAsset({ name: 'mockAnchor' });
        const doc = await keymaster.resolveDID(did);

        try {
            keymaster.getAgentDID(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.detail).toBe('Document is not an agent');
        }
    });

    it('should throw exception when didDocument missing', async () => {
        const bob = await keymaster.createId('Bob');
        const doc = await keymaster.resolveDID(bob);

        try {
            delete doc.didDocument;
            keymaster.getAgentDID(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.detail).toBe('Agent document does not have a DID');
        }
    });
});

describe('listRegistries', () => {
    it('should return list of valid registries', async () => {
        const registries = await keymaster.listRegistries();

        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
        expect(registries.includes('TFTC')).toBe(true);
    });
});
