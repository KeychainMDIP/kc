import fs from 'fs';

const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;

export function saveWallet(wallet, overwrite = false) {
    if (fs.existsSync(walletName) && !overwrite) {
        return false;
    }

    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    fs.writeFileSync(walletName, JSON.stringify(wallet, null, 4));
    return true;
}

export function loadWallet() {
    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
    }

    return null;
}
