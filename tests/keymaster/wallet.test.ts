import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import {
    EncryptedWallet,
    Seed,
    WalletFile,
} from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import WalletEncrypted from '@mdip/keymaster/wallet/json-enc';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { MdipDocument } from "@mdip/gatekeeper/types";
import { TestHelper } from './helper.ts';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;
let helper: TestHelper;
const PASSPHRASE = 'passphrase';

const MOCK_WALLET: WalletFile = {
    "version": 1,
    "seed": {
        "mnemonicEnc": {
            "data": "p3gKBzVtJTflKBHSDgrMiuncBH4foJM++DyoQAZD/cVeQDCY4aFTxSC0nkylGcpi88Odq0SXkc2nAHyjA7+D6FZzbiTDdgqu3SJXznZEMCJDzHTkpLOa",
            "iv": "2mHu57FRcEERBLMv",
            "salt": "m74zOr/8etDRMoU8dnriXA==",
        }
    },
    "counter": 0,
    "ids": {}
};

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
    helper = new TestHelper(keymaster);
});

describe('loadWallet', () => {
    it('should create a wallet on first load', async () => {
        const wallet = await keymaster.loadWallet();

        expect(wallet.seed!.mnemonicEnc!.salt.length > 0).toBe(true);
        expect(wallet.seed!.mnemonicEnc!.iv.length > 0).toBe(true);
        expect(wallet.seed!.mnemonicEnc!.data.length > 0).toBe(true);
        expect(wallet.counter).toBe(0);
        expect(wallet.ids).toStrictEqual({});
    });

    it('should return the same wallet on second load', async () => {
        const wallet1 = await keymaster.loadWallet();
        const wallet2 = await keymaster.loadWallet();

        expect(wallet2).toStrictEqual(wallet1);
    });

    it('should return null when loading non-existing encrypted wallet', async () => {
        const wallet_enc = new WalletEncrypted(wallet, 'passphrase');
        const check_wallet = await wallet_enc.loadWallet();
        expect(check_wallet).toBe(null);
    });

    it('should throw exception when passphrase not set', async () => {
        const wallet_enc = new WalletEncrypted(wallet, "");

        try {
            await wallet_enc.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('KC_ENCRYPTED_PASSPHRASE not set');
        }
    });

    it('should throw exception on load with incorrect passphrase', async () => {
        const wallet_enc1 = new WalletEncrypted(wallet, 'passphrase');
        const ok = await wallet_enc1.saveWallet(MOCK_WALLET);
        expect(ok).toBe(true);

        try {
            const wallet_enc2 = new WalletEncrypted(wallet, 'incorrect');
            await wallet_enc2.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Incorrect passphrase.');
        }
    });

    it('should throw exception saving an encrypted wallet', async () => {
        const mockWallet: EncryptedWallet = { salt: "", iv: "", data: "" };

        try {
            await keymaster.saveWallet(mockWallet);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: saveWallet: Unsupported wallet version');
        }
    });

    it('should throw exception on encrypted wallet', async () => {
        const mockWallet: EncryptedWallet = { salt: "", iv: "", data: "" };
        await wallet.saveWallet(mockWallet);

        try {
            await keymaster.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Wallet is encrypted');
        }
    });
});

