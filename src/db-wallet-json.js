import fs from 'fs';
import * as cipher from './cipher-lib.js';
import * as exceptions from './exceptions.js';

const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;

export function saveWallet(wallet) {
    // TBD validate wallet before saving

    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    fs.writeFileSync(walletName, JSON.stringify(wallet, null, 4));
}

export function loadWallet() {
    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
    }

    return newWallet();
}

export function newWallet(mnemonic, overwrite) {
    if (fs.existsSync(walletName) && !overwrite) {
        throw new Error(exceptions.UPDATE_FAILED);
    }

    try {
        if (!mnemonic) {
            mnemonic = cipher.generateMnemonic();
        }
        const hdkey = cipher.generateHDKey(mnemonic);
        const keypair = cipher.generateJwk(hdkey.privateKey);
        const backup = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, mnemonic);

        const wallet = {
            seed: {
                mnemonic: backup,
                hdkey: hdkey.toJSON(),
            },
            counter: 0,
            ids: {},
        }

        saveWallet(wallet);
        return wallet;
    }
    catch (error) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }
}
