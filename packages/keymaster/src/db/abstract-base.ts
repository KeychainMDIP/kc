
import type { StoredWallet, WalletBase } from '../types.js';

export abstract class AbstractBase implements WalletBase {
    private _lock: Promise<void> = Promise.resolve();

    abstract saveWallet(wallet: StoredWallet, overwrite?: boolean): Promise<boolean>;
    abstract loadWallet(): Promise<StoredWallet>;

    async updateWallet(
        mutator: (wallet: StoredWallet) => void | Promise<void>
    ): Promise<void> {
        const run = async () => {
            const wallet = await this.loadWallet();
            if (!wallet) {
                throw new Error('updateWallet: no wallet found to update');
            }
            await mutator(wallet);
            await this.saveWallet(wallet, true);
        };

        const chained = this._lock.then(run, run);
        this._lock = chained.catch(() => {});
        return chained;
    }
}