describe('saveWallet', () => {
    it('test saving directly on the unencrypted wallet', async () => {
        const ok = await wallet.saveWallet(MOCK_WALLET);
        expect(ok).toBe(true);
    });

    it('test saving directly on the encrypted wallet', async () => {
        const wallet_enc = new WalletEncrypted(wallet, 'passphrase');
        const ok = await wallet_enc.saveWallet(MOCK_WALLET);

        expect(ok).toBe(true);
    });

    it('should save a wallet', async () => {
        const ok = await keymaster.saveWallet(MOCK_WALLET);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(MOCK_WALLET);
    });

    it('should ignore overwrite flag if unnecessary', async () => {
        const ok = await keymaster.saveWallet(MOCK_WALLET, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(MOCK_WALLET);
    });

    it('should overwrite an existing wallet', async () => {
        const mockWallet = MOCK_WALLET;
        mockWallet.counter = 1;

        await keymaster.saveWallet(MOCK_WALLET);
        const ok = await keymaster.saveWallet(mockWallet);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should not overwrite an existing wallet if specified', async () => {
        const mockWallet = MOCK_WALLET;
        mockWallet.counter = 1;

        await keymaster.saveWallet(MOCK_WALLET);
        const ok = await keymaster.saveWallet(mockWallet, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(false);
        expect(wallet).toStrictEqual(MOCK_WALLET);
    });

    it('should overwrite an existing wallet in a loop', async () => {
        for (let i = 0; i < 10; i++) {
            const mockWallet = MOCK_WALLET;
            mockWallet.counter = i + 1;

            const ok = await keymaster.saveWallet(mockWallet);
            const wallet = await keymaster.loadWallet();

            expect(ok).toBe(true);
            expect(wallet).toStrictEqual(mockWallet);
        }
    });

    it('should not overwrite an existing wallet if specified', async () => {
        const mockWallet = MOCK_WALLET;
        mockWallet.counter = 2;

        await keymaster.saveWallet(MOCK_WALLET);
        const ok = await keymaster.saveWallet(mockWallet, false);
        const walletData = await keymaster.loadWallet();

        expect(ok).toBe(false);
        expect(walletData).toStrictEqual(MOCK_WALLET);
    });

    it('wallet should throw when passphrase not set', async () => {
        const wallet_enc = new WalletEncrypted(wallet, "");

        try {
            await wallet_enc.saveWallet(MOCK_WALLET);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('KC_ENCRYPTED_PASSPHRASE not set');
        }
    });

    it('encrypted wallet should return unencrypted wallet', async () => {
        const wallet_enc = new WalletEncrypted(wallet, 'passphrase');
        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher, passphrase: PASSPHRASE });
        const testWallet = await keymaster.loadWallet();
        const expectedWallet = await keymaster.loadWallet();

        expect(testWallet).toStrictEqual(expectedWallet);
    });

    it('should save augmented wallet', async () => {
        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();

        wallet.ids['Bob'].icon = 'smiley';
        wallet.metadata = { foo: 'bar' };
        await keymaster.saveWallet(wallet, true);

        const wallet2 = await keymaster.loadWallet();

        expect(wallet).toStrictEqual(wallet2);
    });
});

describe('decryptMnemonic', () => {
    it('should return 12 words', async () => {
        const wallet = await keymaster.loadWallet();
        const mnemonic = await keymaster.decryptMnemonic();

        expect(mnemonic !== wallet.seed!.mnemonic).toBe(true);

        // Split the mnemonic into words
        const words = mnemonic.split(' ');
        expect(words.length).toBe(12);
    });
});

