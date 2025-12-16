import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import { WalletEncFile } from '@mdip/keymaster/types';
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
import { disableSubtle } from './testUtils.ts';
import { encMnemonic, decMnemonic } from '@mdip/keymaster/encryption';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;
let helper: TestHelper;
const PASSPHRASE = 'passphrase';

const MOCK_WALLET_V0_UNENCRYPTED: WalletFile = {
    "seed": {
        "mnemonic": "wp3keoeTNleruzCiTOrCgDmm6viThBq_GWdNIGzXKcS62XqtrBkm0-jDhEUoU1FvB5oWnmCqkSIhnKKeaUwPbK5ysjCHbIVrf9JAr-91FabxtX0B2dctgccg_MEVk88u6anmcFP4DAEhK5zUDXCYGgFR",
        "hdkey": {
            "xpriv": "xprv9s21ZrQH143K2JL3GWr8NVjn1XR9kpKpKX4G4g5cvYKyrGShVz7ro2zf75AYyArqm8b7VQGpbvcLXGw6Sp5sa5pAPfHMfbjsPkgiezjHSGN",
            "xpub": "xpub661MyMwAqRbcEnQWNYP8jdgWZZFeAH3fgjyrs4VEUsrxj4mr3XS7LqK8xNiAKdSdnCb5zbdxPvgu49fdGgzMgDW8AfbyP6CQjWFkYgFbNdB"
        }
    },
    "counter": 0,
    "ids": {}
}

const MOCK_WALLET_V0_WITH_IDS: WalletFile = {
    "seed": {
        "mnemonic": "WLWbs2iHBobOaKVJXViqefiTYayURf-_6gh_ndflhTACKYG8WKn8WWsQHXNiyNYjU9sfM9kOce8fyAyKjUERgdjnZv2_y6MKO9QsnQMd4XUZceKSa22QGdzBSBFOZ13Odzj9fVd4W-bfvgSZuJJqMWwNhw",
        "hdkey": {
            "xpriv": "xprv9s21ZrQH143K2v1nGQ7a6WnEH9VQv6AT7FrxSPGPfSuvgz1mxGsazcTKNk58oRWVpB2MqgaRBPXevSuRbtUziXeQT2ZYmCXnUe6JRHomHrn",
            "xpub": "xpub661MyMwAqRbcFQ6FNReaTeixqBKuKYtJUUnZEmg1DnSuZnLvVpBqYQmoE31V13nDfVQ8kMkfPKkMk1oWw77jUjXZJT22jH5dpRTvE8M84m9"
        }
    },
    "counter": 2,
    "ids": {
        "id_1": {
            "did": "did:test:z3v8AuakAd5R7WeGZUin2TtsqyxJPxouLfMEbpn5CmaNXChWq7r",
            "account": 0,
            "index": 0
        },
        "id_2": {
            "did": "did:test:z3v8AuaiAYJ263LLYdApaUmGjy8Dnhx46LU1YDUvGHAcj9Ykgxg",
            "account": 1,
            "index": 0
        }
    },
    "current": "id_2"
}

const MOCK_WALLET_V0_ENCRYPTED = {
    "salt": "SHUIyrheMkaGv7uyV+6ZHw==",
    "iv": "nW4a05eR2rxHY0T7",
    "data": "O+UlnXsCA522UwUwpFqtybIKwrJsHrVatrUJgNVBjFUk6TAdMsdGzW49WiJt+lF4iJe6ftETd1wjSretZc97gi+VzZzX0Ggba6rmXnuD189jRFg7eudCqG4y6Rgt72SYxZu3pgaEJ146Ntj+H6cAcSIfYyhNgtPmlpWBZcm68wP8YRaP5i0/mZF89md4DjjyFOv8qTLG4m42fmoCmliIeJdmBChjPdpAm8V/ZOwkULjKQPpLAjDe4uCwvgenZduSJEDyP8m1jAcwGFxcI1mcXVYunR/YruczYXGY4dPnmW03lXinOX+5SR/bs9Z23uhqoVgUgW25Rfz/5zr4YFVXBQcVQXEvLtR38KPWeuOKltvU3FbysSgIrM6WBSkJt5chfYCGg7a554lqHyeGTxrlUa8th+hXSv/LVkvl+juhq+yd85QqyX8gLhxZxw4lx5eeaU3uJ+BJ33onI2y4sr02ZU5fYOIPFKS7IGCE0KK2hv0NwNvSv8oy402m9xU+iCIr19Xs28jm61/difLh/x1g/RXQUV/07b8tZLbB6n6hBC/h+3jLexJeFIpn1C1yBY+JQopTS+NgXEZZK+HuFp3k/JjI0ImxIy/2gPSm3jRAs1f8GfLLEMdJWoseZ/laPhD0QdWPQt7oGqKTfn7G72os8gGsme4AiFtKzg0zEv3whzLvOW6W2uUXAR83cXdlKcLpju7vrjjdfrcqYxkR3VDp"
}

