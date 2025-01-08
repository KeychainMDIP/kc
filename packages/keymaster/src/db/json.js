import fs from 'fs';

export default class WalletJson {
    constructor(walletFileName = 'wallet.json', dataFolder = 'data') {
        this.dataFolder = dataFolder;
        this.walletName = `${dataFolder}/${walletFileName}`;
    }

    saveWallet(wallet, overwrite = false) {
        if (fs.existsSync(this.walletName) && !overwrite) {
            return false;
        }

        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        fs.writeFileSync(this.walletName, JSON.stringify(wallet, null, 4));
        return true;
    }

    loadWallet() {
        if (!fs.existsSync(this.walletName)) {
            return null;
        }

        const walletJson = fs.readFileSync(this.walletName);
        return JSON.parse(walletJson);
    }
}
