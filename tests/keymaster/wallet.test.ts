import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import type {
    LegacyWalletEncFile,
    LegacyWalletFile,
    WalletFile,
    WalletProviderStore,
} from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import HeliaClient from '@mdip/ipfs/helia';
import MnemonicHdWalletProvider from '../../packages/keymaster/src/provider/mnemonic-hd.ts';
import WalletProviderJsonMemory from '../../packages/keymaster/src/provider/json-memory.ts';
import { TestHelper } from './helper.ts';
import { disableSubtle } from './testUtils.ts';
import { encMnemonic, decMnemonic } from '@mdip/keymaster/encryption';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let walletStore: WalletJsonMemory;
let providerStore: WalletJsonMemory;
let cipher: CipherNode;
let walletProvider: MnemonicHdWalletProvider;
let keymaster: Keymaster;
let helper: TestHelper;
const PASSPHRASE = 'passphrase';

const MOCK_WALLET_V0_UNENCRYPTED: LegacyWalletFile = {
    seed: {
        mnemonic: 'wp3keoeTNleruzCiTOrCgDmm6viThBq_GWdNIGzXKcS62XqtrBkm0-jDhEUoU1FvB5oWnmCqkSIhnKKeaUwPbK5ysjCHbIVrf9JAr-91FabxtX0B2dctgccg_MEVk88u6anmcFP4DAEhK5zUDXCYGgFR',
        hdkey: {
            xpriv: 'xprv9s21ZrQH143K2JL3GWr8NVjn1XR9kpKpKX4G4g5cvYKyrGShVz7ro2zf75AYyArqm8b7VQGpbvcLXGw6Sp5sa5pAPfHMfbjsPkgiezjHSGN',
            xpub: 'xpub661MyMwAqRbcEnQWNYP8jdgWZZFeAH3fgjyrs4VEUsrxj4mr3XS7LqK8xNiAKdSdnCb5zbdxPvgu49fdGgzMgDW8AfbyP6CQjWFkYgFbNdB',
        },
    },
    counter: 0,
    ids: {},
};

const MOCK_WALLET_V0_WITH_IDS: LegacyWalletFile = {
    seed: {
        mnemonic: 'WLWbs2iHBobOaKVJXViqefiTYayURf-_6gh_ndflhTACKYG8WKn8WWsQHXNiyNYjU9sfM9kOce8fyAyKjUERgdjnZv2_y6MKO9QsnQMd4XUZceKSa22QGdzBSBFOZ13Odzj9fVd4W-bfvgSZuJJqMWwNhw',
        hdkey: {
            xpriv: 'xprv9s21ZrQH143K2v1nGQ7a6WnEH9VQv6AT7FrxSPGPfSuvgz1mxGsazcTKNk58oRWVpB2MqgaRBPXevSuRbtUziXeQT2ZYmCXnUe6JRHomHrn',
            xpub: 'xpub661MyMwAqRbcFQ6FNReaTeixqBKuKYtJUUnZEmg1DnSuZnLvVpBqYQmoE31V13nDfVQ8kMkfPKkMk1oWw77jUjXZJT22jH5dpRTvE8M84m9',
        },
    },
    counter: 2,
    ids: {
        id_1: {
            did: 'did:test:z3v8AuakAd5R7WeGZUin2TtsqyxJPxouLfMEbpn5CmaNXChWq7r',
            account: 0,
            index: 0,
        },
        id_2: {
            did: 'did:test:z3v8AuaiAYJ263LLYdApaUmGjy8Dnhx46LU1YDUvGHAcj9Ykgxg',
            account: 1,
            index: 0,
        },
    },
    current: 'id_2',
};

