
import type { StoredWallet, WalletBase } from '../types.js';

export abstract class AbstractBase implements WalletBase {
    private _lock: Promise<void> = Promise.resolve();

    abstract saveWallet(wallet: StoredWallet, overwrite?: boolean): Promise<boolean>;
    abstract loadWallet(): Promise<StoredWallet>;

    async updateWallet(
        mutator: (wallet: StoredWallet) => void | StoredWallet | Promise<void | StoredWallet>
    ): Promise<void> {
        const run = async () => {
            const current = await this.loadWallet();
            if (!current) {
                throw new Error('updateWallet: no wallet found to update');
            }

            const maybeNew = await mutator(current);
            const next: StoredWallet = (maybeNew ?? current) as StoredWallet;

            await this.saveWallet(next, true);
        };

        const chained = this._lock.then(run, run);
        this._lock = chained.catch(() => {});
        return chained;
    }
}
