import { StoredWallet, WalletBase } from '../types.js';
import { AbstractBase } from './abstract-base.js';

export default class WalletCache extends AbstractBase {
    private baseWallet: WalletBase;
    private cachedWallet: StoredWallet;

    constructor(baseWallet: WalletBase) {
        super();
        this.baseWallet = baseWallet;
        this.cachedWallet = null;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        this.cachedWallet = wallet;
        return this.baseWallet.saveWallet(wallet, overwrite);
    }

    async loadWallet(): Promise<StoredWallet> {
        if (!this.cachedWallet) {
            this.cachedWallet = await this.baseWallet.loadWallet();
        }

        return this.cachedWallet;
    }
}
