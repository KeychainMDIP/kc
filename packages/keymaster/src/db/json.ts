import fs from 'fs';
import { randomUUID } from 'crypto';
import { StoredWallet, WalletBase } from '../types.js';

export default class WalletJson implements WalletBase {
    private readonly dataFolder: string;
    walletName: string;

    constructor(walletFileName = 'wallet.json', dataFolder = 'data') {
        this.dataFolder = dataFolder;
        this.walletName = `${dataFolder}/${walletFileName}`;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        const walletExists = fs.existsSync(this.walletName);
        if (walletExists && !overwrite) {
            return false;
        }

        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        const tempName = `${this.walletName}.${randomUUID()}.tmp`;
        const mode = walletExists ? fs.statSync(this.walletName).mode & 0o777 : 0o666;

        try {
            fs.writeFileSync(tempName, JSON.stringify(wallet, null, 4), {
                flag: 'wx',
                flush: true,
                mode,
            });
            if (walletExists) {
                fs.chmodSync(tempName, mode);
            }
            fs.renameSync(tempName, this.walletName);
        }
        catch (error) {
            try {
                fs.rmSync(tempName, { force: true });
            }
            catch {
                // Preserve the original write error if temporary-file cleanup fails.
            }
            throw error;
        }

        return true;
    }

    async loadWallet(): Promise<StoredWallet | null> {
        if (!fs.existsSync(this.walletName)) {
            return null;
        }

        const walletJson = fs.readFileSync(this.walletName, 'utf-8');
        return JSON.parse(walletJson);
    }
}
