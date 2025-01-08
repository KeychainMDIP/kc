export default class WalletCache {
    constructor(baseWallet) {
        this.baseWallet = baseWallet;
        this.cachedWallet = null;
    }

    saveWallet(wallet, overwrite = false) {
        this.cachedWallet = wallet;
        return this.baseWallet.saveWallet(wallet, overwrite);
    }

    loadWallet() {
        if (!this.cachedWallet) {
            this.cachedWallet = this.baseWallet.loadWallet();
        }

        return this.cachedWallet;
    }
}
