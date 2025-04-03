import mockFs from 'mock-fs';
import fs from 'fs';
import sharp from 'sharp';

import Gatekeeper from '@mdip/gatekeeper';
import Keymaster, {
    EncryptedMessage
} from '@mdip/keymaster';
import {
    ChallengeResponse,
    Poll,
    VerifiableCredential
} from '@mdip/keymaster/types';
import {
    EncryptedWallet,
    Seed,
    WalletFile,
} from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJson from '@mdip/gatekeeper/db/json';
import WalletJson from '@mdip/keymaster/wallet/json';
import WalletEncrypted from '@mdip/keymaster/wallet/json-enc';
import { copyJSON } from '@mdip/common/utils';
import { InvalidDIDError, ExpectedExceptionError, UnknownIDError, InvalidParameterError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { generateCID } from '@mdip/ipfs/utils';

import canonicalizeModule from 'canonicalize';
import { MdipDocument } from "@mdip/gatekeeper/types";
const canonicalize = canonicalizeModule as unknown as (input: unknown) => string;

const db = new DbJson('test');
const ipfs = new HeliaClient();
const gatekeeper = new Gatekeeper({ db, ipfs, registries: ['local', 'hyperswarm', 'TFTC'] });
const wallet = new WalletJson();
const cipher = new CipherNode();
const keymaster = new Keymaster({ gatekeeper, wallet, cipher });

describe('constructor', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should throw exception on invalid parameters', async () => {
        mockFs({});

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
            new Keymaster({ wallet, cipher });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.gatekeeper');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing wallet arg
            new Keymaster({ gatekeeper, cipher });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.wallet');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing cipher arg
            new Keymaster({ gatekeeper, wallet });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.cipher');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid gatekeeper arg
            new Keymaster({ gatekeeper: {}, wallet, cipher });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.gatekeeper');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid wallet arg
            new Keymaster({ gatekeeper, wallet: {}, cipher });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.wallet');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid cipher arg
            new Keymaster({ gatekeeper, wallet, cipher: {} });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.cipher');
        }

        // Cover the ExpectedExceptionError class for completeness
        try {
            new Keymaster({ gatekeeper, wallet, cipher });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Expected to throw an exception');
        }
    });
});

describe('loadWallet', () => {

    afterEach(async () => {
        mockFs.restore();
    });

    it('should create a wallet on first load', async () => {
        mockFs({});

        const wallet = await keymaster.loadWallet();

        expect(wallet.seed!.mnemonic.length > 0).toBe(true);
        expect(wallet.seed!.hdkey.xpub.length > 0).toBe(true);
        expect(wallet.seed!.hdkey.xpriv.length > 0).toBe(true);
        expect(wallet.counter).toBe(0);
        expect(wallet.ids).toStrictEqual({});
    });

    it('should return the same wallet on second load', async () => {
        mockFs({});

        const wallet1 = await keymaster.loadWallet();
        const wallet2 = await keymaster.loadWallet();

        expect(wallet2).toStrictEqual(wallet1);
    });

    it('should return null when loading non-existing encrypted wallet', async () => {
        mockFs({});

        const wallet_enc = new WalletEncrypted(wallet, 'passphrase');
        const check_wallet = await wallet_enc.loadWallet();
        expect(check_wallet).toBe(null);
    });

    it('should throw exception when passphrase not set', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage, no passphrase
        const wallet_enc = new WalletEncrypted(wallet);
        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher });

        try {
            await keymaster.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('KC_ENCRYPTED_PASSPHRASE not set');
        }
    });

    it('should throw exception on load with incorrect passphrase', async () => {
        mockFs({});
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };
        const wallet_enc1 = new WalletEncrypted(wallet, 'passphrase');
        const keymaster1 = new Keymaster({ gatekeeper, wallet: wallet_enc1, cipher });
        const ok = await keymaster1.saveWallet(mockWallet);
        expect(ok).toBe(true);

        try {
            const wallet_enc2 = new WalletEncrypted(wallet, 'incorrect');
            const keymaster2 = new Keymaster({ gatekeeper, wallet: wallet_enc2, cipher });
            await keymaster2.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Incorrect passphrase.');
        }
    });

    it('should throw exception on encrypted wallet', async () => {
        mockFs({});

        const mockWallet: EncryptedWallet = { salt: "", iv: "", data: "" };
        await keymaster.saveWallet(mockWallet);

        try {
            await keymaster.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Wallet is encrypted');
        }
    });

    it('should throw exception on corrupted wallet', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage, missing salt
        const mockWallet: WalletFile = { counter: 0, ids: {} };
        await keymaster.saveWallet(mockWallet);

        try {
            await keymaster.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Wallet is corrupted');
        }
    });
});

