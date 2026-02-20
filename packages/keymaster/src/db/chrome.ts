import { StoredWallet, WalletBase } from '../types.js';

export default class WalletChrome implements WalletBase {
    walletName: string;

    constructor(walletName: string = 'mdip-keymaster') {
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

    async loadWallet(): Promise<StoredWallet | null> {
        const res = await chrome.storage.local.get([this.walletName]);

        if (res[this.walletName]) {
            return JSON.parse(res[this.walletName]);
        }

        return null;
    }
}