const MOCK_WALLET_V0_ENCRYPTED = {
    salt: 'SHUIyrheMkaGv7uyV+6ZHw==',
    iv: 'nW4a05eR2rxHY0T7',
    data: 'O+UlnXsCA522UwUwpFqtybIKwrJsHrVatrUJgNVBjFUk6TAdMsdGzW49WiJt+lF4iJe6ftETd1wjSretZc97gi+VzZzX0Ggba6rmXnuD189jRFg7eudCqG4y6Rgt72SYxZu3pgaEJ146Ntj+H6cAcSIfYyhNgtPmlpWBZcm68wP8YRaP5i0/mZF89md4DjjyFOv8qTLG4m42fmoCmliIeJdmBChjPdpAm8V/ZOwkULjKQPpLAjDe4uCwvgenZduSJEDyP8m1jAcwGFxcI1mcXVYunR/YruczYXGY4dPnmW03lXinOX+5SR/bs9Z23uhqoVgUgW25Rfz/5zr4YFVXBQcVQXEvLtR38KPWeuOKltvU3FbysSgIrM6WBSkJt5chfYCGg7a554lqHyeGTxrlUa8th+hXSv/LVkvl+juhq+yd85QqyX8gLhxZxw4lx5eeaU3uJ+BJ33onI2y4sr02ZU5fYOIPFKS7IGCE0KK2hv0NwNvSv8oy402m9xU+iCIr19Xs28jm61/difLh/x1g/RXQUV/07b8tZLbB6n6hBC/h+3jLexJeFIpn1C1yBY+JQopTS+NgXEZZK+HuFp3k/JjI0ImxIy/2gPSm3jRAs1f8GfLLEMdJWoseZ/laPhD0QdWPQt7oGqKTfn7G72os8gGsme4AiFtKzg0zEv3whzLvOW6W2uUXAR83cXdlKcLpju7vrjjdfrcqYxkR3VDp',
};

const MOCK_WALLET_V1: LegacyWalletFile = {
    version: 1,
    seed: {
        mnemonicEnc: {
            data: 'p3gKBzVtJTflKBHSDgrMiuncBH4foJM++DyoQAZD/cVeQDCY4aFTxSC0nkylGcpi88Odq0SXkc2nAHyjA7+D6FZzbiTDdgqu3SJXznZEMCJDzHTkpLOa',
            iv: '2mHu57FRcEERBLMv',
            salt: 'm74zOr/8etDRMoU8dnriXA==',
        },
    },
    counter: 0,
    ids: {},
};

const MOCK_WALLET_V1_ENCRYPTED: LegacyWalletEncFile = {
    version: 1,
    seed: {
        mnemonicEnc: {
            salt: '8c+TrInC7EJZAnwjD6k8+A==',
            iv: 'EkeweG9JHYjXr7cN',
            data: '4MLe/4SX9unO+7DTK1KUKLBLeHuJNS4bT9yjp8L/xnLzexpobGEmRJebUuv3e0aIs4krINlkTlP4krmqkI3p/EVlu9Ap6GRNoogZR4ZC1EtKUTwgNaQ7058o0/d1LQ8wSA==',
        },
    },
    enc: 'CAKfW05djVJ2VnkLLbiBgtJpfC3x8xvc4_-M0OJBA6N7YcuXyd1F3GhifoUZ2Zdy2XGP_nGzhjS2u3NXgIM',
};

function createProviderStore(): WalletProviderStore {
    return new WalletProviderJsonMemory();
}

function createWalletProvider(
    store: WalletProviderStore = createProviderStore(),
    passphrase: string = PASSPHRASE,
): MnemonicHdWalletProvider {
    return new MnemonicHdWalletProvider({ store, cipher, passphrase });
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
    walletStore = new WalletJsonMemory();
    providerStore = new WalletProviderJsonMemory();
    cipher = new CipherNode();
    walletProvider = createWalletProvider(providerStore);
    keymaster = new Keymaster({ gatekeeper, store: walletStore, walletProvider, cipher });
    helper = new TestHelper(keymaster);
});