const MOCK_WALLET_V1: WalletFile = {
    "version": 1,
    "seed": {
        "mnemonicEnc": {
            "data": "p3gKBzVtJTflKBHSDgrMiuncBH4foJM++DyoQAZD/cVeQDCY4aFTxSC0nkylGcpi88Odq0SXkc2nAHyjA7+D6FZzbiTDdgqu3SJXznZEMCJDzHTkpLOa",
            "iv": "2mHu57FRcEERBLMv",
            "salt": "m74zOr/8etDRMoU8dnriXA==",
        },
    },
    "counter": 0,
    "ids": {}
};

const MOCK_WALLET_V1_ENCRYPTED: WalletEncFile = {
    "version": 1,
    "seed": {
        "mnemonicEnc": {
            "salt": "8c+TrInC7EJZAnwjD6k8+A==",
            "iv": "EkeweG9JHYjXr7cN",
            "data": "4MLe/4SX9unO+7DTK1KUKLBLeHuJNS4bT9yjp8L/xnLzexpobGEmRJebUuv3e0aIs4krINlkTlP4krmqkI3p/EVlu9Ap6GRNoogZR4ZC1EtKUTwgNaQ7058o0/d1LQ8wSA=="
        }
    },
    "enc": "CAKfW05djVJ2VnkLLbiBgtJpfC3x8xvc4_-M0OJBA6N7YcuXyd1F3GhifoUZ2Zdy2XGP_nGzhjS2u3NXgIM"
}

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

        expect(wallet).toEqual(
            expect.objectContaining({
                version: 1,
                counter: 0,
                seed: expect.objectContaining({
                    mnemonicEnc: {
                        salt: expect.any(String),
                        iv: expect.any(String),
                        data: expect.any(String),
                    },
                }),
                ids: {}
            })
        );
    });

    it('should return the same wallet on second load', async () => {
        const wallet1 = await keymaster.loadWallet();
        const wallet2 = await keymaster.loadWallet();

        expect(wallet2).toStrictEqual(wallet1);
    });

    it('should return null when loading non-existing encrypted wallet', async () => {
        const wallet_enc = new WalletEncrypted(wallet, PASSPHRASE);
        const check_wallet = await wallet_enc.loadWallet();
        expect(check_wallet).toBe(null);
    });

    it('should throw exception when passphrase not set', async () => {
        const wallet_enc = new WalletEncrypted(wallet, "");
        wallet_enc.saveWallet(MOCK_WALLET_V0_ENCRYPTED);

        try {
            await wallet_enc.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('KC_ENCRYPTED_PASSPHRASE not set');
        }
    });

    it('should throw exception on load with incorrect passphrase', async () => {
        const wallet_enc1 = new WalletJsonMemory();
        const ok = await wallet_enc1.saveWallet(MOCK_WALLET_V0_ENCRYPTED);
        expect(ok).toBe(true);

        try {
            const wallet_enc2 = new WalletEncrypted(wallet_enc1, 'incorrect');
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
            expect(error.message).toBe('Keymaster: Unsupported wallet version.');
        }
    });

    it('should convert encrypted v0 wallet', async () => {
        const wallet_enc = new WalletEncrypted(wallet, PASSPHRASE);
        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher, passphrase: PASSPHRASE });
        await keymaster.saveWallet(MOCK_WALLET_V0_UNENCRYPTED);

        const res = await keymaster.loadWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                counter: 0,
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object),
                }),
            })
        );
    });

    it('should upgrade a v0 unencrypted to v1', async () => {
        const wallet_enc = new WalletEncrypted(wallet, PASSPHRASE);
        await wallet_enc.saveWallet(MOCK_WALLET_V0_UNENCRYPTED);

        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher, passphrase: PASSPHRASE });
        const res = await keymaster.loadWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                counter: 0,
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object),
                }),
            })
        );
    });

    it('should upgrade a v0 encrypted to v1 without encryption wrapper', async () => {
        const wallet_enc = new WalletEncrypted(wallet, PASSPHRASE);
        await wallet_enc.saveWallet(MOCK_WALLET_V0_ENCRYPTED);

        const keymaster = new Keymaster({ gatekeeper, wallet: wallet_enc, cipher, passphrase: PASSPHRASE });
        const res = await keymaster.loadWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                counter: 0,
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object),
                }),
            })
        );
    });

    it('should load a v1 encrypted wallet without hdkey', async () => {
        await wallet.saveWallet(MOCK_WALLET_V1_ENCRYPTED);
        const res = await keymaster.loadWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                counter: 0,
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object)
                })
            })
        );
        expect(res.seed?.hdkey).toBeUndefined();
    });

    it('should load a v1 encrypted wallet from cache without hdkey', async () => {
        await wallet.saveWallet(MOCK_WALLET_V1_ENCRYPTED);
        // prime cache
        await keymaster.loadWallet();
        // load from cache
        const res = await keymaster.loadWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                counter: 0,
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object)
                })
            })
        );
        expect(res.seed?.hdkey).toBeUndefined();
    });

    it('should throw on unsupported wallet version', async () => {
        let clone = structuredClone(MOCK_WALLET_V1_ENCRYPTED);
        delete clone.seed.mnemonicEnc;
        await wallet.saveWallet(clone);

        try {
            await keymaster.loadWallet();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Unsupported wallet version.');
        }
    });
});

