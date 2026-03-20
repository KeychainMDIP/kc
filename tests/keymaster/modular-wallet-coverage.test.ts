import { jest } from '@jest/globals';
import Keymaster from '@mdip/keymaster';
import type {
    KeymasterStore,
    LegacyWalletFile,
    MnemonicHdWalletState,
    StoredWallet,
    WalletFile,
    WalletProvider,
    WalletProviderKey,
} from '@mdip/keymaster/types';
import type { EcdsaJwkPublic } from '@mdip/cipher/types';
import CipherNode from '@mdip/cipher/node';
import MnemonicHdWalletProvider from '../../packages/keymaster/src/provider/mnemonic-hd.ts';
import WalletProviderJsonMemory from '../../packages/keymaster/src/provider/json-memory.ts';
import { encMnemonic } from '@mdip/keymaster/encryption';

const gatekeeper = {
    createDID: async () => 'did:test:stub',
    listRegistries: async () => [],
} as any;

const cipherStub = {
    verifySig: () => true,
} as any;

const dummyPublicJwk = {
    kty: 'EC',
    crv: 'secp256k1',
    x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    y: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
} as EcdsaJwkPublic;

const PASSPHRASE = 'passphrase';

class MemoryStore<T> {
    protected wallet: T | null;
    protected readonly saveResults: boolean[];

    constructor(initial: T | null = null, saveResults: boolean[] = []) {
        this.wallet = initial ? structuredClone(initial) : null;
        this.saveResults = [...saveResults];
    }

    protected async saveValue(wallet: T, overwrite: boolean = false): Promise<boolean> {
        if (this.wallet && !overwrite) {
            return false;
        }

        if (this.saveResults.length > 0) {
            const result = this.saveResults.shift()!;
            if (!result) {
                return false;
            }
        }

        this.wallet = structuredClone(wallet);
        return true;
    }

    protected async loadValue(): Promise<T | null> {
        return this.wallet ? structuredClone(this.wallet) : null;
    }
}

class MemoryKeymasterStore extends MemoryStore<StoredWallet> implements KeymasterStore {
    constructor(initial: StoredWallet | null = null, saveResults: boolean[] = []) {
        super(initial, saveResults);
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        return this.saveValue(wallet, overwrite);
    }

    async loadWallet(): Promise<StoredWallet | null> {
        return this.loadValue();
    }
}

class ControlledProviderStore extends WalletProviderJsonMemory {
    private readonly saveResults: boolean[];

    constructor(initial: MnemonicHdWalletState | null = null, saveResults: boolean[] = []) {
        super();
        this.saveResults = [...saveResults];
        if (initial) {
            this.walletCache = JSON.stringify(initial);
        }
    }

    queueSaveResult(result: boolean): void {
        this.saveResults.push(result);
    }

    override async saveWallet(wallet: MnemonicHdWalletState, overwrite: boolean = false): Promise<boolean> {
        if (this.saveResults.length > 0) {
            const result = this.saveResults.shift()!;
            if (!result) {
                return false;
            }
        }

        return super.saveWallet(wallet, overwrite);
    }
}

class DummyWalletProvider implements WalletProvider {
    readonly type = 'dummy';
    fingerprint = 'dummy-fingerprint';
    resetCalls: boolean[] = [];

    async getFingerprint(): Promise<string> {
        return this.fingerprint;
    }

    async resetWallet(overwrite: boolean = false): Promise<void> {
        this.resetCalls.push(overwrite);
    }

    async createIdKey(): Promise<WalletProviderKey> {
        return {
            keyRef: 'dummy:0#0',
            publicJwk: dummyPublicJwk,
        };
    }

    async signDigest(_keyRef: string, _digest: string): Promise<string> {
        return 'signature';
    }

    async encrypt(_keyRef: string, _receiver: EcdsaJwkPublic, plaintext: string): Promise<string> {
        return plaintext;
    }

    async decrypt(_keyRef: string, _sender: EcdsaJwkPublic, ciphertext: string): Promise<string> {
        return ciphertext;
    }
}

async function makeWalletFile(provider: WalletProvider, ids: WalletFile['ids'] = {}): Promise<WalletFile> {
    return {
        version: 2,
        provider: {
            type: provider.type,
            walletFingerprint: await provider.getFingerprint(),
        },
        ids,
    };
}

