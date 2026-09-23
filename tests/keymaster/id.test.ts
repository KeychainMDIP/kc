import { jest } from '@jest/globals';
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

    it('should normalize an ID name before storing it', async () => {
        const did = await keymaster.createId(' Alice ');
        let wallet = await keymaster.loadWallet();

        expect(wallet.ids.Alice.did).toBe(did);
        expect(wallet.ids).not.toHaveProperty(' Alice ');
        expect(wallet.current).toBe('Alice');

        await expect(keymaster.createId('Alice')).rejects.toThrow('Invalid parameter: name already used');

        wallet = await keymaster.loadWallet();
        expect(wallet.counter).toBe(1);
        expect(await gatekeeper.getDIDs()).toHaveLength(1);
    });

    it('should reject names matching non-normalized legacy entries', async () => {
        const bob = await keymaster.createId('Bob');
        const carol = await keymaster.createId('Carol');
        const legacy = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        legacy.ids[' Bob '] = legacy.ids.Bob;
        delete legacy.ids.Bob;
        legacy.names = { ' Alice ': carol };
        await keymaster.saveWallet(legacy);

        await expect(keymaster.createId('Bob')).rejects.toThrow('Invalid parameter: name already used');
        await expect(keymaster.createId('Alice')).rejects.toThrow('Invalid parameter: name already used');

        const wallet = await keymaster.loadWallet();
        expect(wallet.counter).toBe(2);
        expect(wallet.ids[' Bob '].did).toBe(bob);
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
    });

    it.each(['.', '..', ' . ', ' .. '])('should reject the URL path segment name %p', async (name) => {
        await expect(keymaster.createId(name)).rejects.toThrow('Invalid parameter: name cannot be "." or ".."');

        const wallet = await keymaster.loadWallet();
        expect(wallet.counter).toBe(0);
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
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

    it.each(['refusal', 'exception'])(
        'should not reuse a published identity account after a wallet storage %s', async (failure) => {
            await keymaster.loadWallet();
            const persist = wallet.saveWallet.bind(wallet);
            const save = jest.spyOn(wallet, 'saveWallet');
            save.mockImplementationOnce(persist);
            if (failure === 'refusal') {
                save.mockResolvedValueOnce(false);
            } else {
                save.mockRejectedValueOnce(new Error('storage failed'));
            }

            await expect(keymaster.createId('Orphan', { registry: 'local' })).rejects.toThrow(
                failure === 'refusal' ? 'save wallet failed' : 'storage failed'
            );

            const [orphan] = await gatekeeper.getDIDs() as string[];
            const orphanDoc = await keymaster.resolveDID(orphan);
            const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
            const recovered = await restarted.loadWallet();
            expect(recovered.counter).toBe(1);
            expect(recovered.ids).not.toHaveProperty('Orphan');

            const alice = await restarted.createId('Alice', { registry: 'local' });
            const aliceDoc = await restarted.resolveDID(alice);
            expect(aliceDoc.didDocument!.verificationMethod![0].publicKeyJwk)
                .not.toStrictEqual(orphanDoc.didDocument!.verificationMethod![0].publicKeyJwk);
            const persisted = await restarted.loadWallet();
            expect(persisted.counter).toBe(2);
            expect(persisted.ids.Alice.account).toBe(1);
        }
    );

    it('should not publish an identity when its account reservation cannot be saved', async () => {
        const original = await keymaster.loadWallet();
        jest.spyOn(wallet, 'saveWallet').mockResolvedValueOnce(false);
        const publish = jest.spyOn(gatekeeper, 'createDID');

        await expect(keymaster.createId('Alice', { registry: 'local' }))
            .rejects.toThrow('save wallet failed');

        expect(publish).not.toHaveBeenCalled();
        expect(await keymaster.loadWallet()).toBe(original);
        expect(original.counter).toBe(0);
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
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
        expect(operation.mdip).not.toHaveProperty('prefix');
        expect(operation.publicJwk).toBeDefined();
        expect(operation.signature).toBeDefined();
        expect(operation.signature!.signed).toBeDefined();
        expect(operation.signature!.hash).toBeDefined();
        expect(operation.signature!.value).toBeDefined();
    });

    it('should create operation with custom registry', async () => {
        const name = 'Alice';
        const registry = 'TFTC';
        const operation = await keymaster.createIdOperation(name, 0, { registry });

        expect(operation.mdip!.registry).toBe(registry);
        expect(operation.type).toBe('create');
        expect(operation.publicJwk).toBeDefined();
        expect(operation.signature).toBeDefined();
    });

    it('should create operation with local registry', async () => {
        const name = 'Charlie';
        const registry = 'local';
        const operation = await keymaster.createIdOperation(name, 0, { registry });

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

    it('should include the configured DID prefix in the signed operation', async () => {
        const didPrefix = 'did:mdip';
        const customKeymaster = new Keymaster({
            gatekeeper,
            wallet,
            cipher,
            didPrefix,
            passphrase: 'passphrase'
        });

        const operation = await customKeymaster.createIdOperation('Ivy');
        const msgHash = cipher.hashJSON({
            type: operation.type,
            created: operation.created,
            blockid: operation.blockid,
            mdip: operation.mdip,
            publicJwk: operation.publicJwk,
        });

        expect(operation.mdip!.prefix).toBe(didPrefix);
        expect(operation.signature!.hash).toBe(msgHash);
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
    it.each(['Alice', ' Alice '])('should rename an existing ID to %p', async (newName) => {
        const name1 = 'Bob';
        const name2 = 'Alice';
        const did = await keymaster.createId(name1);
        const ok = await keymaster.renameId(name1, newName);

        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.ids[name2].did).toBe(did);
        expect(wallet.ids).not.toHaveProperty(name1);
        expect(wallet.current).toBe(name2);
        expect(await keymaster.lookupDID(name2)).toBe(did);
        expect((await keymaster.fetchIdInfo(name2)).did).toBe(did);
    });

    it.each(['friend', ' friend ', 'Bob', ' Bob '])('should reject an existing alias or identity name (%p) without changing the wallet', async (name) => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.addName('friend', bob);
        await keymaster.setCurrentId('Alice');
        const before = JSON.stringify(await keymaster.loadWallet());
        const stored = await wallet.loadWallet();

        await expect(keymaster.renameId('Alice', name)).rejects.toThrow('Invalid parameter: name already used');

        expect(JSON.stringify(await keymaster.loadWallet())).toBe(before);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        expect((await keymaster.fetchIdInfo('Alice')).did).toBe(alice);
        expect(await keymaster.lookupDID('Alice')).toBe(alice);
        expect(await keymaster.lookupDID('friend')).toBe(bob);
    });

    it.each(['Alice', 'Bob'])('should preserve unrelated aliases and selection when renaming with %s selected', async (current) => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.addName('friend', bob);
        await keymaster.setCurrentId(current);

        expect(await keymaster.renameId('Alice', 'Carol')).toBe(true);

        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
        expect(await restarted.listIds()).toStrictEqual(['Bob', 'Carol']);
        expect(await restarted.listNames()).toStrictEqual({ friend: bob });
        expect(await restarted.getCurrentId()).toBe(current === 'Alice' ? 'Carol' : 'Bob');
        expect(await restarted.lookupDID('Carol')).toBe(alice);
        expect((await restarted.fetchIdInfo('Carol')).did).toBe(alice);
        expect(await restarted.lookupDID('friend')).toBe(bob);
    });

    it('should reject a rename when an earlier queued mutation claims the name', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const results = await Promise.allSettled([
            keymaster.addName('friend', bob),
            keymaster.renameId('Alice', 'friend'),
        ]);

        expect(results[0]).toStrictEqual({ status: 'fulfilled', value: true });
        expect(results[1]).toMatchObject({
            status: 'rejected',
            reason: { message: 'Invalid parameter: name already used' },
        });
        expect((await keymaster.fetchIdInfo('Alice')).did).toBe(alice);
        expect(await keymaster.lookupDID('friend')).toBe(bob);
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
        expect(wallet.current).toBe(name);
        expect(wallet.counter).toBe(1);
    });

    it.each([
        { account: 1, identities: 2, reset: true, nextAccount: 2 },
        { account: 3, identities: 4, reset: true, nextAccount: 4 },
        { account: 1, identities: 2, reset: false, nextAccount: 2 },
        { account: 1, identities: 4, reset: false, nextAccount: 4 },
    ])('should use account $nextAccount after recovering account $account (identities=$identities, reset=$reset)', async ({ account, identities, reset, nextAccount }) => {
        for (let index = 0; index < identities; index++) {
            await keymaster.createId(`ID${index}`);
        }

        const name = `ID${account}`;
        const did = (await keymaster.loadWallet()).ids[name].did;
        const originalDoc = await keymaster.resolveDID(did);
        expect(await keymaster.backupId(name)).toBe(true);

        if (reset) {
            const mnemonic = await keymaster.decryptMnemonic();
            await keymaster.newWallet(mnemonic, true);
        } else {
            await keymaster.removeId(name);
        }

        expect(await keymaster.recoverId(did)).toBe(name);
        const recovered = await keymaster.loadWallet();
        expect(recovered.ids[name]).toMatchObject({ did, account, index: 0 });
        expect(recovered.current).toBe(name);
        expect(recovered.counter).toBe(nextAccount);

        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
        expect(await restarted.loadWallet()).toStrictEqual(recovered);

        const nextDid = await restarted.createId('Next');
        const nextWallet = await restarted.loadWallet();
        expect(nextWallet.ids.Next.account).toBe(nextAccount);
        expect(nextWallet.counter).toBe(nextAccount + 1);

        const nextDoc = await restarted.resolveDID(nextDid);
        expect(nextDoc.didDocument!.verificationMethod![0].publicKeyJwk)
            .not.toStrictEqual(originalDoc.didDocument!.verificationMethod![0].publicKeyJwk);
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
