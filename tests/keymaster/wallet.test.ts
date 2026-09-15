import { jest } from '@jest/globals';
import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import {
    WalletEncFile,
    WalletFile,
} from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
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

    it('should throw exception on load with incorrect passphrase', async () => {
        await wallet.saveWallet(MOCK_WALLET_V1_ENCRYPTED);
        const keymasterIncorrect = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'incorrect' });
        await expect(keymasterIncorrect.loadWallet()).rejects.toThrow('Keymaster: Incorrect passphrase.');
    });

    it('should throw exception saving a deprecated encrypted wallet', async () => {
        const mockWallet = { salt: "", iv: "", data: "" };

        try {
            // @ts-expect-error Testing unsupported historical wallet shape
            await keymaster.saveWallet(mockWallet);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            expect(error.message).toBe('Keymaster: Unsupported wallet version.');
        }
    });

    it('should upgrade a v0 unencrypted wallet to v1', async () => {
        await wallet.saveWallet(MOCK_WALLET_V0_UNENCRYPTED as any);

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
        expect(await wallet.loadWallet()).toEqual(expect.objectContaining({
            version: 1,
            enc: expect.any(String),
        }));
    });

    it('should throw on deprecated encrypted v0 wallet', async () => {
        // @ts-expect-error Testing unsupported historical wallet shape
        await wallet.saveWallet(MOCK_WALLET_V0_ENCRYPTED, true);

        await expect(keymaster.loadWallet()).rejects.toThrow('Keymaster: Unsupported wallet version.');
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

    it('should save augmented wallet', async () => {
        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();

        wallet.ids['Bob'].icon = 'smiley';
        wallet.metadata = { foo: 'bar' };
        await keymaster.saveWallet(wallet, true);

        const wallet2 = await keymaster.loadWallet();

        expect(wallet).toStrictEqual(wallet2);
    });

    it('should restore a decrypted wallet using its own seed', async () => {
        const alice = await keymaster.createId('Alice');
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const mnemonic = await keymaster.decryptMnemonic();
        const keypair = await keymaster.fetchKeyPair();

        await keymaster.newWallet(undefined, true);
        await keymaster.createId('Bob');

        expect(await keymaster.saveWallet(original)).toBe(true);
        expect(await keymaster.decryptMnemonic()).toBe(mnemonic);
        expect(await keymaster.fetchKeyPair()).toStrictEqual(keypair);

        await keymaster.addName('friend', alice);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        expect(await restarted.fetchKeyPair()).toStrictEqual(keypair);
    });

    it('should preserve keys when restoring a different wallet is refused', async () => {
        const replacement = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        await keymaster.newWallet(undefined, true);
        const alice = await keymaster.createId('Alice');
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const stored = await wallet.loadWallet();
        const keypair = await keymaster.fetchKeyPair();

        expect(await keymaster.saveWallet(replacement, false)).toBe(false);
        expect(await keymaster.loadWallet()).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        expect(await keymaster.fetchKeyPair()).toStrictEqual(keypair);

        await keymaster.addName('friend', alice);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        expect(await restarted.fetchKeyPair()).toStrictEqual(keypair);
    });

    it('should preserve active keys when replacement decryption fails', async () => {
        const replacement = await keymaster.exportEncryptedWallet();
        await keymaster.newWallet(undefined, true);
        const alice = await keymaster.createId('Alice');
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const stored = await wallet.loadWallet();
        const keypair = await keymaster.fetchKeyPair();
        jest.spyOn(cipher, 'decryptMessage').mockImplementationOnce(() => {
            throw new Error('decryption failed');
        });

        await expect(keymaster.saveWallet(replacement)).rejects.toThrow('decryption failed');
        expect(await keymaster.loadWallet()).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        expect(await keymaster.fetchKeyPair()).toStrictEqual(keypair);

        await keymaster.addName('friend', alice);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        expect(await restarted.fetchKeyPair()).toStrictEqual(keypair);
    });

    it.each(['ciphertext', 'mnemonic', 'JSON', 'version'])(
        'should preserve the stored and active wallet after restoring invalid %s', async (invalid) => {
            const alice = await keymaster.createId('Alice');
            const active = await keymaster.loadWallet();
            const original = JSON.parse(JSON.stringify(active));
            const stored = await wallet.loadWallet();
            const keypair = await keymaster.fetchKeyPair();
            const replacement = JSON.parse(JSON.stringify(await keymaster.exportEncryptedWallet()));

            if (invalid === 'ciphertext') {
                replacement.enc = 'invalid ciphertext';
            } else if (invalid === 'mnemonic') {
                replacement.seed.mnemonicEnc!.data = 'invalid ciphertext';
            } else {
                const mnemonic = await keymaster.decryptMnemonic();
                const hdkey = cipher.generateHDKey(mnemonic);
                const keys = cipher.generateJwk(hdkey.privateKey!);
                replacement.enc = cipher.encryptMessage(
                    keys.publicJwk, keys.privateJwk,
                    invalid === 'JSON' ? 'invalid JSON' : JSON.stringify({ version: 999, counter: 0, ids: {} })
                );
            }

            const save = jest.spyOn(wallet, 'saveWallet');
            await expect(keymaster.saveWallet(replacement)).rejects.toThrow();
            expect(save).not.toHaveBeenCalled();
            expect(await keymaster.loadWallet()).toBe(active);
            expect(active).toStrictEqual(original);
            expect(await wallet.loadWallet()).toStrictEqual(stored);
            expect(await keymaster.fetchKeyPair()).toStrictEqual(keypair);

            const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
            expect(await restarted.loadWallet()).toStrictEqual(original);
            expect(await restarted.fetchKeyPair()).toStrictEqual(keypair);

            await keymaster.addName('friend', alice);
            const afterSave = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
            expect(await afterSave.loadWallet()).toStrictEqual(await keymaster.loadWallet());
            expect(await afterSave.fetchKeyPair()).toStrictEqual(keypair);
        }
    );

    it.each([
        ['null', null],
        ['boolean', true],
        ['number', 1],
        ['string', 'wallet'],
        ['array', []],
        ['missing fields', {}],
        ['missing counter', { ids: {} }],
        ['string counter', { counter: '0', ids: {} }],
        ['negative counter', { counter: -1, ids: {} }],
        ['fractional counter', { counter: 0.5, ids: {} }],
        ['unsafe counter', { counter: Number.MAX_SAFE_INTEGER + 1, ids: {} }],
        ['missing ids', { counter: 0 }],
        ['null ids', { counter: 0, ids: null }],
        ['array ids', { counter: 0, ids: [] }],
        ['string ids', { counter: 0, ids: 'Alice' }],
        ['null identity', { counter: 1, ids: { Alice: null } }],
        ['string identity', { counter: 1, ids: { Alice: 'invalid' } }],
        ['array identity', { counter: 1, ids: { Alice: [] } }],
        ['missing DID', { counter: 1, ids: { Alice: { account: 0, index: 0 } } }],
        ['non-string DID', { counter: 1, ids: { Alice: { did: 1, account: 0, index: 0 } } }],
        ['empty DID', { counter: 1, ids: { Alice: { did: '', account: 0, index: 0 } } }],
        ['missing account', { counter: 1, ids: { Alice: { did: 'did:test:example', index: 0 } } }],
        ['negative account', { counter: 1, ids: { Alice: { did: 'did:test:example', account: -1, index: 0 } } }],
        ['missing index', { counter: 1, ids: { Alice: { did: 'did:test:example', account: 0 } } }],
        ['negative index', { counter: 1, ids: { Alice: { did: 'did:test:example', account: 0, index: -1 } } }],
        ['seed override', { counter: 0, ids: {}, seed: { mnemonicEnc: { salt: '', iv: '', data: '' } } }],
        ['version override', { counter: 0, ids: {}, version: 1 }],
        ['nested ciphertext', { counter: 0, ids: {}, enc: 'ciphertext' }],
    ])('should reject %s wallet data before saving', async (_description, data) => {
        await keymaster.createId('Alice');
        const active = await keymaster.loadWallet();
        const original = JSON.parse(JSON.stringify(active));
        const stored = await wallet.loadWallet();
        const keys = await keymaster.fetchKeyPair();
        const backup = new Keymaster({ gatekeeper, wallet: new WalletJsonMemory(), cipher, passphrase: PASSPHRASE });
        const replacement = await backup.exportEncryptedWallet();
        const rootKeys = await backup.hdKeyPair();
        replacement.enc = cipher.encryptMessage(rootKeys.publicJwk, rootKeys.privateJwk, JSON.stringify(data));
        const save = jest.spyOn(wallet, 'saveWallet');

        await expect(keymaster.saveWallet(replacement)).rejects.toThrow('Invalid wallet data');
        expect(save).not.toHaveBeenCalled();
        expect(await keymaster.loadWallet()).toBe(active);
        expect(active).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        const derive = jest.spyOn(cipher, 'generateHDKey');
        expect(await keymaster.fetchKeyPair()).toStrictEqual(keys);
        expect(derive).not.toHaveBeenCalled();

        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(original);
        expect(await restarted.fetchKeyPair()).toStrictEqual(keys);
    });

    it.each(['v0', 'v1'])('should validate an unencrypted %s restore before saving', async (version) => {
        await keymaster.createId('Alice');
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const stored = await wallet.loadWallet();
        const replacement = JSON.parse(JSON.stringify(version === 'v0' ? MOCK_WALLET_V0_UNENCRYPTED : original));
        replacement.ids = null;
        const save = jest.spyOn(wallet, 'saveWallet');

        await expect(keymaster.saveWallet(replacement)).rejects.toThrow('Invalid wallet data');
        expect(save).not.toHaveBeenCalled();
        expect(await keymaster.loadWallet()).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(original);
    });

    it('should not write a legacy restore before validation', async () => {
        await keymaster.createId('Alice');
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const stored = await wallet.loadWallet();
        const save = jest.spyOn(wallet, 'saveWallet');
        const decrypt = cipher.decryptMessage.bind(cipher);
        jest.spyOn(cipher, 'decryptMessage')
            .mockImplementationOnce(decrypt)
            .mockImplementationOnce(() => { throw new Error('decryption failed'); });

        await expect(keymaster.saveWallet(MOCK_WALLET_V0_UNENCRYPTED)).rejects.toThrow('decryption failed');
        expect(save).not.toHaveBeenCalled();
        expect(await keymaster.loadWallet()).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(original);
    });

    it.each(['refusal', 'exception', 'success'])(
        'should activate restored wallet keys only after storage %s', async (result) => {
            await keymaster.createId('Bob');
            const replacement = await keymaster.exportEncryptedWallet();
            const restored = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
            const restoredKeys = await keymaster.fetchKeyPair();
            await keymaster.newWallet(undefined, true);
            await keymaster.createId('Alice');
            const active = await keymaster.loadWallet();
            const stored = await wallet.loadWallet();
            const keys = await keymaster.fetchKeyPair();
            const derive = jest.spyOn(cipher, 'generateHDKey');
            const persist = wallet.saveWallet.bind(wallet);
            jest.spyOn(wallet, 'saveWallet').mockImplementationOnce(async (candidate, overwrite) => {
                expect(await keymaster.loadWallet()).toBe(active);
                derive.mockClear();
                expect(await keymaster.fetchKeyPair()).toStrictEqual(keys);
                expect(derive).not.toHaveBeenCalled();
                if (result === 'exception') {
                    throw new Error('storage failed');
                }
                return persist(candidate, overwrite);
            });

            const save = keymaster.saveWallet(replacement, result !== 'refusal');
            if (result === 'exception') {
                await expect(save).rejects.toThrow('storage failed');
            } else {
                expect(await save).toBe(result === 'success');
            }
            const expected = result === 'success' ? restored : active;
            const expectedKeys = result === 'success' ? restoredKeys : keys;
            derive.mockClear();
            expect(await keymaster.loadWallet()).toStrictEqual(expected);
            expect(await keymaster.fetchKeyPair()).toStrictEqual(expectedKeys);
            expect(derive).not.toHaveBeenCalled();
            expect(await wallet.loadWallet()).toStrictEqual(result === 'success' ? replacement : stored);
            const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
            expect(await restarted.loadWallet()).toStrictEqual(expected);
            expect(await restarted.fetchKeyPair()).toStrictEqual(expectedKeys);
        }
    );

    it('should upgrade a v0 wallet to v1', async () => {
        const save = jest.spyOn(wallet, 'saveWallet');
        const ok = await keymaster.saveWallet(MOCK_WALLET_V0_UNENCRYPTED);
        expect(ok).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);

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
        const alice = await keymaster.createId('Alice');
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const stored = await wallet.loadWallet();
        const keypair = await keymaster.fetchKeyPair();

        await expect(keymaster.newWallet()).rejects.toThrow('Keymaster: save wallet failed');
        expect(await keymaster.loadWallet()).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        expect(await keymaster.fetchKeyPair()).toStrictEqual(keypair);

        await keymaster.addName('friend', alice);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        expect(await restarted.fetchKeyPair()).toStrictEqual(keypair);
    });

    it.each(['refuses', 'throws'])('should preserve keys when storage %s a replacement wallet', async (failure) => {
        const alice = await keymaster.createId('Alice');
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const stored = await wallet.loadWallet();
        const keypair = await keymaster.fetchKeyPair();
        const save = jest.spyOn(wallet, 'saveWallet');

        if (failure === 'refuses') {
            save.mockResolvedValueOnce(false);
        } else {
            save.mockRejectedValueOnce(new Error('storage failed'));
        }

        await expect(keymaster.newWallet(undefined, true)).rejects.toThrow(
            failure === 'refuses' ? 'Keymaster: save wallet failed' : 'storage failed'
        );
        expect(await keymaster.loadWallet()).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        expect(await keymaster.fetchKeyPair()).toStrictEqual(keypair);

        await keymaster.addName('friend', alice);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        expect(await restarted.fetchKeyPair()).toStrictEqual(keypair);
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

    it('should ignore the configured DID prefix', async () => {
        const legacyBank = await keymaster.resolveSeedBank();
        const prefixedKeymaster = new Keymaster({
            gatekeeper,
            wallet,
            cipher,
            didPrefix: 'did:mdip',
            passphrase: PASSPHRASE,
        });
        const prefixedBank = await prefixedKeymaster.resolveSeedBank();

        expect(prefixedBank.didDocument!.id).toBe(legacyBank.didDocument!.id);
        expect(prefixedBank.mdip).not.toHaveProperty('prefix');
    });
});

describe('backupWallet', () => {
    it('should return a valid DID', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        const doc = await keymaster.resolveDID(did);

        expect(did === doc.didDocument!.id).toBe(true);
    });

    it('should create backups with the configured DID prefix', async () => {
        const didPrefix = 'did:mdip';
        const prefixedKeymaster = new Keymaster({
            gatekeeper,
            wallet,
            cipher,
            didPrefix,
            passphrase: PASSPHRASE,
        });
        await prefixedKeymaster.createId('Bob');

        const did = await prefixedKeymaster.backupWallet();
        const doc = await prefixedKeymaster.resolveDID(did);

        expect(did.startsWith(`${didPrefix}:`)).toBe(true);
        expect(doc.mdip!.prefix).toBe(didPrefix);
    });

    it('should store backup in seed bank', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        const bank = await keymaster.resolveSeedBank();

        expect(did === (bank.didDocumentData! as { wallet: string }).wallet).toBe(true);
    });
});