describe('saveWallet', () => {

    afterEach(async () => {
        mockFs.restore();
    });

    it('test saving directly on the unencrypted wallet', async () => {
        mockFs({});
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };

        const ok = await wallet.saveWallet(mockWallet);
        expect(ok).toBe(true);
    });

    it('test saving directly on the encrypted wallet', async () => {
        mockFs({});
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };
        const wallet_enc = new WalletEncrypted(wallet, 'passphrase');
        const ok = await wallet_enc.saveWallet(mockWallet);

        expect(ok).toBe(true);
    });

    it('should save a wallet', async () => {
        mockFs({});
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };

        const ok = await keymaster.saveWallet(mockWallet);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should ignore overwrite flag if unnecessary', async () => {
        mockFs({});
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };

        const ok = await keymaster.saveWallet(mockWallet, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should handle data folder existing already', async () => {
        mockFs({
            data: {}
        });
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };

        const ok = await keymaster.saveWallet(mockWallet);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should overwrite an existing wallet', async () => {
        mockFs({});
        const mockWallet1: WalletFile = { seed: {} as Seed, counter: 1, ids: {} };
        const mockWallet2: WalletFile = { seed: {} as Seed, counter: 2, ids: {} };

        await keymaster.saveWallet(mockWallet1);
        const ok = await keymaster.saveWallet(mockWallet2);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet2);
    });

    it('should not overwrite an existing wallet if specified', async () => {
        mockFs({});
        const mockWallet1: WalletFile = { seed: {} as Seed, counter: 1, ids: {} };
        const mockWallet2: WalletFile = { seed: {} as Seed, counter: 2, ids: {} };

        await keymaster.saveWallet(mockWallet1);
        const ok = await keymaster.saveWallet(mockWallet2, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(false);
        expect(wallet).toStrictEqual(mockWallet1);
    });

    it('should overwrite an existing wallet in a loop', async () => {
        mockFs({});

        for (let i = 0; i < 10; i++) {
            const mockWallet: WalletFile = { seed: {} as Seed, counter: i + 1, ids: {} };

            const ok = await keymaster.saveWallet(mockWallet);
            const wallet = await keymaster.loadWallet();

            expect(ok).toBe(true);
            expect(wallet).toStrictEqual(mockWallet);
        }
    });

    it('should not overwrite an existing wallet if specified', async () => {
        mockFs({});

        const wallet_enc = new WalletEncrypted(wallet, 'passphrase');
        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher });

        const mockWallet1: WalletFile = { seed: {} as Seed, counter: 1, ids: {} };
        const mockWallet2: WalletFile = { seed: {} as Seed, counter: 2, ids: {} };

        await keymaster.saveWallet(mockWallet1);
        const ok = await keymaster.saveWallet(mockWallet2, false);
        const walletData = await keymaster.loadWallet();

        expect(ok).toBe(false);
        expect(walletData).toStrictEqual(mockWallet1);
    });

    it('wallet should throw when passphrase not set', async () => {
        mockFs({});
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };
        // @ts-expect-error Testing invalid usage, no passphrase
        const wallet_enc = new WalletEncrypted(wallet);
        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher });

        try {
            await keymaster.saveWallet(mockWallet);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('KC_ENCRYPTED_PASSPHRASE not set');
        }
    });

    it('encrypted wallet should return unencrypted wallet', async () => {
        mockFs({
            'data': {}
        });

        const walletFile = 'data/wallet.json';
        const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };
        fs.writeFileSync(walletFile, JSON.stringify(mockWallet, null, 4));

        const wallet_enc = new WalletEncrypted(wallet, 'passphrase');
        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher });
        const testWallet = await keymaster.loadWallet();

        expect(testWallet).toStrictEqual(mockWallet);
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

        expect(mnemonic !== wallet.seed!.mnemonic).toBe(true);

        // Split the mnemonic into words
        const words = mnemonic.split(' ');
        expect(words.length).toBe(12);
    });
});

describe('updateSeedBank', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should throw error on missing DID', async () => {
        mockFs({});

        const doc: MdipDocument = {};

        try {
            await keymaster.updateSeedBank(doc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: seed bank missing DID');
        }
    });
});