describe('saveWallet', () => {
    it('test saving directly on the unencrypted wallet', async () => {
        const ok = await wallet.saveWallet(MOCK_WALLET_V1);
        expect(ok).toBe(true);
    });

    it('test saving directly on the encrypted wallet', async () => {
        const wallet_enc = new WalletEncrypted(wallet, PASSPHRASE);
        const ok = await wallet_enc.saveWallet(MOCK_WALLET_V1);

        expect(ok).toBe(true);
    });

    it('should save a wallet', async () => {
        const ok = await keymaster.saveWallet(MOCK_WALLET_V1);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(MOCK_WALLET_V1);
    });

    it('should ignore overwrite flag if unnecessary', async () => {
        const ok = await keymaster.saveWallet(MOCK_WALLET_V1, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(MOCK_WALLET_V1);
    });

    it('should overwrite an existing wallet', async () => {
        const mockWallet = MOCK_WALLET_V1;
        mockWallet.counter = 1;

        await keymaster.saveWallet(MOCK_WALLET_V1);
        const ok = await keymaster.saveWallet(mockWallet);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should not overwrite an existing wallet if specified', async () => {
        const mockWallet = MOCK_WALLET_V1;
        mockWallet.counter = 1;

        await keymaster.saveWallet(MOCK_WALLET_V1);
        const ok = await keymaster.saveWallet(mockWallet, false);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(false);
        expect(wallet).toStrictEqual(MOCK_WALLET_V1);
    });

    it('should overwrite an existing wallet in a loop', async () => {
        for (let i = 0; i < 10; i++) {
            const mockWallet = MOCK_WALLET_V1;
            mockWallet.counter = i + 1;

            const ok = await keymaster.saveWallet(mockWallet);
            const wallet = await keymaster.loadWallet();

            expect(ok).toBe(true);
            expect(wallet).toStrictEqual(mockWallet);
        }
    });

    it('should not overwrite an existing wallet if specified', async () => {
        const mockWallet = MOCK_WALLET_V1;
        mockWallet.counter = 2;

        await keymaster.saveWallet(MOCK_WALLET_V1);
        const ok = await keymaster.saveWallet(mockWallet, false);
        const walletData = await keymaster.loadWallet();

        expect(ok).toBe(false);
        expect(walletData).toStrictEqual(MOCK_WALLET_V1);
    });

    it('encrypted wallet should return unencrypted wallet', async () => {
        const wallet_enc = new WalletEncrypted(wallet, PASSPHRASE);
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

    it('should upgrade a v0 wallet to v1', async () => {
        const ok = await keymaster.saveWallet(MOCK_WALLET_V0_UNENCRYPTED);
        expect(ok).toBe(true);

        const res = await wallet.loadWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                enc: expect.any(String),
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object),
                }),
            })
        );
    });

    it('v0 upgrade must not use stale _hdkeyCache', async () => {
        await keymaster.newWallet(undefined, true);
        expect(
            await keymaster.saveWallet(MOCK_WALLET_V0_UNENCRYPTED, true)
        ).toBe(true);
    });

    it('should encrypt an unencrypted v1 wallet contents and remove hdkey', async () => {
        const ok = await keymaster.saveWallet(MOCK_WALLET_V1);
        expect(ok).toBe(true);

        const res = await wallet.loadWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                enc: expect.any(String),
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object),
                }),
            })
        );
    });

    it('should save a v1 encrypted wallet', async () => {
        const ok = await keymaster.saveWallet(MOCK_WALLET_V1_ENCRYPTED, true);
        expect(ok).toBe(true);
    });

    it('should throw on incorrect passphrase', async () => {
        const wallet = new WalletJsonMemory();
        const keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'incorrect' });

        try {
            await keymaster.saveWallet(MOCK_WALLET_V1_ENCRYPTED, true);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Incorrect passphrase.');
        }
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

