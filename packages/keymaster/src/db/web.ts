import { StoredWallet, WalletBase } from '../types.js';

export default class WalletWeb implements WalletBase {
    walletName: string;

    constructor(walletName: string = 'mdip-keymaster') {
        this.walletName = walletName;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        if (!overwrite && window.localStorage.getItem(this.walletName)) {
            return false;
        }

        window.localStorage.setItem(this.walletName, JSON.stringify(wallet));
        return true;
    }

    async loadWallet(): Promise<StoredWallet | null> {
        const walletJson = window.localStorage.getItem(this.walletName);

        if (walletJson) {
            return JSON.parse(walletJson);
        }

        return null;
    }
}
