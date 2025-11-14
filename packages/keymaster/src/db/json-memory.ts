import { StoredWallet } from '../types.js';
import { AbstractBase } from './abstract-base.js';

export default class WalletJsonMemory extends AbstractBase {
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