describe('exportEncryptedWallet', () => {
    it('should export the wallet in encrypted form', async () => {
        const res = await keymaster.exportEncryptedWallet();
        expect(res).toEqual(
            expect.objectContaining({
                version: 1,
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object)
                }),
                enc: expect.any(String)
            })
        );
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

        // Update the retrieved timestamp to match any value
        bank1.didResolutionMetadata!.retrieved = expect.any(String);

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

        expect(recovered).toEqual(
            expect.objectContaining({
                counter: wallet.counter,
                version: wallet.version,
                seed: {
                    mnemonicEnc: expect.any(Object),
                },
                current: wallet.current,
                ids: wallet.ids
            })
        );
    });

    it('should recover over existing wallet', async () => {
        await keymaster.createId('Bob');
        await keymaster.loadWallet();
        await keymaster.backupWallet();
        await keymaster.createId('Alice');

        // Recover over existing wallet
        const recovered = await keymaster.recoverWallet();

        expect(recovered).toEqual(
            expect.objectContaining({
                version: 1,
                counter: 1,
                current: "Bob",
                seed: expect.objectContaining({
                    mnemonicEnc: expect.any(Object),
                }),
                ids: expect.objectContaining({
                    Bob: expect.objectContaining({
                        account: 0,
                        did: expect.any(String),
                        index: 0
                    }),
                })
            })
        );
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

        expect(recovered).toEqual(
            expect.objectContaining({
                counter: wallet.counter,
                version: wallet.version,
                seed: {
                    mnemonicEnc: expect.any(Object),
                },
                current: wallet.current,
                ids: wallet.ids
            })
        );
    });

    it('should recover v0 wallet from seed bank', async () => {
        await keymaster.saveWallet(MOCK_WALLET_V0_WITH_IDS);
        const mnemonic = await keymaster.decryptMnemonic();
        await keymaster.backupWallet(undefined, MOCK_WALLET_V0_WITH_IDS);

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(recovered).toBeDefined();
        expect(recovered.ids).toStrictEqual(MOCK_WALLET_V0_WITH_IDS.ids);
    });

    it('should recover wallet from backup DID', async () => {
        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();
        const mnemonic = await keymaster.decryptMnemonic();
        const did = await keymaster.backupWallet();

        // Recover wallet from mnemonic and recovery DID
        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet(did);

        expect(recovered).toEqual(
            expect.objectContaining({
                counter: wallet.counter,
                version: wallet.version,
                seed: {
                    mnemonicEnc: expect.any(Object),
                },
                current: wallet.current,
                ids: wallet.ids
            })
        );
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
});

describe('WalletEncrypted', () => {
    it('returns the plain wallet when base wallet is not encrypted', async () => {
        const base = new WalletJsonMemory();
        const plain: WalletFile = { seed: {} as Seed, counter: 42, ids: {}, names: { foo: 'did:test:abc' } };
        await base.saveWallet(plain, true);
        const wrapped = new WalletEncrypted(base, PASSPHRASE);
        const loaded = await wrapped.loadWallet();

        expect(loaded).toStrictEqual(plain);
    });
});

describe('updateWallet', () => {
    it('should throw when no wallet has been created', async () => {
        const test = new WalletJsonMemory();
        try {
            await test.updateWallet(() => { });
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('updateWallet: no wallet found to update');
        }
    });
});

describe('no WebCrypto subtle', () => {
    let restore: () => void;

    beforeAll(async () => {
        restore = disableSubtle();
    });

    afterAll(async () => {
        restore();
    });

    it('encMnemonic will throw without crypto subtle', async () => {
        try {
            await encMnemonic("", PASSPHRASE);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Web Cryptography API not available');
        }
    });

    it('decMnemonic will throw without crypto subtle', async () => {
        try {
            await decMnemonic(MOCK_WALLET_V0_ENCRYPTED, PASSPHRASE);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Web Cryptography API not available');
        }
    });
});
