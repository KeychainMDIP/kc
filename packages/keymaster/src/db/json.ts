import fs from 'fs';
import { StoredWallet, WalletBase } from '../types.js';

export default class WalletJson implements WalletBase {
    private readonly dataFolder: string;
    walletName: string;

    constructor(walletFileName = 'wallet.json', dataFolder = 'data') {
        this.dataFolder = dataFolder;
        this.walletName = `${dataFolder}/${walletFileName}`;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        if (fs.existsSync(this.walletName) && !overwrite) {
            return false;
        }

        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        fs.writeFileSync(this.walletName, JSON.stringify(wallet, null, 4));
        return true;
    }

    async loadWallet(): Promise<StoredWallet> {
        if (!fs.existsSync(this.walletName)) {
            return null;
        }

        const walletJson = fs.readFileSync(this.walletName, 'utf-8');
        return JSON.parse(walletJson);
    }
}