describe('loadWallet', () => {
    it('should create v2 metadata on first load', async () => {
        const wallet = await keymaster.loadWallet();

        expect(wallet).toEqual({
            version: 2,
            provider: {
                type: 'mnemonic-hd',
                walletFingerprint: expect.any(String),
            },
            ids: {},
        });
    });

    it('should return the same wallet on second load', async () => {
        const wallet1 = await keymaster.loadWallet();
        const wallet2 = await keymaster.loadWallet();

        expect(wallet2).toStrictEqual(wallet1);
    });

    it('should throw exception on load with incorrect passphrase', async () => {
        await walletStore.saveWallet(structuredClone(MOCK_WALLET_V1_ENCRYPTED), true);

        const incorrectKeymaster = new Keymaster({
            gatekeeper,
            store: walletStore,
            walletProvider: createWalletProvider(createProviderStore(), 'incorrect'),
            cipher,
        });

        await expect(incorrectKeymaster.loadWallet()).rejects.toThrow('Keymaster: Incorrect passphrase.');
    });

    it('should upgrade a v0 wallet to v2', async () => {
        await walletStore.saveWallet(structuredClone(MOCK_WALLET_V0_UNENCRYPTED), true);

        const wallet = await keymaster.loadWallet();

        expect(wallet).toEqual({
            version: 2,
            provider: {
                type: 'mnemonic-hd',
                walletFingerprint: expect.any(String),
            },
            ids: {},
        });
    });

    it('should migrate a v1 encrypted wallet to v2', async () => {
        await walletStore.saveWallet(structuredClone(MOCK_WALLET_V1_ENCRYPTED), true);

        const wallet = await keymaster.loadWallet();

        expect(wallet.version).toBe(2);
        expect(wallet.provider).toEqual({
            type: 'mnemonic-hd',
            walletFingerprint: expect.any(String),
        });
        expect(wallet.ids).toEqual({});
        expect((wallet as any).seed).toBeUndefined();
        expect((wallet as any).counter).toBeUndefined();
    });

    it('should throw on deprecated encrypted v0 wallet', async () => {
        await walletStore.saveWallet(structuredClone(MOCK_WALLET_V0_ENCRYPTED) as any, true);

        await expect(keymaster.loadWallet()).rejects.toThrow('Keymaster: Unsupported wallet version.');
    });

    it('should throw on unsupported wallet version', async () => {
        const invalidWallet: any = structuredClone(MOCK_WALLET_V1_ENCRYPTED);
        delete invalidWallet.seed.mnemonicEnc;
        await walletStore.saveWallet(invalidWallet, true);

        await expect(keymaster.loadWallet()).rejects.toThrow('Keymaster: Unsupported wallet version.');
    });
});

describe('saveWallet', () => {
    it('should save a v2 wallet', async () => {
        const wallet = await keymaster.loadWallet();
        wallet.metadata = { foo: 'bar' };

        const ok = await keymaster.saveWallet(wallet, true);

        expect(ok).toBe(true);
        expect(await keymaster.loadWallet()).toStrictEqual(wallet);
    });

    it('should not overwrite an existing wallet if specified', async () => {
        const wallet = await keymaster.loadWallet();
        const updated = structuredClone(wallet);
        updated.metadata = { foo: 'bar' };

        const ok = await keymaster.saveWallet(updated, false);

        expect(ok).toBe(false);
        expect(await keymaster.loadWallet()).toStrictEqual(wallet);
    });

    it('should save augmented wallet metadata', async () => {
        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();

        wallet.ids.Bob.icon = 'smiley';
        wallet.metadata = { foo: 'bar' };
        await keymaster.saveWallet(wallet, true);

        expect(await keymaster.loadWallet()).toStrictEqual(wallet);
    });

    it('should upgrade a v0 wallet with ids to v2', async () => {
        const ok = await keymaster.saveWallet(structuredClone(MOCK_WALLET_V0_WITH_IDS), true);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.version).toBe(2);
        expect(wallet.current).toBe('id_2');
        expect(wallet.ids.id_1).toEqual({
            did: MOCK_WALLET_V0_WITH_IDS.ids.id_1.did,
            keyRef: 'hd:0#0',
        });
        expect(wallet.ids.id_2).toEqual({
            did: MOCK_WALLET_V0_WITH_IDS.ids.id_2.did,
            keyRef: 'hd:1#0',
        });
    });

    it('should save a v1 encrypted wallet as v2 metadata', async () => {
        const ok = await keymaster.saveWallet(structuredClone(MOCK_WALLET_V1_ENCRYPTED), true);
        const stored = await walletStore.loadWallet() as WalletFile;

        expect(ok).toBe(true);
        expect(stored.version).toBe(2);
        expect(stored.provider).toEqual({
            type: 'mnemonic-hd',
            walletFingerprint: expect.any(String),
        });
    });

    it('should throw on incorrect passphrase', async () => {
        const incorrectKeymaster = new Keymaster({
            gatekeeper,
            store: walletStore,
            walletProvider: createWalletProvider(createProviderStore(), 'incorrect'),
            cipher,
        });

        await expect(
            incorrectKeymaster.saveWallet(structuredClone(MOCK_WALLET_V1_ENCRYPTED), true)
        ).rejects.toThrow('Keymaster: Incorrect passphrase.');
    });
});

