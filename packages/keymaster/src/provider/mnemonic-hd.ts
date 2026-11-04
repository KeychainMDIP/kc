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
    isValidWalletPayload,
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

export default class MnemonicHdWalletProvider implements MnemonicHdWalletProviderInterface {
    readonly type = 'mnemonic-hd';

    private readonly store: WalletProviderStore;
    private readonly cipher: Cipher;
    private passphrase: string;
    private stateCache?: MnemonicHdWalletState;
    private hdKeyCache?: ReturnType<Cipher['generateHDKey']>;
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

    async newWallet(mnemonic?: string, overwrite = false, beforeActivate?: (fingerprint: string) => Promise<void>): Promise<void> {
        let hdKey;
        try {
            if (!mnemonic) {
                mnemonic = this.cipher.generateMnemonic();
            }

            hdKey = this.cipher.generateHDKey(mnemonic);
        } catch {
            throw new InvalidParameterError('mnemonic');
        }

        const rootPublicJwk = this.cipher.generateJwk(hdKey.privateKey!).publicJwk;

        const mnemonicEnc = await encMnemonic(mnemonic, this.passphrase);
        const state: MnemonicHdWalletState = {
            version: 1,
            type: 'mnemonic-hd',
            rootPublicJwk,
            mnemonicEnc,
            nextAccount: 0,
            keys: {},
        };

        const ok = await this.persistState(state, overwrite, beforeActivate && (() => beforeActivate(this.getFingerprintForPublicJwk(rootPublicJwk))));
        if (!ok) {
            throw new KeymasterError('save wallet failed');
        }

        this.stateCache = state;
        this.hdKeyCache = hdKey;
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

    async saveWallet(wallet: MnemonicHdWalletState, overwrite = false, beforeActivate?: () => Promise<void>): Promise<boolean> {
        const existing = this.stateCache ?? await this.store.loadWallet();
        const state = await this.validateImportedState(wallet, !!existing);
        return this.persistState(state, overwrite, beforeActivate);
    }

    private async persistState(state: MnemonicHdWalletState, overwrite: boolean, beforeActivate?: () => Promise<void>): Promise<boolean> {
        const previous = this.stateCache ?? await this.store.loadWallet();
        if (!await this.store.saveWallet(state, overwrite)) {
            return false;
        }
        try {
            await beforeActivate?.();
        } catch (error) {
            if (previous && !await this.store.saveWallet(previous, true)) {
                throw new KeymasterError('Could not restore wallet provider after failed save.');
            }
            throw error;
        }
        this.stateCache = state;
        this.hdKeyCache = undefined;
        return true;
    }

    async getFingerprint(): Promise<string> {
        await this.getHdKey();
        const publicJwk = this.getRootKeyPair().publicJwk;
        return this.getFingerprintForPublicJwk(publicJwk);
    }

    async getFingerprintForWallet(wallet: MnemonicHdWalletState): Promise<string> {
        const state = await this.validateImportedState(wallet, true);
        return this.getFingerprintForPublicJwk(state.rootPublicJwk);
    }

    assertKeyRefs(state: MnemonicHdWalletState, keyRefs: string[]): void {
        for (const keyRef of keyRefs) {
            const { baseKeyRef, version } = this.parseKeyRef(keyRef);
            this.parseAccountFromBaseKeyRef(baseKeyRef);
            const entry = this.getIdKeyState(state, baseKeyRef);
            if (version !== undefined && version > entry.currentIndex) {
                throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
            }
        }
    }

    private getFingerprintForPublicJwk(publicJwk: EcdsaJwkPublic): string {
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
                currentIndex: 0,
            };
            state.nextAccount += 1;
        });

        return created;
    }

    async findKeyRef(keyRef: string, publicJwk: EcdsaJwkPublic): Promise<string> {
        await this.getHdKey();
        const { baseKeyRef, version } = this.parseKeyRef(keyRef);
        const entry = this.getIdKeyState(await this.loadState(), baseKeyRef);
        const account = this.parseAccountFromBaseKeyRef(baseKeyRef);
        const maxIndex = version ?? entry.currentIndex;
        if (maxIndex > entry.currentIndex) {
            throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
        }
        for (let index = maxIndex; index >= 0; index--) {
            const candidate = this.deriveIdKeyPair(account, index).publicJwk;
            if (candidate.x === publicJwk.x && candidate.y === publicJwk.y) {
                return this.makeIdKeyRef(account, index);
            }
        }
        throw new KeymasterError('No matching wallet key.');
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
        if (keyRef === '') {
            await this.getHdKey();
            return this.cipher.decryptMessage(sender, this.getRootKeyPair().privateJwk, ciphertext);
        }

        const state = await this.loadState();
        await this.getHdKey();
        const { baseKeyRef, version } = this.parseKeyRef(keyRef);
        const entry = this.getIdKeyState(state, baseKeyRef);
        const account = this.parseAccountFromBaseKeyRef(baseKeyRef);
        const maxIndex = typeof version === 'number' ? version : entry.currentIndex;

        for (let index = maxIndex; index >= 0; index--) {
            const keyPair = this.deriveIdKeyPair(account, index);
            try {
                return this.cipher.decryptMessage(sender, keyPair.privateJwk, ciphertext);
            } catch {
            }
        }

        throw new KeymasterError("ID can't decrypt ciphertext");
    }

    async rotateKey(keyRef: string): Promise<WalletProviderKey> {
        let rotated!: WalletProviderKey;

        await this.mutateState(async (state) => {
            await this.getHdKey();
            const { baseKeyRef, version } = this.parseKeyRef(keyRef);
            const entry = this.getIdKeyState(state, baseKeyRef);
            const account = this.parseAccountFromBaseKeyRef(baseKeyRef);
            const currentIndex = typeof version === 'number' ? version : entry.currentIndex;
            const nextIndex = currentIndex + 1;
            if (nextIndex > entry.currentIndex) {
                entry.currentIndex = nextIndex;
            }

            rotated = {
                keyRef: this.makeIdKeyRef(account, nextIndex),
                publicJwk: this.deriveIdKeyPair(account, nextIndex).publicJwk,
            };
        });

        return rotated;
    }

    async migrateLegacyWallet(wallet: LegacyStoredWallet, beforeActivate?: (wallet: WalletFile) => Promise<void>): Promise<WalletFile> {
        const decrypted = await this.normalizeLegacyWallet(wallet);
        const { seed, counter, version, ids, ...rest } = decrypted;
        if (!isValidWalletPayload({ counter, ids, ...rest })) {
            throw new KeymasterError('Invalid wallet data.');
        }
        const mnemonic = await this.decryptProviderMnemonic(seed.mnemonicEnc!);
        const hdKey = this.cipher.generateHDKey(mnemonic);
        const rootPublicJwk = this.cipher.generateJwk(hdKey.privateKey!).publicJwk;
        const state: MnemonicHdWalletState = {
            version: 1,
            type: this.type,
            rootPublicJwk,
            mnemonicEnc: seed.mnemonicEnc!,
            nextAccount: counter,
            keys: {},
        };
        const migratedIds: Record<string, IDInfo> = {};
        for (const [name, legacy] of Object.entries(ids)) {
            const { account, index, ...info } = legacy;
            state.keys[this.makeBaseIdKeyRef(account)] = { currentIndex: index };
            state.nextAccount = Math.max(state.nextAccount, account + 1);
            migratedIds[name] = { ...info, keyRef: this.makeIdKeyRef(account, index) };
        }
        const metadata: WalletFile = {
            ...rest,
            version: 2,
            provider: { type: this.type, walletFingerprint: this.getFingerprintForPublicJwk(rootPublicJwk) },
            ids: migratedIds,
        };
        if (!await this.persistState(state, true, beforeActivate && (() => beforeActivate(metadata)))) {
            throw new KeymasterError('save wallet failed');
        }
        this.hdKeyCache = hdKey;
        return metadata;
    }

    async recoverIdKey(keyRef: string, publicJwk: EcdsaJwkPublic, index?: number): Promise<WalletProviderKey> {
        await this.getHdKey();
        const { baseKeyRef, version } = this.parseKeyRef(keyRef);
        const account = this.parseAccountFromBaseKeyRef(baseKeyRef);
        const keyIndex = Math.max(version ?? 0, index ?? 0);
        if (!Number.isSafeInteger(keyIndex) || keyIndex < 0) {
            throw new InvalidParameterError('index');
        }
        const derived = this.deriveIdKeyPair(account, keyIndex).publicJwk;
        if (derived.x !== publicJwk.x || derived.y !== publicJwk.y) {
            throw new KeymasterError('Current key does not belong to wallet.');
        }
        await this.mutateState((state) => {
            state.keys[baseKeyRef] = { currentIndex: Math.max(state.keys[baseKeyRef]?.currentIndex ?? 0, keyIndex) };
            state.nextAccount = Math.max(state.nextAccount, account + 1);
        });
        return { keyRef: this.makeIdKeyRef(account, keyIndex), publicJwk: derived };
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
            const hdKey = this.cipher.generateHDKey(mnemonic);
            const root = this.cipher.generateJwk(hdKey.privateKey!);
            const plaintext = this.cipher.decryptMessage(root.publicJwk, root.privateJwk, wallet.enc);
            const data = JSON.parse(plaintext);
            if (!isValidWalletPayload(data)) {
                throw new KeymasterError('Invalid wallet data.');
            }
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

    private async validateImportedState(wallet: MnemonicHdWalletState, validateMnemonic: boolean): Promise<MnemonicHdWalletState> {
        if (wallet?.version !== 1 || wallet.type !== this.type || !wallet.rootPublicJwk) {
            throw new InvalidParameterError('wallet');
        }
        if (!wallet.mnemonicEnc
            || typeof wallet.mnemonicEnc.salt !== 'string'
            || typeof wallet.mnemonicEnc.iv !== 'string'
            || typeof wallet.mnemonicEnc.data !== 'string') {
            throw new InvalidParameterError('wallet');
        }
        if (!Number.isSafeInteger(wallet.nextAccount) || wallet.nextAccount < 0 || !wallet.keys || typeof wallet.keys !== 'object' || Array.isArray(wallet.keys)) {
            throw new InvalidParameterError('wallet');
        }

        const state = this.cloneState(wallet);
        if (validateMnemonic) {
            const mnemonic = await this.decryptProviderMnemonic(state.mnemonicEnc);
            let hdKey;
            try {
                hdKey = this.cipher.generateHDKey(mnemonic);
            }
            catch {
                throw new InvalidParameterError('wallet');
            }
            const { publicJwk } = this.cipher.generateJwk(hdKey.privateKey!);

            if (this.cipher.hashJSON(publicJwk) !== this.cipher.hashJSON(state.rootPublicJwk)) {
                throw new KeymasterError('Mnemonic does not match wallet.');
            }
        }

        for (const [keyRef, entry] of Object.entries(state.keys)) {
            if (!entry || !Number.isSafeInteger(entry.currentIndex) || entry.currentIndex < 0) {
                throw new InvalidParameterError('wallet');
            }

            let account: number;
            try {
                account = this.parseAccountFromBaseKeyRef(keyRef);
            }
            catch {
                throw new InvalidParameterError('wallet');
            }
            if (account >= state.nextAccount) {
                throw new InvalidParameterError('wallet');
            }
        }

        return state;
    }

    private async mutateState(mutator: (state: MnemonicHdWalletState) => void | Promise<void>): Promise<void> {
        const run = async () => {
            const before = JSON.stringify(await this.loadState());
            const state: MnemonicHdWalletState = JSON.parse(before);
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
        const hdKey = this.cipher.generateHDKey(mnemonic);
        const publicJwk = this.cipher.generateJwk(hdKey.privateKey!).publicJwk;
        if (this.cipher.hashJSON(publicJwk) !== this.cipher.hashJSON(state.rootPublicJwk)) {
            throw new KeymasterError('Mnemonic does not match wallet.');
        }
        this.hdKeyCache = hdKey;
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

        if (!Number.isSafeInteger(version) || version < 0) {
            throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
        }

        return { baseKeyRef, version };
    }

    private parseAccountFromBaseKeyRef(baseKeyRef: string): number {
        if (!baseKeyRef.startsWith('hd:')) {
            throw new KeymasterError(`Unknown keyRef: ${baseKeyRef}`);
        }

        const account = Number(baseKeyRef.slice(3));
        if (!Number.isSafeInteger(account) || account < 0) {
            throw new KeymasterError(`Unknown keyRef: ${baseKeyRef}`);
        }

        return account;
    }

    private findKeyPairForRef(keyRef: string): EcdsaJwkPair {
        // An empty keyRef is reserved for mnemonic-hd's root key in recovery flows.
        if (keyRef === '') {
            if (!this.hdKeyCache) {
                throw new KeymasterError('Wallet provider not initialized.');
            }

            return this.getRootKeyPair();
        }

        const state = this.stateCache;
        if (!state) {
            throw new KeymasterError('Wallet provider not initialized.');
        }

        const { baseKeyRef, version } = this.parseKeyRef(keyRef);
        const entry = this.getIdKeyState(state, baseKeyRef);
        const account = this.parseAccountFromBaseKeyRef(baseKeyRef);
        const index = typeof version === 'number' ? version : entry.currentIndex;

        if (index > entry.currentIndex) {
            throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
        }

        return this.deriveIdKeyPair(account, index);
    }

    private getIdKeyState(state: MnemonicHdWalletState, keyRef: string): MnemonicHdKeyState {
        const entry = state.keys[keyRef];
        if (!entry) {
            throw new KeymasterError(`Unknown keyRef: ${keyRef}`);
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
