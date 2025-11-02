import { StoredWallet, WalletBase } from '@mdip/keymaster/types';
import { AbstractBase } from '@mdip/keymaster/wallet/abstract-base';

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

    async loadWallet(): Promise<StoredWallet | null> {
        if (!this.cachedWallet) {
            this.cachedWallet = await this.baseWallet.loadWallet();
        }

        return this.cachedWallet;
    }
}
