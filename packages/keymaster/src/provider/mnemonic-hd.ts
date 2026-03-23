import {
    InvalidParameterError,
    KeymasterError,
} from '@mdip/common/errors';
import type {
    Cipher,
    EcdsaJwkPair,
    EcdsaJwkPublic,
} from '@mdip/cipher/types';
import { decMnemonic, encMnemonic } from '../encryption.js';
import {
    isLegacyV0,
    isV1Decrypted,
    isV1WithEnc,
} from '../db/typeGuards.js';
import type {
    IDInfo,
    LegacyStoredWallet,
    LegacyWalletFile,
    MnemonicHdWalletProviderInterface,
    MnemonicHdKeyState,
    MnemonicHdWalletState,
    WalletFile,
    WalletProviderKey,
    WalletProviderStore,
} from '../types.js';

interface MnemonicHdWalletProviderOptions {
    store: WalletProviderStore;
    cipher: Cipher;
    passphrase: string;
}

function range(endInclusive: number): number[] {
    return Array.from({ length: endInclusive + 1 }, (_, index) => index);
}

export default class MnemonicHdWalletProvider implements MnemonicHdWalletProviderInterface {
    readonly type = 'mnemonic-hd';

    private readonly store: WalletProviderStore;
    private readonly cipher: Cipher;
    private passphrase: string;
    private stateCache?: MnemonicHdWalletState;
    private hdKeyCache?: any;
    private mutationLock: Promise<void> = Promise.resolve();

    constructor(options: MnemonicHdWalletProviderOptions) {
        if (!options?.store?.loadWallet || !options.store.saveWallet) {
            throw new InvalidParameterError('options.store');
        }
        if (!options?.cipher?.verifySig) {
            throw new InvalidParameterError('options.cipher');
        }
        if (!options?.passphrase) {
            throw new InvalidParameterError('options.passphrase');
        }

        this.store = options.store;
        this.cipher = options.cipher;
        this.passphrase = options.passphrase;
    }

    async newWallet(mnemonic?: string, overwrite = false): Promise<void> {

        try {
            if (!mnemonic) {
                mnemonic = this.cipher.generateMnemonic();
            }

            this.hdKeyCache = this.cipher.generateHDKey(mnemonic);
        } catch {
            throw new InvalidParameterError('mnemonic');
        }

        const rootPublicJwk = this.getRootKeyPair().publicJwk;

        const mnemonicEnc = await encMnemonic(mnemonic, this.passphrase);
        const state: MnemonicHdWalletState = {
            version: 1,
            type: 'mnemonic-hd',
            rootPublicJwk,
            mnemonicEnc,
            nextAccount: 0,
            keys: {},
        };

        const ok = await this.store.saveWallet(state, overwrite);
        if (!ok) {
            throw new KeymasterError('save wallet failed');
        }

        this.stateCache = state;
    }

    async resetWallet(overwrite = false): Promise<void> {
        await this.newWallet(undefined, overwrite);
    }

    async decryptMnemonic(): Promise<string> {
        const state = await this.loadState();
        return this.decryptProviderMnemonic(state.mnemonicEnc);
    }

    async changePassphrase(mnemonic: string, newPassphrase: string): Promise<void> {
        let hdKey;
        try {
            hdKey = this.cipher.generateHDKey(mnemonic);
        } catch {
            throw new InvalidParameterError('mnemonic');
        }

        const { publicJwk } = this.cipher.generateJwk(hdKey.privateKey!);
        const state = await this.loadState();
        if (this.cipher.hashJSON(publicJwk) !== this.cipher.hashJSON(state.rootPublicJwk)) {
            throw new KeymasterError('Mnemonic does not match wallet.');
        }

        const mnemonicEnc = await encMnemonic(mnemonic, newPassphrase);
        await this.mutateState((current) => {
            current.rootPublicJwk = publicJwk;
            current.mnemonicEnc = mnemonicEnc;
        });

        this.passphrase = newPassphrase;
        this.hdKeyCache = hdKey;
    }

    async backupWallet(): Promise<MnemonicHdWalletState> {
        const state = this.stateCache ?? await this.store.loadWallet();
        if (!state) {
            throw new KeymasterError('Wallet provider not initialized.');
        }

        this.stateCache = state;
        return this.cloneState(state);
    }

    async saveWallet(wallet: MnemonicHdWalletState, overwrite = false): Promise<boolean> {
        if (wallet.version !== 1 || wallet.type !== this.type || !wallet.rootPublicJwk) {
            throw new InvalidParameterError('wallet');
        }

        const state = this.cloneState(wallet);
        const ok = await this.store.saveWallet(state, overwrite);
        if (!ok) {
            return false;
        }

        this.stateCache = state;
        this.hdKeyCache = undefined;
        return true;
    }

    async getFingerprint(): Promise<string> {
        await this.getHdKey();
        const publicJwk = this.getRootKeyPair().publicJwk;
        return this.cipher.hashJSON({
            type: this.type,
            publicJwk,
        });
    }

