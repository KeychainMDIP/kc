export default class WalletWeb {
    constructor(walletName = 'mdip-keymaster') {
        this.walletName = walletName;
    }

    async saveWallet(wallet, overwrite = false) {
        if (!overwrite && window.localStorage.getItem(this.walletName)) {
            return false;
        }

        window.localStorage.setItem(this.walletName, JSON.stringify(wallet));
        return true;
    }

    async loadWallet() {
        const walletJson = window.localStorage.getItem(this.walletName);

        if (walletJson) {
            return JSON.parse(walletJson);
        }

        return null;
    }
}
