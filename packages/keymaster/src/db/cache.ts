import {WalletWrapper, WrappedWallet} from '../types.js'

export default class WalletCache implements WalletWrapper {
    private baseWallet: WalletWrapper;
    private cachedWallet: WrappedWallet;

    constructor(baseWallet: WalletWrapper) {
        this.baseWallet = baseWallet;
        this.cachedWallet = null;
    }

    async saveWallet(wallet: WrappedWallet, overwrite: boolean = false): Promise<boolean> {
        this.cachedWallet = wallet;
        return this.baseWallet.saveWallet(wallet, overwrite);
    }

    async loadWallet(): Promise<WrappedWallet> {
        if (!this.cachedWallet) {
            this.cachedWallet = await this.baseWallet.loadWallet();
        }

        return this.cachedWallet;
    }
}
