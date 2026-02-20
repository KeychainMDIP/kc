import { StoredWallet, WalletBase } from '../types.js';

export default class WalletJsonMemory implements WalletBase {
    walletCache: string | null = null;

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        if (this.walletCache && !overwrite) {
            return false;
        }
        this.walletCache = JSON.stringify(wallet);
        return true;
    }

    async loadWallet(): Promise<StoredWallet | null> {
        if (!this.walletCache) {
            return null;
        }

        return JSON.parse(this.walletCache);
    }
}
