import { MnemonicHdWalletState, WalletProviderStore } from '../types.js';

export default class WalletProviderJsonMemory implements WalletProviderStore {
    walletCache: string | null = null;

    async saveWallet(wallet: MnemonicHdWalletState, overwrite: boolean = false): Promise<boolean> {
        if (this.walletCache && !overwrite) {
            return false;
        }

        this.walletCache = JSON.stringify(wallet);
        return true;
    }

    async loadWallet(): Promise<MnemonicHdWalletState | null> {
        if (!this.walletCache) {
            return null;
        }

        return JSON.parse(this.walletCache);
    }
}