describe('newWallet', () => {
    it('should overwrite an existing wallet when allowed', async () => {
        const wallet1 = await keymaster.loadWallet();

        await keymaster.newWallet(undefined, true);
        const wallet2 = await keymaster.loadWallet();

        expect(wallet1.provider.walletFingerprint).not.toBe(wallet2.provider.walletFingerprint);
    });

    it('should not overwrite an existing wallet by default', async () => {
        await keymaster.loadWallet();

        await expect(keymaster.newWallet()).rejects.toThrow('Keymaster: save wallet failed');
    });

    it('should create a wallet from a mnemonic', async () => {
        const mnemonic = cipher.generateMnemonic();
        await keymaster.newWallet(mnemonic);
        const wallet = await keymaster.loadWallet();

        const comparisonProvider = createWalletProvider(createProviderStore());
        await comparisonProvider.newWallet(mnemonic, true);

        expect(wallet.provider.walletFingerprint).toBe(await comparisonProvider.getFingerprint());
    });

    it('should throw exception on invalid mnemonic', async () => {
        await expect(
            keymaster.newWallet([] as any)
        ).rejects.toThrow('Invalid parameter: mnemonic');
    });
});

describe('MnemonicHdWalletProvider backup', () => {
    it('should backup and restore provider state directly', async () => {
        await keymaster.createId('Bob');

        const backup = await walletProvider.backupWallet();
        const restoredProvider = createWalletProvider(createProviderStore());
        const ok = await restoredProvider.saveWallet(backup, true);

        expect(ok).toBe(true);
        expect(await restoredProvider.getFingerprint()).toBe(await walletProvider.getFingerprint());
    });

    it('should decrypt the mnemonic and change passphrase with a matching mnemonic', async () => {
        const mnemonic = cipher.generateMnemonic();
        await walletProvider.newWallet(mnemonic, true);

        const backup = await walletProvider.backupWallet();
        const restoredProvider = createWalletProvider(createProviderStore(), 'temporary');
        await restoredProvider.saveWallet(backup, true);
        await restoredProvider.changePassphrase(mnemonic, 'updated-passphrase');

        expect(await restoredProvider.decryptMnemonic()).toBe(mnemonic);
        expect(await restoredProvider.getFingerprint()).toBe(await walletProvider.getFingerprint());
    });

    it('should reject passphrase change when the mnemonic does not match', async () => {
        const mnemonic = cipher.generateMnemonic();
        await walletProvider.newWallet(mnemonic, true);

        const backup = await walletProvider.backupWallet();
        const restoredProvider = createWalletProvider(createProviderStore(), 'temporary');
        await restoredProvider.saveWallet(backup, true);

        await expect(
            restoredProvider.changePassphrase(cipher.generateMnemonic(), 'updated-passphrase')
        ).rejects.toThrow('Keymaster: Mnemonic does not match wallet.');
    });
});