    async createIdKey(): Promise<WalletProviderKey> {
        let created!: WalletProviderKey;

        await this.mutateState(async (state) => {
            await this.getHdKey();
            const account = state.nextAccount;
            created = this.deriveNextIdKey(account);
            state.keys[this.makeBaseIdKeyRef(account)] = {
                account,
                currentIndex: 0,
                knownIndices: [0],
            };
            state.nextAccount += 1;
        });

        return created;
    }

    async signDigest(keyRef: string, digest: string): Promise<string> {
        await this.getHdKey();
        const keyPair = this.findKeyPairForRef(keyRef);
        return this.cipher.signHash(digest, keyPair.privateJwk);
    }

    async encrypt(
        keyRef: string,
        receiver: EcdsaJwkPublic,
        plaintext: string,
    ): Promise<string> {
        await this.getHdKey();
        const keyPair = this.findKeyPairForRef(keyRef);
        return this.cipher.encryptMessage(receiver, keyPair.privateJwk, plaintext);
    }

    async decrypt(keyRef: string, sender: EcdsaJwkPublic, ciphertext: string): Promise<string> {
        const state = await this.loadState();
        await this.getHdKey();
        const { baseKeyRef, version } = this.parseKeyRef(keyRef);
        const entry = this.getIdKeyState(state, baseKeyRef);
        const maxIndex = typeof version === 'number' ? version : entry.currentIndex;

        for (const index of [...entry.knownIndices]
            .filter((knownIndex) => knownIndex <= maxIndex)
            .sort((a, b) => b - a)) {
            const keyPair = this.deriveIdKeyPair(entry.account, index);
            try {
                return this.cipher.decryptMessage(sender, keyPair.privateJwk, ciphertext);
            } catch {
            }
        }

        throw new KeymasterError("ID can't decrypt ciphertext");
    }

    async rotateKey(keyRef: string): Promise<{ publicJwk: EcdsaJwkPublic }> {
        let publicJwk!: EcdsaJwkPublic;

        await this.mutateState(async (state) => {
            await this.getHdKey();
            const { baseKeyRef } = this.parseKeyRef(keyRef);
            const entry = this.getIdKeyState(state, baseKeyRef);
            const nextIndex = entry.currentIndex + 1;
            entry.currentIndex = nextIndex;
            if (!entry.knownIndices.includes(nextIndex)) {
                entry.knownIndices.push(nextIndex);
            }

            publicJwk = this.deriveIdKeyPair(entry.account, nextIndex).publicJwk;
        });

        return { publicJwk };
    }

    async migrateLegacyWallet(wallet: LegacyStoredWallet): Promise<WalletFile> {
        const decrypted = await this.normalizeLegacyWallet(wallet);
        const mnemonic = await this.decryptProviderMnemonic(decrypted.seed.mnemonicEnc!);
        const state = await this.buildStateFromLegacyWallet(decrypted, mnemonic);
        this.stateCache = state;
        const walletFingerprint = await this.getFingerprint();

        const { seed, counter, version, ids, ...rest } = decrypted;
        const migratedIds = Object.entries(ids).reduce<Record<string, IDInfo>>((acc, [name, legacy]) => {
            const { account, index, ...info } = legacy;
            acc[name] = {
                ...info,
                keyRef: this.makeIdKeyRef(account, index),
            };
            return acc;
        }, {});

        const metadata: WalletFile = {
            version: 2,
            provider: {
                type: this.type,
                walletFingerprint,
            },
            ids: migratedIds,
            ...rest,
        };
        return metadata;
    }

    private async buildStateFromLegacyWallet(wallet: LegacyWalletFile, mnemonic: string): Promise<MnemonicHdWalletState> {
        const mnemonicEnc = await encMnemonic(mnemonic, this.passphrase);
        this.hdKeyCache = this.cipher.generateHDKey(mnemonic);
        const state: MnemonicHdWalletState = {
            version: 1,
            type: 'mnemonic-hd',
            rootPublicJwk: this.getRootKeyPair().publicJwk,
            mnemonicEnc,
            nextAccount: wallet.counter,
            keys: {},
        };

        for (const legacy of Object.values(wallet.ids)) {
            state.keys[this.makeBaseIdKeyRef(legacy.account)] = {
                account: legacy.account,
                currentIndex: legacy.index,
                knownIndices: range(legacy.index),
            };
            state.nextAccount = Math.max(state.nextAccount, legacy.account + 1);
        }

        this.hdKeyCache = this.cipher.generateHDKey(mnemonic);
        const ok = await this.store.saveWallet(state, true);
        if (!ok) {
            throw new KeymasterError('save wallet failed');
        }

        return state;
    }

    private async normalizeLegacyWallet(wallet: LegacyStoredWallet): Promise<LegacyWalletFile> {
        if (isLegacyV0(wallet)) {
            const hdkey = this.cipher.generateHDKeyJSON(wallet.seed.hdkey!);
            const keypair = this.cipher.generateJwk(hdkey.privateKey!);
            const plaintext = this.cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, wallet.seed.mnemonic!);
            const mnemonicEnc = await encMnemonic(plaintext, this.passphrase);
            const { seed, version, ...rest } = wallet;
            return {
                version: 1,
                seed: { mnemonicEnc },
                ...rest,
            };
        }

