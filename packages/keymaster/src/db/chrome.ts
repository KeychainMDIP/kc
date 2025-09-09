import { StoredWallet } from '../types.js';
import { AbstractBase } from './abstract-base.js';

export default class WalletChrome extends AbstractBase {
    walletName: string;

    constructor(walletName: string = 'mdip-keymaster') {
        super();
        this.walletName = walletName;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        if (!overwrite) {
            const res = await chrome.storage.local.get([this.walletName]);
            if (res[this.walletName]) {
                return false;
            }
        }

        await chrome.storage.local.set({ [this.walletName]: JSON.stringify(wallet) });
        return true;
    }

    async loadWallet(): Promise<StoredWallet> {
        const res = await chrome.storage.local.get([this.walletName]);

        if (res[this.walletName]) {
            return JSON.parse(res[this.walletName]);
        }

        return null;
    }
}