async function makeLegacyV1Decrypted(
    cipher: CipherNode,
    passphrase: string = PASSPHRASE,
): Promise<LegacyWalletFile> {
    const mnemonic = cipher.generateMnemonic();
    const mnemonicEnc = await encMnemonic(mnemonic, passphrase);
    return {
        version: 1,
        seed: { mnemonicEnc },
        counter: 2,
        ids: {
            Alice: {
                did: 'did:test:alice',
                account: 0,
                index: 1,
            },
        },
        current: 'Alice',
    };
}

describe('Keymaster modular wallet coverage', () => {
    it('rejects v2 metadata when the active provider identity does not match', async () => {
        const provider = new DummyWalletProvider();
        const storedWallet = await makeWalletFile(provider);
        storedWallet.provider.walletFingerprint = 'other-fingerprint';
        const store = new MemoryKeymasterStore(storedWallet);
        const keymaster = new Keymaster({ gatekeeper, store, walletProvider: provider, cipher: cipherStub });

        await expect(keymaster.loadWallet()).rejects.toThrow(
            'Keymaster: Wallet provider does not match stored metadata.'
        );
    });

    it('throws if migrating legacy metadata cannot be saved back to the keymaster store', async () => {
        const cipher = new CipherNode();
        const legacyWallet = await makeLegacyV1Decrypted(cipher);
        const store = new MemoryKeymasterStore(legacyWallet, [false]);
        const providerStore = new ControlledProviderStore();
        const walletProvider = new MnemonicHdWalletProvider({ store: providerStore, cipher, passphrase: PASSPHRASE });
        const keymaster = new Keymaster({ gatekeeper, store, walletProvider, cipher });

        await expect(keymaster.loadWallet()).rejects.toThrow('Keymaster: save wallet failed');
    });

    it('uses resetWallet for non-mnemonic providers', async () => {
        const store = new MemoryKeymasterStore();
        const provider = new DummyWalletProvider();
        const keymaster = new Keymaster({ gatekeeper, store, walletProvider: provider, cipher: cipherStub });

        const wallet = await keymaster.newWallet(undefined, true);

        expect(provider.resetCalls).toEqual([true]);
        expect(wallet).toEqual({
            version: 2,
            provider: {
                type: 'dummy',
                walletFingerprint: 'dummy-fingerprint',
            },
            ids: {},
        });
    });

    it('rejects mnemonic initialization for non-mnemonic providers', async () => {
        const store = new MemoryKeymasterStore();
        const provider = new DummyWalletProvider();
        const keymaster = new Keymaster({ gatekeeper, store, walletProvider: provider, cipher: cipherStub });

        await expect(keymaster.newWallet('mnemonic words')).rejects.toThrow(
            'Keymaster: Wallet provider does not support mnemonic initialization.'
        );
    });

    it('throws if saving new v2 metadata fails', async () => {
        const store = new MemoryKeymasterStore(null, [false]);
        const provider = new DummyWalletProvider();
        const keymaster = new Keymaster({ gatekeeper, store, walletProvider: provider, cipher: cipherStub });

        await expect(keymaster.newWallet(undefined, true)).rejects.toThrow('Keymaster: save wallet failed');
    });

    it('throws if a metadata mutation cannot be saved', async () => {
        const provider = new DummyWalletProvider();
        const wallet = await makeWalletFile(provider, {
            Alice: {
                did: 'did:test:alice',
                keyRef: 'dummy:0#0',
            },
        });
        wallet.current = 'Alice';

        const store = new MemoryKeymasterStore(wallet, [false]);
        const keymaster = new Keymaster({ gatekeeper, store, walletProvider: provider, cipher: cipherStub });

        await expect(keymaster.removeId('Alice')).rejects.toThrow('Keymaster: save wallet failed');
    });

    it('rejects key rotation when the provider does not expose rotateKey', async () => {
        const provider = new DummyWalletProvider();
        const wallet = await makeWalletFile(provider, {
            Alice: {
                did: 'did:test:alice',
                keyRef: 'dummy:0#0',
            },
        });
        wallet.current = 'Alice';

        const store = new MemoryKeymasterStore(wallet);
        const keymaster = new Keymaster({ gatekeeper, store, walletProvider: provider, cipher: cipherStub });

        await expect(keymaster.rotateKeys()).rejects.toThrow(
            'Keymaster: Wallet provider does not support key rotation.'
        );
    });
});