describe('newWallet', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should overwrite an existing wallet when allowed', async () => {
        mockFs({});

        const wallet1 = await keymaster.loadWallet();
        await keymaster.newWallet(undefined, true);
        const wallet2 = await keymaster.loadWallet();

        expect(wallet1.seed!.mnemonic !== wallet2.seed!.mnemonic).toBe(true);
    });

    it('should not overwrite an existing wallet by default', async () => {
        mockFs({});

        await keymaster.loadWallet();

        try {
            await keymaster.newWallet();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Keymaster: save wallet failed');
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
            // @ts-expect-error Testing invalid usage, incorrect argument
            await keymaster.newWallet([]);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: mnemonic');
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

        expect(did === doc.didDocument!.id).toBe(true);
    });

    it('should store backup in seed bank', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        const bank = await keymaster.resolveSeedBank();

        expect(did === (bank.didDocumentData! as { wallet: string }).wallet).toBe(true);
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

    it('should create a new ID with a Unicode name', async () => {
        mockFs({});

        const name = 'ҽ× ʍɑϲհíղɑ';
        const did = await keymaster.createId(name);
        const wallet = await keymaster.loadWallet();

        expect(wallet.ids[name].did).toBe(did);
        expect(wallet.current).toBe(name);
    });

    it('should create a new ID on default registry', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveDID(did);

        expect(doc.mdip!.registry).toBe('hyperswarm');
    });

    it('should create a new ID on customized default registry', async () => {
        mockFs({});

        const defaultRegistry = 'TFTC';
        const keymaster = new Keymaster({ gatekeeper, wallet, cipher, defaultRegistry });

        const name = 'Bob';
        const did = await keymaster.createId(name);
        const doc = await keymaster.resolveDID(did);

        expect(doc.mdip!.registry).toBe(defaultRegistry);
    });

    it('should throw to create a second ID with the same name', async () => {
        mockFs({});

        const name = 'Bob';
        await keymaster.createId(name);

        try {
            await keymaster.createId(name);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: name already used');
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

    it('should not create an ID with an empty name', async () => {
        mockFs({});

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
        mockFs({});

        try {
            await keymaster.createId('1234567890123456789012345678901234567890');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name too long');
        }
    });

    it('should not create an ID with a name that contains unprintable characters', async () => {
        mockFs({});

        try {
            await keymaster.createId('hello\nworld!');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name contains unprintable characters');
        }
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
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('renameId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should rename an existing ID', async () => {
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
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

        const doc = await keymaster.resolveDID(name);
        const vault = await keymaster.resolveDID((doc.didDocumentData! as { vault: string }).vault);

        expect(ok).toBe(true);
        expect((vault.didDocumentData as { backup: string }).backup.length > 0).toBe(true);
    });

    it('should backup a non-current ID', async () => {
        mockFs({});

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

    it('should not overwrite an id with the same name', async () => {
        mockFs({});

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
        mockFs({});

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
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.testAgent();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });

    it('should raise an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.testAgent('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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

        expect(doc.didDocument!.id).toBe(did);
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
        expect(wallet.names!['Jack'] === bob).toBe(true);
    });

    it('should create a Unicode name', async () => {
        mockFs({});

        const name = 'ҽ× ʍɑϲհíղɑ';

        const bob = await keymaster.createId('Bob');
        const ok = await keymaster.addName(name, bob);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.names![name] === bob).toBe(true);
    });

    it('should not add duplicate name', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.addName('Jack', alice);
            await keymaster.addName('Jack', bob);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name already used');
        }
    });

    it('should not add a name that is same as an ID', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.addName('Alice', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name already used');
        }
    });

    it('should not add an empty name', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const expectedError = 'Invalid parameter: name must be a non-empty string';

        try {
            await keymaster.addName('', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            await keymaster.addName('    ', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid name arg
            await keymaster.addName(undefined, alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid name arg
            await keymaster.addName(0, alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid name arg
            await keymaster.addName({}, alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }
    });

    it('should not add a name that is too long', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.addName('1234567890123456789012345678901234567890', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name too long');
        }
    });

    it('should not add a name that contains unprintable characters', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.addName('hello\nworld!', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name contains unprintable characters');
        }
    });
});

describe('getName', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return DID for a new name', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const ok = await keymaster.addName('Jack', bob);
        const did = await keymaster.getName('Jack');

        expect(ok).toBe(true);
        expect(did).toBe(bob);
    });

    it('should return null for unknown name', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.getName('Jack');

        expect(did).toBe(null);
    });

    it('should return null for non-string names', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        // @ts-expect-error Testing invalid usage, missing arg
        let did = await keymaster.getName();
        expect(did).toBe(null);

        // @ts-expect-error Testing invalid usage, invalid name arg
        did = await keymaster.getName(333);
        expect(did).toBe(null);

        // @ts-expect-error Testing invalid usage, invalid name arg
        did = await keymaster.getName([1, 2, 3]);
        expect(did).toBe(null);

        // @ts-expect-error Testing invalid usage, invalid name arg
        did = await keymaster.getName({ id: 'mock' });
        expect(did).toBe(null);
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

        expect(wallet.names!['Jack'] === bob).toBe(false);
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

        const did = await keymaster.createId('Bob');
        const doc = await keymaster.resolveDID('Bob');

        expect(doc.didDocument!.id).toBe(did);
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
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID from a string anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = "mockAnchor";
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID from a list anchor', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = [1, 2, 3];
        const dataDid = await keymaster.createAsset(mockAnchor);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should create DID for a different valid ID', async () => {
        mockFs({});

        const ownerDid = await keymaster.createId('Bob');
        const mockAnchor = "mockAnchor";

        await keymaster.createId('Alice');

        const dataDid = await keymaster.createAsset(mockAnchor, { registry: 'hyperswarm', controller: 'Bob' });
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);
        expect(doc.didDocumentData).toStrictEqual(mockAnchor);
    });

    it('should throw an exception if no ID selected', async () => {
        mockFs({});

        try {
            const mockAnchor = { name: 'mockAnchor' };
            await keymaster.createAsset(mockAnchor);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Keymaster: No current ID');
        }
    });

    it('should throw an exception for an empty string anchor', async () => {
        mockFs({});

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

    afterEach(() => {
        mockFs.restore();
    });

    it('should clone an asset DID', async () => {
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

        try {
            const bob = await keymaster.createId('Bob');
            await keymaster.cloneAsset(bob);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: id');
        }
    });
});

describe('transferAsset', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should transfer an asset DID to an agent DID', async () => {
        mockFs({});

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
        mockFs({});

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
        mockFs({});

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
        mockFs({});

        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.transferAsset('mockDID', bob);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Unknown ID');
        }
    });

    it('should throw if did is an agent', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.transferAsset(bob, bob);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: id');
        }
    });

    it('should throw an exception on invalid controller', async () => {
        mockFs({});

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
        mockFs({});

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

    afterEach(() => {
        mockFs.restore();
    });

    it('should return empty list when no assets', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const assets = await keymaster.listAssets();

        expect(assets).toStrictEqual([]);
    });

    it('should return assets owned by current ID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const dataDid = await keymaster.createAsset(mockAnchor);
        const assets = await keymaster.listAssets();

        expect(assets).toStrictEqual([dataDid]);
    });

    it('should return assets owned by specified ID', async () => {
        mockFs({});

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
        mockFs({});

        await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockAnchor' };
        const validUntil = new Date();
        validUntil.setMinutes(validUntil.getMinutes() + 1);
        await keymaster.createAsset(mockAnchor, { validUntil: validUntil.toISOString() });
        const assets = await keymaster.listAssets();

        expect(assets).toStrictEqual([]);
    });
});