describe('recoverWallet', () => {
    it('should reuse recovered keys for lookups and subsequent wallet saves', async () => {
        const alice = await keymaster.createId('Alice');
        const keypair = await keymaster.fetchKeyPair();
        const did = await keymaster.backupWallet();

        await keymaster.recoverWallet(did);
        const derive = jest.spyOn(cipher, 'generateHDKey');

        for (let i = 0; i < 5; i++) {
            expect(await keymaster.fetchKeyPair()).toStrictEqual(keypair);
        }
        await keymaster.addName('friend', alice);
        expect(derive).not.toHaveBeenCalled();

        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        expect(await restarted.fetchKeyPair()).toStrictEqual(keypair);
    });

    it.each(['refusal', 'exception'])('should preserve cached keys on a recovery storage %s', async (failure) => {
        await keymaster.createId('Alice');
        const did = await keymaster.backupWallet();
        const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        const stored = await wallet.loadWallet();
        const save = jest.spyOn(wallet, 'saveWallet');

        if (failure === 'refusal') {
            save.mockResolvedValueOnce(false);
        } else {
            save.mockRejectedValueOnce(new Error('storage failed'));
        }

        await expect(keymaster.recoverWallet(did)).rejects.toThrow(
            failure === 'refusal' ? 'Keymaster: save wallet failed' : 'storage failed'
        );

        // Encrypting the original seed should still hit the original cache.
        const derive = jest.spyOn(cipher, 'generateHDKey');
        expect(await keymaster.saveWallet(original, false)).toBe(false);
        expect(derive).not.toHaveBeenCalled();
        expect(await wallet.loadWallet()).toStrictEqual(stored);
    });

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
        const save = jest.spyOn(wallet, 'saveWallet');
        const recovered = await keymaster.recoverWallet();

        expect(recovered).toBeDefined();
        expect(recovered.ids).toStrictEqual(MOCK_WALLET_V0_WITH_IDS.ids);
        expect(save).toHaveBeenCalledTimes(1);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(recovered);
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

    it('should reject recovery if wallet was not backed up', async () => {
        await keymaster.createId('Bob');
        const mnemonic = await keymaster.decryptMnemonic();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);

        await expect(keymaster.recoverWallet()).rejects.toThrow('Invalid parameter: No backup DID found');
    });

    it('should reject recovery if backup DID is invalid', async () => {
        const agentDID = await keymaster.createId('Bob');
        const mnemonic = await keymaster.decryptMnemonic();

        // Recover wallet from mnemonic
        await keymaster.newWallet(mnemonic, true);

        await expect(keymaster.recoverWallet(agentDID))
            .rejects
            .toThrow('Invalid parameter: Asset "backup" is missing or not a string');
    });

    it('should propagate backup decryption failures', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        jest.spyOn(cipher, 'decryptMessage').mockImplementationOnce(() => {
            throw new Error('decryption failed');
        });

        await expect(keymaster.recoverWallet(did)).rejects.toThrow('decryption failed');
    });

    it('should reject malformed backup data', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.backupWallet();
        jest.spyOn(cipher, 'decryptMessage').mockReturnValueOnce('not JSON');

        await expect(keymaster.recoverWallet(did)).rejects.toThrow(SyntaxError);
    });

    it('should propagate wallet storage failures', async () => {
        await keymaster.createId('Bob');
        await keymaster.backupWallet();
        jest.spyOn(wallet, 'saveWallet').mockResolvedValueOnce(false);

        await expect(keymaster.recoverWallet()).rejects.toThrow('Keymaster: save wallet failed');
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

describe('rotation persistence failures', () => {
    it.each(['refusal', 'exception'])(
        'should retain the published key after a wallet storage %s', async (failure) => {
            const alice = await keymaster.createId('Alice', { registry: 'local' });
            const active = await keymaster.loadWallet();
            const original = JSON.parse(JSON.stringify(active));
            const stored = await wallet.loadWallet();
            const originalKeys = await keymaster.fetchKeyPair();
            const save = jest.spyOn(wallet, 'saveWallet');
            if (failure === 'refusal') {
                save.mockResolvedValueOnce(false);
            } else {
                save.mockRejectedValueOnce(new Error('storage failed'));
            }

            await expect(keymaster.rotateKeys()).rejects.toThrow(
                failure === 'refusal' ? 'save wallet failed' : 'storage failed'
            );

            const doc = await gatekeeper.resolveDID(alice, { confirm: true });
            const publishedKey = doc.didDocument!.verificationMethod![0].publicKeyJwk;
            expect(publishedKey).not.toStrictEqual(originalKeys!.publicJwk);
            const keys = await keymaster.fetchKeyPair();
            expect(keys?.publicJwk).toStrictEqual(publishedKey);
            expect(await keymaster.loadWallet()).toBe(active);
            original.ids.Alice.index = 1;
            expect(active).toStrictEqual(original);
            expect(await wallet.loadWallet()).toStrictEqual(stored);

            const signed = await keymaster.addSignature({ message: 'after rotation' });
            expect(await keymaster.verifySignature(signed)).toBe(true);

            await keymaster.addName('friend', alice);
            const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
            expect(await restarted.fetchKeyPair()).toStrictEqual(keys);
            expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        }
    );

    it.each(['refusal', 'exception'])(
        'should leave the key index unchanged after a Gatekeeper %s', async (failure) => {
            const alice = await keymaster.createId('Alice', { registry: 'local' });
            const original = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
            const stored = await wallet.loadWallet();
            const keys = await keymaster.fetchKeyPair();
            const save = jest.spyOn(wallet, 'saveWallet');
            const update = jest.spyOn(gatekeeper, 'updateDID');
            if (failure === 'refusal') {
                update.mockResolvedValueOnce(false);
            } else {
                update.mockRejectedValueOnce(new Error('update failed'));
            }

            await expect(keymaster.rotateKeys()).rejects.toThrow(
                failure === 'refusal' ? 'Cannot rotate keys' : 'update failed'
            );
            expect(await keymaster.loadWallet()).toStrictEqual(original);
            expect(await wallet.loadWallet()).toStrictEqual(stored);
            expect(save).not.toHaveBeenCalled();
            expect(await keymaster.fetchKeyPair()).toStrictEqual(keys);
            const doc = await gatekeeper.resolveDID(alice, { confirm: true });
            expect(doc.didDocument!.verificationMethod![0].publicKeyJwk).toStrictEqual(keys!.publicJwk);
        }
    );
});

describe('wallet mutation rollback', () => {
    it.each(['storage refusal', 'storage exception', 'encryption exception'])(
        'should discard an alias after %s', async (failure) => {
            const alice = await keymaster.createId('Alice');
            await keymaster.addName('existing', alice);
            const active = await keymaster.loadWallet();
            const original = JSON.parse(JSON.stringify(active));
            const stored = await wallet.loadWallet();

            if (failure === 'storage refusal') {
                jest.spyOn(wallet, 'saveWallet').mockResolvedValueOnce(false);
            } else if (failure === 'storage exception') {
                jest.spyOn(wallet, 'saveWallet').mockRejectedValueOnce(new Error('storage failed'));
            } else {
                jest.spyOn(cipher, 'encryptMessage').mockImplementationOnce(() => {
                    throw new Error('encryption failed');
                });
            }

            await expect(keymaster.addName('rejected', alice)).rejects.toThrow();
            expect(await keymaster.loadWallet()).toBe(active);
            expect(active).toStrictEqual(original);
            expect(await wallet.loadWallet()).toStrictEqual(stored);

            await keymaster.addName('accepted', alice);
            const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
            expect(await restarted.listNames()).toStrictEqual({ existing: alice, accepted: alice });
            expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
        }
    );

    it('should discard changes made before the mutator throws', async () => {
        const alice = await keymaster.createId('Alice');
        const active = await keymaster.loadWallet();
        const original = JSON.parse(JSON.stringify(active));
        const stored = await wallet.loadWallet();

        // addName initializes names before validating the supplied name.
        await expect(keymaster.addName('', alice)).rejects.toThrow('name must be a non-empty string');
        expect(await keymaster.loadWallet()).toBe(active);
        expect(active).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);

        await keymaster.addName('accepted', alice);
        expect(await keymaster.getName('accepted')).toBe(alice);
    });

    it('should hide pending edits and continue queued mutations after a failed save', async () => {
        const alice = await keymaster.createId('Alice');
        let signalSaving!: () => void;
        const saving = new Promise<void>(resolve => { signalSaving = resolve; });
        let finishSave!: (ok: boolean) => void;
        const pendingSave = new Promise<boolean>(resolve => { finishSave = resolve; });
        const save = jest.spyOn(wallet, 'saveWallet').mockImplementationOnce(() => {
            signalSaving();
            return pendingSave;
        });

        const rejected = expect(keymaster.addName('rejected', alice)).rejects.toThrow('save wallet failed');
        await saving;
        const accepted = keymaster.addName('accepted', alice);
        const pendingAlias = await keymaster.getName('rejected');
        const saveCalls = save.mock.calls.length;
        finishSave(false);

        await rejected;
        expect(await accepted).toBe(true);
        expect(pendingAlias).toBeNull();
        expect(saveCalls).toBe(1);
        expect(await keymaster.listNames()).toStrictEqual({ accepted: alice });
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
    });

    it.each([999, 1])('should preserve the wallet when recovering an invalid version %i backup', async (version) => {
        const alice = await keymaster.createId('Alice');
        const invalid = { version, counter: 0, ids: {} } as WalletFile;
        const did = await keymaster.backupWallet(undefined, invalid);
        const active = await keymaster.loadWallet();
        const original = JSON.parse(JSON.stringify(active));
        const stored = await wallet.loadWallet();
        const keys = await keymaster.fetchKeyPair();

        await expect(keymaster.recoverWallet(did)).rejects.toThrow('Unsupported wallet version');
        expect(await keymaster.loadWallet()).toBe(active);
        expect(active).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);
        expect(await keymaster.fetchKeyPair()).toStrictEqual(keys);

        await keymaster.addName('accepted', alice);
        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.loadWallet()).toStrictEqual(await keymaster.loadWallet());
    });

    it.each([
        ['v1', 'refusal'], ['v1', 'exception'],
        ['v0', 'refusal'], ['v0', 'exception'],
    ])('should preserve newer wallet data on %s recovery storage %s', async (version, failure) => {
        await keymaster.createId('Alice');
        const backup: WalletFile = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
        if (version === 'v0') {
            const mnemonic = await keymaster.decryptMnemonic();
            const hdkey = cipher.generateHDKey(mnemonic);
            const keys = cipher.generateJwk(hdkey.privateKey!);
            backup.version = 0;
            backup.seed = {
                hdkey: hdkey.toJSON(),
                mnemonic: cipher.encryptMessage(keys.publicJwk, keys.privateJwk, mnemonic),
            };
        }
        const did = await keymaster.backupWallet(undefined, backup);
        const bob = await keymaster.createId('Bob');
        const active = await keymaster.loadWallet();
        const original = JSON.parse(JSON.stringify(active));
        const stored = await wallet.loadWallet();
        const save = jest.spyOn(wallet, 'saveWallet');
        if (failure === 'refusal') {
            save.mockResolvedValueOnce(false);
        } else {
            save.mockRejectedValueOnce(new Error('storage failed'));
        }

        await expect(keymaster.recoverWallet(did)).rejects.toThrow(
            failure === 'refusal' ? 'save wallet failed' : 'storage failed'
        );
        expect(save).toHaveBeenCalledTimes(1);
        expect(await keymaster.loadWallet()).toBe(active);
        expect(active).toStrictEqual(original);
        expect(await wallet.loadWallet()).toStrictEqual(stored);

        const restarted = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await restarted.listIds()).toStrictEqual(['Alice', 'Bob']);
        expect(await restarted.getCurrentId()).toBe('Bob');
        expect(await restarted.loadWallet()).toStrictEqual(original);
        expect(await restarted.fetchKeyPair()).toStrictEqual(await keymaster.fetchKeyPair());

        await keymaster.addName('accepted', bob);
        const afterSave = new Keymaster({ gatekeeper, wallet, cipher, passphrase: PASSPHRASE });
        expect(await afterSave.loadWallet()).toStrictEqual(await keymaster.loadWallet());
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
