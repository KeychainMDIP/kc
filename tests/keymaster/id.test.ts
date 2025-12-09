import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { InvalidDIDError, ExpectedExceptionError, UnknownIDError, InvalidParameterError } from '@mdip/common/errors';
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

describe('createId', () => {
    it('should create a new ID', async () => {
        const name = 'Bob';
        const did = await keymaster.createId(name);
        const wallet = await keymaster.loadWallet();

        expect(wallet.ids[name].did).toBe(did);
        expect(wallet.current).toBe(name);
    });

    it('should create a new ID with a Unicode name', async () => {
        const name = 'ҽ× ʍɑϲհíղɑ';
        const did = await keymaster.createId(name);
        const wallet = await keymaster.loadWallet();

        expect(wallet.ids[name].did).toBe(did);
        expect(wallet.current).toBe(name);
    });

    it('should create a new ID on default registry', async () => {
        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveDID(did);

        expect(doc.mdip!.registry).toBe('hyperswarm');
    });

    it('should create a new ID on customized default registry', async () => {
        const defaultRegistry = 'TFTC';
        const keymaster = new Keymaster({ gatekeeper, wallet, cipher, defaultRegistry, passphrase: 'passphrase' });

        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveDID(did);

        expect(doc.mdip!.registry).toBe(defaultRegistry);
    });

    it('should throw to create a second ID with the same name', async () => {
        const name = 'Bob';
        await keymaster.createId(name);

        try {
            await keymaster.createId(name);
            throw new ExpectedExceptionError();
        } catch (error: any) {            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: name already used');
        }
    });

    it('should create a second ID with a different name', async () => {
        const name1 = 'Bob';
        const did1 = await keymaster.createId(name1);

        const name2 = 'Alice';
        const did2 = await keymaster.createId(name2);

        const wallet = await keymaster.loadWallet();

        expect(wallet.ids[name1].did).toBe(did1);
        expect(wallet.ids[name2].did).toBe(did2);
        expect(wallet.current).toBe(name2);
    });

    it('should not create an ID with an empty name', async () => {
        // eslint-disable-next-line
        const expectedError = 'Invalid parameter: name must be a non-empty string';

        try {
            await keymaster.createId('');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            await keymaster.createId('    ');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, incorrect argument
            await keymaster.createId(undefined);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, incorrect argument
            await keymaster.createId(0);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, incorrect argument
            await keymaster.createId({});
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }
    });

    it('should not create an ID with a name that is too long', async () => {
        try {
            await keymaster.createId('1234567890123456789012345678901234567890');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name too long');
        }
    });

    it('should not create an ID with a name that contains unprintable characters', async () => {
        try {
            await keymaster.createId('hello\nworld!');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name contains unprintable characters');
        }
    });
});

describe('createIdOperation', () => {
    it('should create a valid operation for new ID', async () => {
        const name = 'Bob';
        const operation = await keymaster.createIdOperation(name);
        
        expect(operation.type).toBe('create');
        expect(operation.created).toBeDefined();
        expect(operation.mdip).toBeDefined();
        expect(operation.mdip!.version).toBe(1);
        expect(operation.mdip!.type).toBe('agent');
        expect(operation.mdip!.registry).toBe('hyperswarm'); // Default registry
        expect(operation.publicJwk).toBeDefined();
        expect(operation.signature).toBeDefined();
        expect(operation.signature!.signed).toBeDefined();
        expect(operation.signature!.hash).toBeDefined();
        expect(operation.signature!.value).toBeDefined();
    });

    it('should create operation with custom registry', async () => {
        const name = 'Alice';
        const registry = 'TFTC';
        const operation = await keymaster.createIdOperation(name, { registry });
        
        expect(operation.mdip!.registry).toBe(registry);
        expect(operation.type).toBe('create');
        expect(operation.publicJwk).toBeDefined();
        expect(operation.signature).toBeDefined();
    });

    it('should create operation with local registry', async () => {
        const name = 'Charlie';
        const registry = 'local';
        const operation = await keymaster.createIdOperation(name, { registry });
        
        expect(operation.mdip!.registry).toBe(registry);
        expect(operation.type).toBe('create');
        expect(operation.publicJwk).toBeDefined();
        expect(operation.signature).toBeDefined();
    });

    it('should create operation without modifying wallet', async () => {
        const name = 'Dave';
        const walletBefore = await keymaster.loadWallet();
        const counterBefore = walletBefore.counter;
        
        await keymaster.createIdOperation(name);
        
        const walletAfter = await keymaster.loadWallet();
        expect(walletAfter.counter).toBe(counterBefore);
        expect(walletAfter.ids[name]).toBeUndefined();
        expect(walletAfter.current).toBe(walletBefore.current);
    });

    it('should throw error for duplicate name', async () => {
        const name = 'Eve';
        await keymaster.createId(name);
        
        try {
            await keymaster.createIdOperation(name);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name already used');
        }
    });

    it('should throw error for empty name', async () => {
        try {
            await keymaster.createIdOperation('');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name must be a non-empty string');
        }
    });

    it('should throw error for whitespace-only name', async () => {
        try {
            await keymaster.createIdOperation('   ');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name must be a non-empty string');
        }
    });

    it('should create valid signature that can be verified', async () => {
        const name = 'Frank';
        const operation = await keymaster.createIdOperation(name);
        
        // Verify that the signature matches the operation
        const msgHash = cipher.hashJSON({
            type: operation.type,
            created: operation.created,
            mdip: operation.mdip,
            publicJwk: operation.publicJwk
        });
        
        expect(operation.signature!.hash).toBe(msgHash);
        
        // Verify signature can be validated
        const publicKey = operation.publicJwk!;
        const isValid = cipher.verifySig(msgHash, operation.signature!.value, publicKey);
        expect(isValid).toBe(true);
    });

    it('should create operation that can be used to create actual DID', async () => {
        const name = 'Grace';
        const operation = await keymaster.createIdOperation(name);
        
        // Use the operation to create an actual DID
        const did = await gatekeeper.createDID(operation);
        
        expect(did).toBeDefined();
        expect(did.startsWith('did:test:')).toBe(true);
        
        // Verify the created DID resolves correctly
        const doc = await keymaster.resolveDID(did);
        expect(doc.didDocument!.id).toBe(did);
        expect(doc.mdip!.type).toBe('agent');
        expect(doc.mdip!.registry).toBe('hyperswarm');
    });

    it('should use customized default registry when none specified', async () => {
        const defaultRegistry = 'local';
        const customKeymaster = new Keymaster({ 
            gatekeeper, 
            wallet, 
            cipher, 
            defaultRegistry, 
            passphrase: 'passphrase' 
        });

        const name = 'Henry';
        const operation = await customKeymaster.createIdOperation(name);

        expect(operation.mdip!.registry).toBe(defaultRegistry);
    });
});