describe('MnemonicHdWalletProvider coverage', () => {
    it('validates constructor arguments', () => {
        const cipher = new CipherNode();

        expect(() => new MnemonicHdWalletProvider({ store: undefined as any, cipher, passphrase: PASSPHRASE }))
            .toThrow('Invalid parameter: options.store');
        expect(() => new MnemonicHdWalletProvider({ store: new ControlledProviderStore(), cipher: undefined as any, passphrase: PASSPHRASE }))
            .toThrow('Invalid parameter: options.cipher');
        expect(() => new MnemonicHdWalletProvider({ store: new ControlledProviderStore(), cipher, passphrase: '' as any }))
            .toThrow('Invalid parameter: options.passphrase');
    });

    it('auto-initializes provider state when getFingerprint is called on an empty store', async () => {
        const cipher = new CipherNode();
        const store = new ControlledProviderStore();
        const provider = new MnemonicHdWalletProvider({ store, cipher, passphrase: PASSPHRASE });

        const fingerprint = await provider.getFingerprint();
        const savedState = await store.loadWallet();

        expect(fingerprint).toEqual(expect.any(String));
        expect(savedState?.type).toBe('mnemonic-hd');
        expect(savedState?.rootPublicJwk).toBeDefined();
    });

    it('resetWallet creates provider state', async () => {
        const cipher = new CipherNode();
        const store = new ControlledProviderStore();
        const provider = new MnemonicHdWalletProvider({ store, cipher, passphrase: PASSPHRASE });

        await provider.resetWallet(true);
        const backup = await provider.backupWallet();

        expect(backup.type).toBe('mnemonic-hd');
        expect(backup.rootKeyRef).toBe('root');
    });

    it('backupWallet rejects when the provider has not been initialized', async () => {
        const cipher = new CipherNode();
        const store = new ControlledProviderStore();
        const provider = new MnemonicHdWalletProvider({ store, cipher, passphrase: PASSPHRASE });

        await expect(provider.backupWallet()).rejects.toThrow('Keymaster: Wallet provider not initialized.');
    });

    it('saveWallet rejects invalid imported provider state', async () => {
        const cipher = new CipherNode();
        const store = new ControlledProviderStore();
        const provider = new MnemonicHdWalletProvider({ store, cipher, passphrase: PASSPHRASE });

        await expect(provider.saveWallet({
            version: 1,
            type: 'mnemonic-hd',
            mnemonicEnc: { salt: 'salt', iv: 'iv', data: 'data' },
            nextAccount: 0,
            rootKeyRef: 'root',
            keys: {},
        } as any, true)).rejects.toThrow('Invalid parameter: wallet');
    });

    it('saveWallet returns false when the provider store refuses the restore write', async () => {
        const cipher = new CipherNode();
        const sourceProvider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });
        await sourceProvider.newWallet(undefined, true);
        const backup = await sourceProvider.backupWallet();

        const failingProvider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(null, [false]),
            cipher,
            passphrase: PASSPHRASE,
        });

        await expect(failingProvider.saveWallet(backup, true)).resolves.toBe(false);
    });

    it('changePassphrase rejects an invalid mnemonic', async () => {
        const cipher = new CipherNode();
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await provider.newWallet(undefined, true);

        await expect(provider.changePassphrase([] as any, 'updated')).rejects.toThrow(
            'Invalid parameter: mnemonic'
        );
    });

    it('migrates a decrypted v1 wallet into v2 metadata with versioned key refs', async () => {
        const cipher = new CipherNode();
        const legacyWallet = await makeLegacyV1Decrypted(cipher);
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        const migrated = await provider.migrateLegacyWallet(legacyWallet);

        expect(migrated).toEqual({
            version: 2,
            provider: {
                type: 'mnemonic-hd',
                walletFingerprint: expect.any(String),
            },
            ids: {
                Alice: {
                    did: 'did:test:alice',
                    keyRef: 'hd:0#1',
                },
            },
            current: 'Alice',
        });
    });

    it('throws if migrating a legacy wallet cannot save provider state', async () => {
        const cipher = new CipherNode();
        const legacyWallet = await makeLegacyV1Decrypted(cipher);
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(null, [false]),
            cipher,
            passphrase: PASSPHRASE,
        });

        await expect(provider.migrateLegacyWallet(legacyWallet)).rejects.toThrow(
            'Keymaster: save wallet failed'
        );
    });

    it('rejects unsupported legacy wallet shapes', async () => {
        const cipher = new CipherNode();
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await expect(provider.migrateLegacyWallet({ version: 99 } as any)).rejects.toThrow(
            'Keymaster: Unsupported wallet version.'
        );
    });

    it('loads provider state from the store when the cache is empty', async () => {
        const cipher = new CipherNode();
        const mnemonic = cipher.generateMnemonic();
        const sourceProvider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await sourceProvider.newWallet(mnemonic, true);
        const backup = await sourceProvider.backupWallet();

        const restoredProvider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(backup),
            cipher,
            passphrase: PASSPHRASE,
        });

        await expect(restoredProvider.decryptMnemonic()).resolves.toBe(mnemonic);
    });

    it('supports root key refs for signing and base key refs for rotation', async () => {
        const cipher = new CipherNode();
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await provider.newWallet(undefined, true);
        await provider.createIdKey();

        await expect(provider.signDigest('root', cipher.hashMessage('root-message'))).resolves.toEqual(expect.any(String));
        await expect(provider.rotateKey('hd:0')).resolves.toEqual({
            publicJwk: expect.any(Object),
        });
    });

    it('rejects malformed versioned key refs', async () => {
        const cipher = new CipherNode();
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await provider.newWallet(undefined, true);

        await expect(provider.signDigest('hd:0#bad', 'digest')).rejects.toThrow(
            'Keymaster: Unknown keyRef: hd:0#bad'
        );
    });

    it('rejects unknown imported key refs', async () => {
        const cipher = new CipherNode();
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await provider.newWallet(undefined, true);

        await expect(provider.signDigest('hd:999#0', 'digest')).rejects.toThrow(
            'Keymaster: Unknown keyRef: hd:999'
        );
    });

    it('rejects unknown rotated key versions for known key rings', async () => {
        const cipher = new CipherNode();
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await provider.newWallet(undefined, true);
        await provider.createIdKey();

        await expect(provider.signDigest('hd:0#1', 'digest')).rejects.toThrow(
            'Keymaster: Unknown keyRef: hd:0#1'
        );
    });

    it('repairs missing knownIndices when imported provider state is incomplete', async () => {
        const cipher = new CipherNode();
        const sourceProvider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        await sourceProvider.newWallet(undefined, true);
        await sourceProvider.createIdKey();
        const backup = await sourceProvider.backupWallet();
        backup.keys['hd:0'].knownIndices = [];

        const restoredProvider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });
        await restoredProvider.saveWallet(backup, true);

        await expect(restoredProvider.signDigest('hd:0#0', cipher.hashMessage('message'))).resolves.toEqual(expect.any(String));
    });

    it('guards private helper access when state or hd cache is missing', () => {
        const cipher = new CipherNode();
        const provider = new MnemonicHdWalletProvider({
            store: new ControlledProviderStore(),
            cipher,
            passphrase: PASSPHRASE,
        });

        expect(() => (provider as any).getRootKeyPair()).toThrow('Keymaster: HD wallet cache not loaded');
        expect(() => (provider as any).deriveIdKeyPair(0, 0)).toThrow('Keymaster: HD wallet cache not loaded');
        expect(() => (provider as any).findKeyPairForRef('hd:0#0')).toThrow('Keymaster: Wallet provider not initialized.');
    });

    it('does not save provider state when a private mutation is a no-op', async () => {
        const cipher = new CipherNode();
        const store = new ControlledProviderStore();
        const provider = new MnemonicHdWalletProvider({
            store,
            cipher,
            passphrase: PASSPHRASE,
        });

        await provider.newWallet(undefined, true);
        const saveSpy = jest.spyOn(store, 'saveWallet');
        saveSpy.mockClear();

        await (provider as any).mutateState(() => { });

        expect(saveSpy).not.toHaveBeenCalled();
    });

    it('throws when a private provider state mutation cannot be saved', async () => {
        const cipher = new CipherNode();
        const store = new ControlledProviderStore();
        const provider = new MnemonicHdWalletProvider({
            store,
            cipher,
            passphrase: PASSPHRASE,
        });

        await provider.newWallet(undefined, true);
        store.queueSaveResult(false);

        await expect((provider as any).mutateState((state: MnemonicHdWalletState) => {
            state.nextAccount += 1;
        })).rejects.toThrow('Keymaster: save wallet failed');
    });
});