        if (isV1WithEnc(wallet)) {
            const mnemonic = await this.decryptProviderMnemonic(wallet.seed.mnemonicEnc!);
            this.hdKeyCache = this.cipher.generateHDKey(mnemonic);
            const root = this.getRootKeyPair();
            const plaintext = this.cipher.decryptMessage(root.publicJwk, root.privateJwk, wallet.enc);
            const data = JSON.parse(plaintext);
            return {
                version: 1,
                seed: { mnemonicEnc: wallet.seed.mnemonicEnc },
                ...data,
            };
        }

        if (isV1Decrypted(wallet)) {
            return wallet;
        }

        throw new KeymasterError('Unsupported wallet version.');
    }

    private async decryptProviderMnemonic(mnemonicEnc: MnemonicHdWalletState['mnemonicEnc']): Promise<string> {
        try {
            return await decMnemonic(mnemonicEnc, this.passphrase);
        } catch {
            throw new KeymasterError('Incorrect passphrase.');
        }
    }

    private async mutateState(mutator: (state: MnemonicHdWalletState) => void | Promise<void>): Promise<void> {
        const run = async () => {
            const state = await this.loadState();
            const before = JSON.stringify(state);
            await mutator(state);
            const after = JSON.stringify(state);

            if (before === after) {
                return;
            }

            const ok = await this.store.saveWallet(state, true);
            if (!ok) {
                throw new KeymasterError('save wallet failed');
            }

            this.stateCache = state;
        };

        const chained = this.mutationLock.then(run, run);
        this.mutationLock = chained.catch(() => { });
        return chained;
    }

    private async loadState(): Promise<MnemonicHdWalletState> {
        if (this.stateCache) {
            return this.stateCache;
        }

        const state = await this.store.loadWallet();
        if (!state) {
            await this.newWallet();
            return this.stateCache!;
        }

        this.stateCache = state;
        return state;
    }

    private async getHdKey() {
        if (this.hdKeyCache) {
            return this.hdKeyCache;
        }

        const state = await this.loadState();
        const mnemonic = await this.decryptProviderMnemonic(state.mnemonicEnc);
        this.hdKeyCache = this.cipher.generateHDKey(mnemonic);
        return this.hdKeyCache;
    }

    private getRootKeyPair(): EcdsaJwkPair {
        if (!this.hdKeyCache) {
            throw new KeymasterError('HD wallet cache not loaded');
        }

        return this.cipher.generateJwk(this.hdKeyCache.privateKey!);
    }

    private deriveNextIdKey(account: number): WalletProviderKey {
        const keyRef = this.makeIdKeyRef(account, 0);
        const publicJwk = this.deriveIdKeyPair(account, 0).publicJwk;

        return { keyRef, publicJwk };
    }

    private makeBaseIdKeyRef(account: number): string {
        return `hd:${account}`;
    }

    private makeIdKeyRef(account: number, index: number): string {
        return `${this.makeBaseIdKeyRef(account)}#${index}`;
    }

    private parseKeyRef(keyRef: string): { baseKeyRef: string; version?: number } {
        const hashIndex = keyRef.lastIndexOf('#');
        if (hashIndex < 0) {
            return { baseKeyRef: keyRef };
        }

        const baseKeyRef = keyRef.slice(0, hashIndex);
        const versionPart = keyRef.slice(hashIndex + 1);
        const version = Number(versionPart);

        if (!Number.isInteger(version) || version < 0) {
            throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
        }

        return { baseKeyRef, version };
    }

    private findKeyPairForRef(keyRef: string): EcdsaJwkPair {
        const state = this.stateCache;
        if (!state) {
            throw new KeymasterError('Wallet provider not initialized.');
        }

        const { baseKeyRef, version } = this.parseKeyRef(keyRef);
        const entry = this.getIdKeyState(state, baseKeyRef);
        const index = typeof version === 'number' ? version : entry.currentIndex;

        if (!entry.knownIndices.includes(index)) {
            throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
        }

        return this.deriveIdKeyPair(entry.account, index);
    }

    private getIdKeyState(state: MnemonicHdWalletState, keyRef: string): MnemonicHdKeyState {
        const entry = state.keys[keyRef];
        if (!entry || typeof entry.account !== 'number') {
            throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
        }

        if (!entry.knownIndices?.length) {
            entry.knownIndices = [entry.currentIndex];
        }

        return entry;
    }

    private deriveIdKeyPair(account: number, index: number): EcdsaJwkPair {
        if (!this.hdKeyCache) {
            throw new KeymasterError('HD wallet cache not loaded');
        }

        const path = `m/44'/0'/${account}'/0/${index}`;
        const didkey = this.hdKeyCache.derive(path);
        return this.cipher.generateJwk(didkey.privateKey!);
    }

    private cloneState(state: MnemonicHdWalletState): MnemonicHdWalletState {
        return JSON.parse(JSON.stringify(state)) as MnemonicHdWalletState;
    }

}