describe('updateDID', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should throw if doc missing id', async () => {
        mockFs({});
        const doc: MdipDocument = {};

        try {
            await keymaster.updateDID(doc);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toContain('doc.didDocument.id');
        }
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
        expect(doc2.didDocumentMetadata!.version).toBe(2);
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
        expect(doc2.didDocument!.controller).toBe(bob);
        expect(doc2.didDocumentData).toStrictEqual(dataUpdated);
        expect(doc2.didDocumentMetadata!.version).toBe(2);
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
        expect(doc.didDocumentMetadata!.deactivated).toBe(true);
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
        expect(doc.didDocumentMetadata!.deactivated).toBe(true);
    });
});

describe('removeFromOwned', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return false if nothing owned', async () => {
        mockFs({});

        const owner = await keymaster.createId('Alice');
        const ok = await keymaster.removeFromOwned("did:mock", owner);

        expect(ok).toBe(false);
    });
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

    afterEach(() => {
        mockFs.restore();
    });

    it('should encrypt a short message', async () => {
        mockFs({});

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
        mockFs({});


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

    it('should throw an exception on invalid DID', async () => {
        mockFs({});

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

    afterEach(() => {
        mockFs.restore();
    });

    it('should encrypt valid JSON', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        await keymaster.resolveDID(bob);

        const did = await keymaster.encryptJSON(mockJson, bob);
        const data = await keymaster.resolveAsset(did);
        expect((data as { encrypted: EncryptedMessage }).encrypted.sender).toStrictEqual(bob);
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
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: No current ID');
        }
    });

    it('should throw an exception if null parameter', async () => {
        mockFs({});

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

        // @ts-expect-error Testing invalid usage, invalid arg
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

    it('should return false for missing signer', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
        delete signed.signature.signer;
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(false);
    });

    it('should return false for invalid hash', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const signed = await keymaster.addSignature(mockJson);
        signed.signature.hash = "1";
        const isValid = await keymaster.verifySignature(signed);

        expect(isValid).toBe(false);
    });

    it('should return false for null parameter', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage, missing arg
        const isValid = await keymaster.verifySignature();

        expect(isValid).toBe(false);
    });

    it('should return false for invalid JSON', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage, invalid arg
        const isValid = await keymaster.verifySignature("not JSON");

        expect(isValid).toBe(false);
    });
});

const mockSchema = {
    // eslint-disable-next-line
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

describe('isVerifiableCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return false for non-object or null', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage, calling private func
        const res1 = keymaster.isVerifiableCredential(null);

        // @ts-expect-error Testing invalid usage, calling private func
        const res2 = keymaster.isVerifiableCredential("");

        expect(res1).toBe(false);
        expect(res2).toBe(false);
    })
})

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
        expect(vc.credentialSubject!.id).toBe(userDid);
        expect(vc.credential!.email).toEqual(expect.any(String));
    });

    it('should create a bound credential with provided default', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        const credential = { email: 'bob@mock.com' };
        const vc = await keymaster.bindCredential(credentialDid, userDid, { credential });

        expect(vc.issuer).toBe(userDid);
        expect(vc.credentialSubject!.id).toBe(userDid);
        expect(vc.credential!.email).toEqual(credential.email);
    });

    it('should create a bound credential for a different user', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);

        await keymaster.setCurrentId('Alice')
        const vc = await keymaster.bindCredential(credentialDid, bob);

        expect(vc.issuer).toBe(alice);
        expect(vc.credentialSubject!.id).toBe(bob);
        expect(vc.credential!.email).toEqual(expect.any(String));
    });
});

