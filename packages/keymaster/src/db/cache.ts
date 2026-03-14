import { KeymasterStore, StoredWallet } from '../types.js';

export default class WalletCache implements KeymasterStore {
    private baseWallet: KeymasterStore;
    private cachedWallet: StoredWallet | null | undefined = undefined;

    constructor(baseWallet: KeymasterStore) {
        this.baseWallet = baseWallet;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        this.cachedWallet = wallet;
        return this.baseWallet.saveWallet(wallet, overwrite);
    }

    async loadWallet(): Promise<StoredWallet | null> {
        if (this.cachedWallet === undefined) {
            this.cachedWallet = await this.baseWallet.loadWallet();
        }

        return this.cachedWallet ?? null;
    }
}
