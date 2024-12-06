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
    if (!fs.existsSync(walletName)) {
        return null;
    }

    const walletJson = fs.readFileSync(walletName);
    const walletData = JSON.parse(walletJson);

    if (walletData && walletData.salt && walletData.iv && walletData.data) {
        throw new Error('Wallet encrypted but KC_ENCRYPTED_PASSPHRASE not set');
    }

    return walletData;
}
