export default class WalletChrome {
    constructor(walletName = 'mdip-keymaster') {
        this.walletName = walletName;
    }

    async saveWallet(wallet, overwrite = false) {
        if (!overwrite) {
            const res = await chrome.storage.local.get([this.walletName]);
            if (res[this.walletName]) {
                return false;
            }
        }

        await chrome.storage.local.set({ [this.walletName]: JSON.stringify(wallet) });
        return true;
    }

    async loadWallet() {
        const res = await chrome.storage.local.get([this.walletName]);

        if (res[this.walletName]) {
            return JSON.parse(res[this.walletName]);
        }

        return null;
    }
}
