export default class WalletCacheAsync {
    constructor(baseWallet) {
        this.baseWallet = baseWallet;
        this.cachedWallet = null;
    }

    async saveWallet(wallet, overwrite = false) {
        this.cachedWallet = wallet;
        return this.baseWallet.saveWallet(wallet, overwrite);
    }

    async loadWallet() {
        if (!this.cachedWallet) {
            this.cachedWallet = this.baseWallet.loadWallet();
        }

        return this.cachedWallet;
    }
}