describe('backupWallet', () => {
    it('should return a valid DID, store backupDid in metadata, and mirror it to the seed bank', async () => {
        await keymaster.createId('Bob');

        const did = await keymaster.backupWallet();
        const doc = await keymaster.resolveDID(did);
        const wallet = await keymaster.loadWallet();
        const seedBank = await keymaster.resolveSeedBank();
        const data = seedBank.didDocumentData as { wallet?: string };

        expect(did).toBe(doc.didDocument!.id);
        expect(typeof doc.didDocumentData?.backup).toBe('string');
        expect(wallet.backupDid).toBe(did);
        expect(data.wallet).toBe(did);
    });

    it('should replace non-object seed bank data when mirroring the backup DID', async () => {
        await keymaster.createId('Bob');

        const seedBank = await keymaster.resolveSeedBank();
        seedBank.didDocumentData = 'stale-data' as any;
        await keymaster.updateSeedBank(seedBank);

        const did = await keymaster.backupWallet();
        const updated = await keymaster.resolveSeedBank();

        expect(updated.didDocumentData).toEqual({ wallet: did });
    });
});

describe('recoverWallet', () => {
    it('should recover wallet from stored backup DID', async () => {
        await keymaster.createId('Bob');
        await keymaster.backupWallet();
        await keymaster.createId('Alice');

        const recovered = await keymaster.recoverWallet();

        expect(Object.keys(recovered.ids)).toEqual(['Bob']);
        expect(recovered.current).toBe('Bob');
    });

    it('should recover wallet from seed bank after resetting metadata', async () => {
        await keymaster.createId('Bob');
        const backupDid = await keymaster.backupWallet();
        const mnemonic = await walletProvider.decryptMnemonic();

        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(recovered.backupDid).toBe(backupDid);
        expect(Object.keys(recovered.ids)).toEqual(['Bob']);
        expect(recovered.current).toBe('Bob');

        const providerState = await walletProvider.backupWallet();
        expect(providerState.keys['hd:0']).toEqual({ currentIndex: 0 });
    });

    it('should recover bundle state from the seed bank, including rotated keys and next account', async () => {
        await keymaster.createId('Bob');
        await keymaster.rotateKeys();
        await keymaster.createId('Alice');

        const backupDid = await keymaster.backupWallet();
        const mnemonic = await walletProvider.decryptMnemonic();

        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet();

        expect(recovered.backupDid).toBe(backupDid);
        expect(recovered.ids.Bob.keyRef).toBe('hd:0#1');
        expect(recovered.ids.Alice.keyRef).toBe('hd:1#0');

        const assetDid = await keymaster.createAsset({ hello: 'world' }, { controller: 'Bob' });
        expect(assetDid).toMatch(/^did:/);

        const carolDid = await keymaster.createId('Carol');
        expect(carolDid).toMatch(/^did:/);
        expect((await keymaster.loadWallet()).ids.Carol.keyRef).toBe('hd:2#0');
    });

    it('should recover augmented wallet from backup DID', async () => {
        await keymaster.createId('Bob');
        const wallet = await keymaster.loadWallet();
        wallet.ids.Bob.icon = 'smiley';
        wallet.metadata = { foo: 'bar' };
        await keymaster.saveWallet(wallet, true);
        const did = await keymaster.backupWallet();

        await keymaster.createId('Alice');
        const recovered = await keymaster.recoverWallet(did);

        expect(recovered).toEqual(
            expect.objectContaining({
                version: 2,
                ids: expect.objectContaining({
                    Bob: expect.objectContaining({
                        did: wallet.ids.Bob.did,
                        keyRef: wallet.ids.Bob.keyRef,
                        icon: 'smiley',
                    }),
                }),
                metadata: { foo: 'bar' },
            })
        );
        expect(recovered.ids.Alice).toBeUndefined();
    });

    it('should do nothing if wallet was not backed up', async () => {
        await keymaster.createId('Bob');
        const current = await keymaster.loadWallet();

        const recovered = await keymaster.recoverWallet();

        expect(recovered).toStrictEqual(current);
    });

    it('should do nothing if backup DID is invalid', async () => {
        await keymaster.createId('Bob');
        const current = await keymaster.loadWallet();

        const recovered = await keymaster.recoverWallet('did:test:invalid');

        expect(recovered).toStrictEqual(current);
    });

    it('should not overwrite wallet metadata when recovered backup fingerprint mismatches', async () => {
        await keymaster.createId('Bob');
        const current = await keymaster.loadWallet();
        const mismatched = structuredClone(current);
        mismatched.provider.walletFingerprint = 'wrong-wallet-fingerprint';
        const backupDid = await keymaster.createAsset({ backup: mismatched });

        const recovered = await keymaster.recoverWallet(backupDid);

        expect(recovered).toStrictEqual(current);
        expect(await keymaster.loadWallet()).toStrictEqual(current);
    });

    it('should recover wallet from explicit backup DID after resetting metadata', async () => {
        await keymaster.createId('Bob');
        const backupDid = await keymaster.backupWallet();
        await keymaster.createId('Alice');
        const mnemonic = await walletProvider.decryptMnemonic();

        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet(backupDid);

        expect(recovered.backupDid).toBe(backupDid);
        expect(Object.keys(recovered.ids)).toEqual(['Bob']);
        expect(recovered.current).toBe('Bob');

        const assetDid = await keymaster.createAsset({ hello: 'world' }, { controller: 'Bob' });
        expect(assetDid).toMatch(/^did:/);

        await keymaster.createId('Carol');
        const updated = await keymaster.loadWallet();
        expect(updated.ids.Carol.keyRef).toBe('hd:1#0');
    });

    it('should recover encrypted legacy backup from explicit backup DID', async () => {
        await keymaster.createId('Bob');
        const mnemonic = await walletProvider.decryptMnemonic();
        const providerState = await walletProvider.backupWallet();
        const current = await keymaster.loadWallet();
        const legacyBackup: LegacyWalletFile = {
            version: 1,
            seed: {
                mnemonicEnc: providerState.mnemonicEnc,
            },
            counter: 1,
            ids: {
                Bob: {
                    did: current.ids.Bob.did,
                    account: 0,
                    index: 0,
                },
            },
            current: 'Bob',
        };

        const hdKey = cipher.generateHDKey(mnemonic);
        const { publicJwk, privateJwk } = cipher.generateJwk(hdKey.privateKey!);
        const ciphertext = cipher.encryptMessage(publicJwk, privateJwk, JSON.stringify(legacyBackup));
        const backupDid = await keymaster.createAsset({ backup: ciphertext });

        await keymaster.newWallet(mnemonic, true);
        const recovered = await keymaster.recoverWallet(backupDid);

        expect(recovered.backupDid).toBe(backupDid);
        expect(recovered.current).toBe('Bob');
        expect(recovered.ids.Bob).toEqual({
            did: current.ids.Bob.did,
            keyRef: 'hd:0#0',
        });
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
        expect(deleted).toBe(4);
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

describe('no WebCrypto subtle', () => {
    let restore: () => void;

    beforeAll(() => {
        restore = disableSubtle();
    });

    afterAll(() => {
        restore();
    });

    it('encMnemonic will throw without crypto subtle', async () => {
        await expect(encMnemonic('', PASSPHRASE)).rejects.toThrow('Web Cryptography API not available');
    });

    it('decMnemonic will throw without crypto subtle', async () => {
        await expect(decMnemonic(MOCK_WALLET_V0_ENCRYPTED, PASSPHRASE)).rejects.toThrow('Web Cryptography API not available');
    });
});