describe('issueCredential', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should issue a bound credential when user is issuer', async () => {
        mockFs({});

        const subject = await keymaster.createId('Bob');
        const schema = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(schema, subject);

        const did = await keymaster.issueCredential(boundCredential);

        const vc = await keymaster.decryptJSON(did) as VerifiableCredential;
        expect(vc.issuer).toBe(subject);
        expect(vc.credentialSubject!.id).toBe(subject);
        expect(vc.credential!.email).toEqual(expect.any(String));

        const isValid = await keymaster.verifySignature(vc);
        expect(isValid).toBe(true);

        const wallet = await keymaster.loadWallet();
        expect(wallet.ids['Bob'].owned!.includes(did)).toEqual(true);
    });

    it('should bind and issue a credential', async () => {
        mockFs({});

        const subject = await keymaster.createId('Bob');
        const schema = await keymaster.createSchema(mockSchema);
        const unboundCredential = await keymaster.createTemplate(schema);

        const now = new Date();
        const validFrom = now.toISOString();
        now.setFullYear(now.getFullYear() + 1);
        const validUntil = now.toISOString();

        const did = await keymaster.issueCredential(unboundCredential, { subject, schema, validFrom, validUntil });

        const vc = await keymaster.decryptJSON(did) as VerifiableCredential;
        expect(vc.issuer).toBe(subject);
        expect(vc.credentialSubject!.id).toBe(subject);
        expect(vc.credential!.email).toEqual(expect.any(String));
        expect(vc.validFrom).toBe(validFrom);
        expect(vc.validUntil).toBe(validUntil);

        const isValid = await keymaster.verifySignature(vc);
        expect(isValid).toBe(true);
    });

    it('should throw an exception if user is not issuer', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        await keymaster.setCurrentId('Alice');

        const schema = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(schema, bob);

        await keymaster.setCurrentId('Bob');

        try {
            await keymaster.issueCredential(boundCredential);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential.issuer');
        }
    });

    it('should throw an exception on unbound credential without binding options', async () => {
        mockFs({});

        await keymaster.createId('Alice');

        const schema = await keymaster.createSchema(mockSchema);
        const unboundCredential = await keymaster.createTemplate(schema);

        try {
            await keymaster.issueCredential(unboundCredential);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential.issuer');
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
        const vc = (await keymaster.getCredential(did))!;

        const validUntilDate = new Date();
        validUntilDate.setHours(validUntilDate.getHours() + 24);
        vc.validUntil = validUntilDate.toISOString();
        const ok = await keymaster.updateCredential(did, vc);
        expect(ok).toBe(true);

        const updated = (await keymaster.getCredential(did))!;
        expect(updated.validUntil).toBe(vc.validUntil);

        const doc = await keymaster.resolveDID(did);
        expect(doc.didDocumentMetadata!.version).toBe(2);
    });

    it('should throw exception on invalid parameters', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);
        const vc = (await keymaster.getCredential(did))!;

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.updateCredential();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // Pass agent DID instead of credential DID
            await keymaster.updateCredential(bob, vc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: did not encrypted');
        }

        try {
            // Pass cipher DID instead of credential DID
            const cipherDID = await keymaster.encryptMessage('mock', bob);
            await keymaster.updateCredential(cipherDID, vc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did not encrypted JSON');
        }

        try {
            // Pass cipher DID instead of credential DID
            const cipherDID = await keymaster.encryptJSON({ bob }, bob);
            await keymaster.updateCredential(cipherDID, vc);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did is not a credential');
        }

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.updateCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: credential');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.updateCredential(did, {});
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential');
        }

        try {
            const vc2 = copyJSON(vc);
            delete vc2.credential;
            await keymaster.updateCredential(did, vc2);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential');
        }

        try {
            const vc2 = copyJSON(vc);
            delete vc2.credentialSubject;
            await keymaster.updateCredential(did, vc2);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: credential');
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
        expect(revoked.didDocumentMetadata!.deactivated).toBe(true);
    });

    it('should throw exception if verifiable credential is already revoked', async () => {
        mockFs({});

        const userDid = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, userDid);
        const did = await keymaster.issueCredential(boundCredential);

        const ok1 = await keymaster.revokeCredential(did);
        expect(ok1).toBe(true);

        const revoked = await keymaster.resolveDID(did);
        expect(revoked.didDocument).toStrictEqual({});
        expect(revoked.didDocumentMetadata!.deactivated).toBe(true);

        try {
            await keymaster.revokeCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid operation: DID deactivated');
        }
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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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
        expect(wallet.ids['Alice'].owned!.includes(did));
        expect(wallet.ids['Bob'].held!.includes(did));
    });

    it('should return false if user cannot decrypt credential', async () => {
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

    it('should return false if user is not the credential subject', async () => {
        mockFs({});

        await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Carol');

        await keymaster.setCurrentId('Alice');

        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const vc1 = await keymaster.issueCredential(boundCredential);
        const credential = await keymaster.getCredential(vc1);
        const vc2 = await keymaster.encryptJSON(credential, 'Carol');

        await keymaster.setCurrentId('Carol');

        const ok = await keymaster.acceptCredential(vc2);
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

        expect(doc.didDocument!.id).toBe(did);
        expect(doc.didDocument!.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge: {} });

        const now = Date.now();
        const validUntil = new Date(doc.mdip!.validUntil!).getTime();
        const ttl = validUntil - now;

        expect(ttl < 60 * 60 * 1000).toBe(true);
    });

    it('should create an empty challenge with specified expiry', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');
        const validUntil = '2025-01-01';
        const did = await keymaster.createChallenge({}, { validUntil });
        const doc = await keymaster.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
        expect(doc.didDocument!.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge: {} });
        expect(doc.mdip!.validUntil).toBe(validUntil);
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

        expect(doc.didDocument!.id).toBe(did);
        expect(doc.didDocument!.controller).toBe(alice);
        expect(doc.didDocumentData).toStrictEqual({ challenge });
    });

    it('should throw an exception if challenge spec is invalid', async () => {
        mockFs({});

        await keymaster.createId('Alice');

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.createChallenge(null);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challenge');
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.createChallenge([]);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challenge');
        }

        try {
            await keymaster.createChallenge({
                // @ts-expect-error Testing invalid usage, invalid arg
                credentials: 123
            });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challenge.credentials');
        }
    });

    it('should throw an exception if validUntil is not a valid date', async () => {
        mockFs({});

        await keymaster.createId('Alice');

        try {
            const validUntil = 'mockDate';
            await keymaster.createChallenge({}, { validUntil });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: options.validUntil');
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
        expect(wallet.ids['Alice'].owned!.includes(vcDid));
        expect(wallet.ids['Bob'].held!.includes(vcDid));

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
        const { response } = await keymaster.decryptJSON(responseDID) as { response: ChallengeResponse };

        expect(response.challenge).toBe(challengeDID);
        expect(response.credentials.length).toBe(1);
        expect(response.credentials[0].vc).toBe(vcDid);
    });

    it('should throw an exception on invalid challenge', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.createResponse();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.createResponse('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

        try {
            await keymaster.createResponse('did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.createResponse('did:mock', { retries: 10, delay: 10 });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.createResponse(alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: challengeDID');
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
        expect(verify1.vps!.length).toBe(1);
    });

    it('should not verify a invalid response to a single credential challenge', async () => {
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
        expect(verify1.vps!.length).toBe(0);
    });

    it('should verify a response if credential is updated', async () => {
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

        await keymaster.setCurrentId('Alice');
        const credential2 = (await keymaster.getCredential(vc1))!;
        credential2.credential = { email: 'updated@email.com' };
        await keymaster.updateCredential(vc1, credential2);

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
        expect(verify1.vps!.length).toBe(1);
    });

    it('should demonstrate full workflow with credential revocations', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice', { registry: 'local' });
        const bob = await keymaster.createId('Bob', { registry: 'local' });
        const carol = await keymaster.createId('Carol', { registry: 'local' });
        await keymaster.createId('Victor', { registry: 'local' });

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
        const { response } = await keymaster.decryptJSON(responseDID) as { response: ChallengeResponse };

        expect(response.challenge).toBe(challengeDID);
        expect(response.credentials.length).toBe(4);

        await keymaster.setCurrentId('Victor');

        const verify1 = await keymaster.verifyResponse(responseDID);
        expect(verify1.match).toBe(true);
        expect(verify1.vps!.length).toBe(4);

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
        expect(verify2.vps!.length).toBe(4);

        await keymaster.setCurrentId('Alice');
        await keymaster.revokeCredential(vc1);

        await keymaster.setCurrentId('Victor');
        const verify3 = await keymaster.verifyResponse(responseDID)
        expect(verify3.match).toBe(false);
        expect(verify3.vps!.length).toBe(3);

        await keymaster.setCurrentId('Bob');
        await keymaster.revokeCredential(vc3);

        await keymaster.setCurrentId('Victor');
        const verify4 = await keymaster.verifyResponse(responseDID);
        expect(verify4.match).toBe(false);
        expect(verify4.vps!.length).toBe(2);
    });

    it('should raise exception on invalid parameter', async () => {
        mockFs({});

        const alice = await keymaster.createId('Alice');

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.verifyResponse();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.verifyResponse(alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did not encrypted');
        }

        try {
            await keymaster.verifyResponse('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

        try {
            await keymaster.verifyResponse('did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.verifyResponse('did:mock', { retries: 10, delay: 10 });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(InvalidDIDError.type);
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
        const manifest = (doc.didDocumentData as { manifest: Record<string, VerifiableCredential> }).manifest;

        expect(manifest[did]).toStrictEqual(vc);
    });

    it('should publish a valid credential without revealing', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const credentialDid = await keymaster.createSchema(mockSchema);
        const boundCredential = await keymaster.bindCredential(credentialDid, bob);
        const did = await keymaster.issueCredential(boundCredential);

        await keymaster.publishCredential(did);

        const doc = await keymaster.resolveDID(bob);
        const vc = await keymaster.decryptJSON(did) as VerifiableCredential;
        const manifest = (doc.didDocumentData as { manifest: Record<string, VerifiableCredential> }).manifest;

        vc.credential = null;

        expect(manifest[did]).toStrictEqual(vc);
    });

    it('should throw when did is not a verifiable credential', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);

        try {
            await keymaster.publishCredential(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toContain('did is not a credential');
        }
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
        const manifest = (doc.didDocumentData as { manifest: Record<string, VerifiableCredential> }).manifest;

        expect(manifest).toStrictEqual({});
    });

    it('should throw an exception when no current ID', async () => {
        mockFs({});

        try {
            await keymaster.unpublishCredential('mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Keymaster: No current ID');
        }
    });

    it('should throw an exception when credential invalid', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.unpublishCredential('did:test:mock49');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did');
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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did');
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

        expect(doc.didDocument!.id).toBe(groupDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

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

        expect(doc.didDocument!.id).toBe(groupDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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
        const version1 = dox1.didDocumentMetadata!.version;

        await keymaster.addGroupMember(groupDid, dataDid);
        const dox2 = await keymaster.resolveDID(groupDid);
        const version2 = dox2.didDocumentMetadata!.version;

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

        const group = (await keymaster.getGroup(groupDid))!;

        expect(group.members.length).toBe(memberCount);
    });

    it('should not add a non-DID to the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.addGroupMember(groupDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(groupDid, 100);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(groupDid, [1, 2, 3]);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(groupDid, { name: 'mock' });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.addGroupMember(groupDid, 'did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: memberId');
        }
    });

    it('should not add a member to a non-group', async () => {
        mockFs({});

        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(null, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember(100, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember([1, 2, 3], dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.addGroupMember({ name: 'mock' }, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.addGroupMember(agentDid, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: groupId');
        }

        try {
            await keymaster.addGroupMember(dataDid, agentDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: groupId');
        }
    });

    it('should not add a group to itself', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupDid = await keymaster.createGroup('group');

        try {
            await keymaster.addGroupMember(groupDid, groupDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: can't add a group to itself");
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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: can't create mutual membership");
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
        const version1 = dox1.didDocumentMetadata!.version;

        const dataDid = await keymaster.createAsset(mockAnchor);
        await keymaster.removeGroupMember(groupDid, dataDid);
        const dox2 = await keymaster.resolveDID(groupDid);
        const version2 = dox2.didDocumentMetadata!.version;

        expect(version2).toBe(version1);
    });

    it('should not remove a non-DID from the group', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const groupName = 'mockGroup';
        const groupDid = await keymaster.createGroup(groupName);

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.removeGroupMember(groupDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(groupDid, 100);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(groupDid, [1, 2, 3]);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(groupDid, { name: 'mock' });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.removeGroupMember(groupDid, 'did:mock');
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: memberId');
        }
    });

    it('should not remove a member from a non-group', async () => {
        mockFs({});

        const agentDid = await keymaster.createId('Bob');
        const mockAnchor = { name: 'mockData' };
        const dataDid = await keymaster.createAsset(mockAnchor);

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.removeGroupMember();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(null, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember(100, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember([1, 2, 3], dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid arg
            await keymaster.removeGroupMember({ name: 'mock' }, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }

        try {
            await keymaster.removeGroupMember(agentDid, dataDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: groupId');
        }

        try {
            await keymaster.removeGroupMember(dataDid, agentDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: groupId');
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

        const group = (await keymaster.getGroup(groupDid))!;

        expect(group.name).toBe(groupName);
        expect(group.members).toStrictEqual([]);
    });

    it('should return null on invalid DID', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');
        const group = (await keymaster.getGroup(did));

        expect(group).toBeNull();
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
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.getGroup();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });
});

describe('listGroups', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of groups', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        const group1 = await keymaster.createGroup('mock-1');
        const group2 = await keymaster.createGroup('mock-2');
        const group3 = await keymaster.createGroup('mock-3');
        const schema1 = await keymaster.createSchema();
        // add a bogus DID to trigger the exception case
        await keymaster.addToOwned('did:test:mock53');

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
        const asset = await keymaster.resolveAsset(did) as { poll: Poll };

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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.version = 0;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.version');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.description;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.description');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.roster;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.roster');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.options;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = ['one option'];
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.options = "not a list";
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.options');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            delete poll.deadline;
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: poll.deadline');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));
            poll.deadline = "not a date";
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.deadline');
        }

        try {
            const poll = JSON.parse(JSON.stringify(template));

            const now = new Date();
            const lastWeek = new Date();
            lastWeek.setDate(now.getDate() - 7);

            poll.deadline = lastWeek.toISOString();
            await keymaster.createPoll(poll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: poll.deadline');
        }
    });
});

describe('testPoll', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return true only for a poll DID', async () => {
        mockFs({});

        const agentDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const poll = await keymaster.createPoll(template);
        let isPoll = await keymaster.testPoll(poll);
        expect(isPoll).toBe(true);

        isPoll = await keymaster.testPoll(agentDid);
        expect(isPoll).toBe(false);

        isPoll = await keymaster.testPoll(rosterDid);
        expect(isPoll).toBe(false);

        // @ts-expect-error Testing invalid usage, missing arg
        isPoll = await keymaster.testPoll();
        expect(isPoll).toBe(false);

        // @ts-expect-error Testing invalid usage, missing arg
        isPoll = await keymaster.testPoll(100);
        expect(isPoll).toBe(false);

        isPoll = await keymaster.testPoll('did:test:mock');
        expect(isPoll).toBe(false);
    });
});

describe('listPolls', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return list of polls', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const poll1 = await keymaster.createPoll(template);
        const poll2 = await keymaster.createPoll(template);
        const poll3 = await keymaster.createPoll(template);
        const schema1 = await keymaster.createSchema();
        // add a bogus DID to trigger the exception case
        await keymaster.addToOwned('did:test:mock');

        const polls = await keymaster.listPolls();

        expect(polls.includes(poll1)).toBe(true);
        expect(polls.includes(poll2)).toBe(true);
        expect(polls.includes(poll3)).toBe(true);
        expect(polls.includes(schema1)).toBe(false);
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

    it('should return null on invalid id', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');
        const poll = await keymaster.getPoll(did);

        expect(poll).toBeNull();
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
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.getPoll();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
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
        expect(view.results!.ballots).toStrictEqual([]);
        expect(view.results!.tally.length).toBe(4);
        expect(view.results!.votes!.eligible).toBe(1);
        expect(view.results!.votes!.pending).toBe(1);
        expect(view.results!.votes!.received).toBe(0);
        expect(view.results!.final).toBe(false);
    });

    it('should throw on invalid poll id', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');

        try {
            await keymaster.viewPoll(did);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: pollId');
        }
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

    it('should allow a spoiled ballot', async () => {
        mockFs({});

        const bobDid = await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        await keymaster.addGroupMember(rosterDid, bobDid);
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);
        const ballotDid = await keymaster.votePoll(pollDid, 1, { spoil: true });
        const ballot = await keymaster.decryptJSON(ballotDid);

        const expectedBallot = {
            poll: pollDid,
            vote: 0,
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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: vote');
        }
    });

    it('should not return a ballot for an ineligible voter', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const rosterDid = await keymaster.createGroup('mockRoster');
        const template = await keymaster.pollTemplate();

        template.roster = rosterDid;

        const pollDid = await keymaster.createPoll(template);

        try {
            await keymaster.votePoll(pollDid, 5);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: voter not in roster');
        }
    });

    it('should throw on an invalid poll id', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');

        try {
            await keymaster.votePoll(did, 1);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: pollId');
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
        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.ballots![bobDid].ballot).toBe(ballotDid);
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
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: ballot');
        }
    });

    it('should throw on invalid ballot id', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);

        try {
            await keymaster.updatePoll(did)
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: ballot');
        }
    });

    it('should throw on invalid poll id', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');

        const ballot = {
            poll: bob,
            vote: 1,
        };

        const did = await keymaster.encryptJSON(ballot, bob);

        try {
            await keymaster.updatePoll(did)
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toContain('Cannot find poll related to ballot');
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

        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.results!.final).toBe(true);
        expect(poll.results!.votes!.eligible).toBe(1);
        expect(poll.results!.votes!.pending).toBe(0);
        expect(poll.results!.votes!.received).toBe(1);
        expect(poll.results!.tally.length).toBe(4);
        expect(poll.results!.tally[0]).toStrictEqual({
            vote: 0,
            option: 'spoil',
            count: 0,
        });
        expect(poll.results!.tally[1]).toStrictEqual({
            vote: 1,
            option: 'yes',
            count: 1,
        });
        expect(poll.results!.tally[2]).toStrictEqual({
            vote: 2,
            option: 'no',
            count: 0,
        });
        expect(poll.results!.tally[3]).toStrictEqual({
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
        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.results!.ballots!.length).toBe(1);
        expect(poll.results!.ballots![0]).toStrictEqual({
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

        const poll = (await keymaster.getPoll(pollDid))!;

        expect(ok).toBe(true);
        expect(poll.results).toBe(undefined);
    });

    it('should throw when non-owner tries to update pill', async () => {
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
        await keymaster.createId('Alice');

        try {
            await keymaster.unpublishPoll(pollDid);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe(`Invalid parameter: ${pollDid}`);
        }
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

        expect(doc.didDocument!.id).toBe(did);
        expect((doc.didDocumentData! as { schema: Record<string, unknown> }).schema).toStrictEqual(mockSchema);
    });

    it('should create a default schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema();
        const doc = await keymaster.resolveDID(did);

        const expectedSchema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "propertyName": {
                    "type": "string"
                }
            },
            "required": [
                "propertyName"
            ]
        };

        expect((doc.didDocumentData! as { schema: Record<string, unknown> }).schema).toStrictEqual(expectedSchema);
    });

    it('should create a simple schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createSchema(mockSchema);
        const doc = await keymaster.resolveDID(did);

        expect((doc.didDocumentData! as { schema: Record<string, unknown> }).schema).toStrictEqual(mockSchema);
    });

    it('should throw an exception on create invalid schema', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.createSchema({ mock: 'not a schema' });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: schema');
        }
    });

    it('should throw an exception on schema missing properties', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.createSchema({ "$schema": "http://json-schema.org/draft-07/schema#" });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: schema');
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

    it('should return null on invalid id', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');
        const schema = await keymaster.getSchema(did);

        expect(schema).toBeNull();
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
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: schema');
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

    it('should return false for non-schemas', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage, missing arg
        let isSchema = await keymaster.testSchema();
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema(3);
        expect(isSchema).toBe(false);

        isSchema = await keymaster.testSchema('mock7');
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema([1, 2, 3]);
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema([1, 2, 3]);
        expect(isSchema).toBe(false);

        // @ts-expect-error Testing invalid usage, invalid arg
        isSchema = await keymaster.testSchema({});
        expect(isSchema).toBe(false);
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
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.createTemplate();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: schemaId');
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

        expect(checked).toBe(16);
        expect(invalid).toBe(0);
        expect(deleted).toBe(4); // 2 credentials mentioned both in held and name lists
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
        expect(ownedRemoved).toBe(0);
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
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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
            const credential = (await keymaster.getCredential(did))!;
            expect(credential.type[0]).toBe('VerifiableCredential');
        }
    });

    it('raises an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.getCredential('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });

    it('raises an exception if DID specified that is not a credential', async () => {
        mockFs({});

        try {
            const agentDID = await keymaster.createId('Rando');
            await keymaster.getCredential(agentDID);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: did not encrypted');
        }
    });

    it('return null if not a verifiable credential', async () => {
        mockFs({});

        const bob = await keymaster.createId('Bob');
        const did = await keymaster.encryptJSON(mockJson, bob);
        const res = await keymaster.getCredential(did);

        expect(res).toBeNull();
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
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.removeCredential();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe(InvalidDIDError.type);
        }
    });

    it('raises an exception if invalid DID specified', async () => {
        mockFs({});

        try {
            await keymaster.removeCredential('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
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
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('createImage', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from image data', async () => {
        mockFs({});

        // Create a small image buffer using sharp
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();
        const cid = await generateCID(mockImage);

        const ownerDid = await keymaster.createId('Bob');
        const dataDid = await keymaster.createImage(mockImage);
        const doc = await keymaster.resolveDID(dataDid);

        expect(doc.didDocument!.id).toBe(dataDid);
        expect(doc.didDocument!.controller).toBe(ownerDid);

        const expected = {
            image: {
                cid,
                bytes: 392,
                type: 'png',
                width: 100,
                height: 100,
            }
        }
        expect(doc.didDocumentData).toStrictEqual(expected);
    });

    it('should throw an exception on invalid image buffer', async () => {
        mockFs({});

        try {
            await keymaster.createImage(Buffer.from('mock'));
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: buffer');
        }
    });
});

describe('getImage', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should return the image', async () => {
        mockFs({});

        // Create a small image buffer using sharp
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();

        await keymaster.createId('Bob');
        const did = await keymaster.createImage(mockImage);
        const image = await keymaster.getImage(did);

        expect(image).not.toBeNull();
        expect(image!.type).toStrictEqual('png');
        expect(image!.width).toStrictEqual(100);
        expect(image!.height).toStrictEqual(100);
        expect(image!.bytes).toStrictEqual(392);
    });

    it('should return null on invalid did', async () => {
        mockFs({});

        const did = await keymaster.createId('Bob');
        const image = await keymaster.getImage(did);

        expect(image).toBeNull();
    });

    it('should throw an exception on get invalid image', async () => {
        mockFs({});

        await keymaster.createId('Bob');

        try {
            await keymaster.getImage('bogus');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }
    });
});

describe('testImage', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should return true for agent DID', async () => {
        mockFs({});

        // Create a small image buffer using sharp
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();

        await keymaster.createId('Bob');
        const did = await keymaster.createImage(mockImage);
        const isImage = await keymaster.testImage(did);

        expect(isImage).toBe(true);
    });

    it('should return false for non-agent DID', async () => {
        mockFs({});

        await keymaster.createId('Bob');
        const did = await keymaster.createAsset({ name: 'mockAnchor' });
        const isImage = await keymaster.testImage(did);

        expect(isImage).toBe(false);
    });

    it('should return false if no DID specified', async () => {
        mockFs({});

        // @ts-expect-error Testing invalid usage, missing arg
        const isImage = await keymaster.testImage();
        expect(isImage).toBe(false);
    });

    it('should return false if invalid DID specified', async () => {
        mockFs({});

        const isImage = await keymaster.testImage('mock');
        expect(isImage).toBe(false);
    });
});