describe('updateSeedBank', () => {
    it('should throw error on missing DID', async () => {
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
    it('should overwrite an existing wallet when allowed', async () => {
        const wallet1 = await keymaster.loadWallet();
        await keymaster.newWallet(undefined, true);
        const wallet2 = await keymaster.loadWallet();

        expect(wallet1.seed!.mnemonicEnc !== wallet2.seed!.mnemonicEnc).toBe(true);
    });

    it('should not overwrite an existing wallet by default', async () => {
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
        const mnemonic1 = cipher.generateMnemonic();
        await keymaster.newWallet(mnemonic1);
        const mnemonic2 = await keymaster.decryptMnemonic();

        expect(mnemonic1 === mnemonic2).toBe(true);
    });

    it('should throw exception on invalid mnemonic', async () => {
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
    it('should create a deterministic seed bank ID', async () => {
        const bank1 = await keymaster.resolveSeedBank();
        const bank2 = await keymaster.resolveSeedBank();

        expect(bank1).toStrictEqual(bank2);
    });
});

describe('backupWallet', () => {
    it('should return a valid DID', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        const doc = await keymaster.resolveDID(did);

        expect(did === doc.didDocument!.id).toBe(true);
    });

    it('should store backup in seed bank', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        const bank = await keymaster.resolveSeedBank();

        expect(did === (bank.didDocumentData! as { wallet: string }).wallet).toBe(true);
    });
});

describe('recoverWallet', () => {
    it('should recover wallet from seed bank', async () => {
        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();
        const mnemonic = await keymaster.decryptMnemonic();
        await keymaster.backupWallet();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(wallet).toStrictEqual(recovered);
    });

    it('should recover augmented wallet from seed bank', async () => {
        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();
        const mnemonic = await keymaster.decryptMnemonic();

        wallet.ids['Bob'].icon = 'smiley';
        wallet.metadata = { foo: 'bar' };
        await keymaster.saveWallet(wallet, true);
        await keymaster.backupWallet();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(wallet).toStrictEqual(recovered);
    });

    it('should recover wallet from backup DID', async () => {
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
        await keymaster.createId('Bob');
        const mnemonic = await keymaster.decryptMnemonic();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(recovered.ids).toStrictEqual({});
    });

    it('should do nothing if backup DID is invalid', async () => {
        const agentDID = await keymaster.createId('Bob');
        const mnemonic = await keymaster.decryptMnemonic();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet(agentDID);

        expect(recovered.ids).toStrictEqual({});
    });
});

describe('checkWallet', () => {
    it('should report no problems with empty wallet', async () => {
        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(0);
        expect(invalid).toBe(0);
        expect(deleted).toBe(0);
    });

    it('should report no problems with wallet with only one ID', async () => {
        await keymaster.createId('Alice');

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(1);
        expect(invalid).toBe(0);
        expect(deleted).toBe(0);
    });

    it('should detect revoked ID', async () => {
        const agentDID = await keymaster.createId('Alice');
        await keymaster.revokeDID(agentDID);

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(1);
        expect(invalid).toBe(0);
        expect(deleted).toBe(1);
    });

    it('should detect removed DIDs', async () => {
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
        await keymaster.createId('Alice');
        await keymaster.addToOwned('did:test:mock1');
        await keymaster.addToHeld('did:test:mock2');

        const { checked, invalid, deleted } = await keymaster.checkWallet();

        expect(checked).toBe(3);
        expect(invalid).toBe(2);
        expect(deleted).toBe(0);
    });

    it('should detect revoked credentials in wallet', async () => {
        const credentials = await helper.setupCredentials();
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
    it('should report no problems with empty wallet', async () => {
        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(0);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(0);
    });

    it('should report no problems with wallet with only one ID', async () => {
        await keymaster.createId('Alice');
        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(0);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(0);
    });

    it('should remove revoked ID', async () => {
        const agentDID = await keymaster.createId('Alice');
        await keymaster.revokeDID(agentDID);

        const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } = await keymaster.fixWallet();

        expect(idsRemoved).toBe(1);
        expect(ownedRemoved).toBe(0);
        expect(heldRemoved).toBe(0);
        expect(namesRemoved).toBe(0);
    });

    it('should remove deleted DIDs', async () => {
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
        const credentials = await helper.setupCredentials();
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

    describe('WalletEncrypted passthrough for unencrypted data', () => {
        it('returns the plain wallet when base wallet is not encrypted', async () => {
            const base = new WalletJsonMemory();
            const plain: WalletFile = { seed: {} as Seed, counter: 42, ids: {}, names: { foo: 'did:test:abc' } };
            await base.saveWallet(plain, true);
            const wrapped = new WalletEncrypted(base, 'passphrase');
            const loaded = await wrapped.loadWallet();

            expect(loaded).toStrictEqual(plain);
        });
    });

    describe('updateWallet', () => {
        it('should throw when no wallet has been created', async () => {
            const test = new WalletJsonMemory();
            try {
                await test.updateWallet(() => {});
                throw new ExpectedExceptionError();
            } catch (error: any) {
                expect(error.message).toBe('updateWallet: no wallet found to update');
            }
        });
    });
});
