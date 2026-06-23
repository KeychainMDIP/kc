import { StoredWallet, WalletBase } from '../types.js';

export default class WalletCache implements WalletBase {
    private baseWallet: WalletBase;
    private cachedWallet: StoredWallet;

    constructor(baseWallet: WalletBase) {
        this.baseWallet = baseWallet;
        this.cachedWallet = null;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        this.cachedWallet = wallet;
        return this.baseWallet.saveWallet(wallet, overwrite);
    }

    async loadWallet(): Promise<StoredWallet | null> {
        if (!this.cachedWallet) {
            this.cachedWallet = await this.baseWallet.loadWallet();
        }

        return this.cachedWallet;
    }
}
