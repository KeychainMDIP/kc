import { StoredWallet } from '@mdip/keymaster/types';
import { AbstractBase } from '@mdip/keymaster/wallet/abstract-base';

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