describe('removeId', () => {
    it('should remove an existing ID', async () => {
        const name = 'Bob';
        await keymaster.createId(name);

        await keymaster.removeId(name);

        const wallet = await keymaster.loadWallet();

        expect(wallet.ids).toStrictEqual({});
        expect(wallet.current).toBe('');
    });

    it('should throw to remove an non-existent ID', async () => {
        const name1 = 'Bob';
        const name2 = 'Alice';

        await keymaster.createId(name1);

        try {
            await keymaster.removeId(name2);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('renameId', () => {
    it('should rename an existing ID', async () => {
        const name1 = 'Bob';
        const name2 = 'Alice';
        const did = await keymaster.createId(name1);
        const ok = await keymaster.renameId(name1, name2);

        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.ids[name2].did).toBe(did);
        expect(wallet.current).toBe(name2);
    });

    it('should not rename from an non-existent ID', async () => {
        const name1 = 'Bob';
        const name2 = 'Alice';

        try {
            await keymaster.renameId(name1, name2);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });

    it('should not rename to an already existing ID', async () => {
        const name1 = 'Bob';
        await keymaster.createId(name1);

        try {
            await keymaster.renameId(name1, name1);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidParameterError.type);
        }
    });
});

describe('setCurrentId', () => {
    it('should switch to another ID', async () => {
        const name1 = 'Bob';
        await keymaster.createId(name1);

        const name2 = 'Alice';
        await keymaster.createId(name2);

        await keymaster.setCurrentId(name1);

        const wallet = await keymaster.loadWallet();
        expect(wallet.current).toBe(name1);
    });

    it('should not switch to an invalid ID', async () => {
        await keymaster.createId('Bob');

        try {
            await keymaster.setCurrentId('Alice');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('backupId', () => {
    it('should backup a new ID', async () => {
        const name = 'Bob';
        await keymaster.createId(name);

        const ok = await keymaster.backupId();

        const doc = await keymaster.resolveDID(name);
        const vault = await keymaster.resolveDID((doc.didDocumentData! as { vault: string }).vault);

        expect(ok).toBe(true);
        expect((vault.didDocumentData as { backup: string }).backup.length > 0).toBe(true);
    });

    it('should backup a non-current ID', async () => {
        const aliceDid = await keymaster.createId('Alice');
        await keymaster.createId('Bob'); // Bob will be current ID
        const ok = await keymaster.backupId('Alice');

        const doc = await keymaster.resolveDID(aliceDid);
        const vault = await keymaster.resolveDID((doc.didDocumentData! as { vault: string }).vault);

        expect(ok).toBe(true);
        expect((vault.didDocumentData as { backup: string }).backup.length > 0).toBe(true);
    });
});

describe('recoverId', () => {
    it('should recover an id from backup', async () => {
        const name = 'Bob';
        const did = await keymaster.createId(name);
        let wallet = await keymaster.loadWallet();
        const bob = JSON.parse(JSON.stringify(wallet.ids['Bob']));
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

    it('should not overwrite an id with the same name', async () => {
        const did = await keymaster.createId('Bob');
        await keymaster.backupId();

        try {
            await keymaster.recoverId(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Keymaster: Bob already exists in wallet');
        }
    });

    it('should not recover an id to a different wallet', async () => {
        const did = await keymaster.createId('Bob');
        await keymaster.backupId();

        // reset to a different wallet
        await keymaster.newWallet(undefined, true);

        try {
            await keymaster.recoverId(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });
});

describe('testAgent', () => {
    it('should return true for agent DID', async () => {
        const did = await keymaster.createId('Bob');
        const isAgent = await keymaster.testAgent(did);

        expect(isAgent).toBe(true);
    });

    it('should return false for non-agent DID', async () => {
        await keymaster.createId('Bob');
        const dataDid = await keymaster.createAsset({ name: 'mockAnchor' });
        const isAgent = await keymaster.testAgent(dataDid);

        expect(isAgent).toBe(false);
    });

    it('should raise an exception if no DID specified', async () => {
        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.testAgent();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });

    it('should raise an exception if invalid DID specified', async () => {
        try {
            await keymaster.testAgent('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('listIds', () => {
    it('should list all IDs wallet', async () => {
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
    it('should list all IDs wallet', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        const current = await keymaster.getCurrentId();

        expect(current).toBe('Victor');
    });
});

describe('setCurrentId', () => {
    it('should set current ID', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        await keymaster.setCurrentId('Carol');
        const current = await keymaster.getCurrentId();

        expect(current).toBe('Carol');
    });

    it('should throw an exception on invalid ID', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Carol');
        await keymaster.createId('Victor');

        try {
            await keymaster.setCurrentId('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});
