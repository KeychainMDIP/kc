import { StoredWallet } from '../types.js';
import { AbstractBase } from './abstract-base.js';

export default class WalletWeb extends AbstractBase {
    walletName: string;

    constructor(walletName: string = 'mdip-keymaster') {
        super();
        this.walletName = walletName;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        if (!overwrite && window.localStorage.getItem(this.walletName)) {
            return false;
        }

        window.localStorage.setItem(this.walletName, JSON.stringify(wallet));
        return true;
    }

    async loadWallet(): Promise<StoredWallet> {
        const walletJson = window.localStorage.getItem(this.walletName);

        if (walletJson) {
            return JSON.parse(walletJson);
        }

        return null;
    }
}
