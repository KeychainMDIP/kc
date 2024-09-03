import fs from 'fs/promises';
import * as cipher from './cipher-lib.js';
import * as exceptions from './exceptions.js';

const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;

export async function saveWallet(wallet) {
    // TBD validate wallet before saving

    try {
        await fs.mkdir(dataFolder, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
        // If the error is 'EEXIST', the directory already exists, so we can ignore it.
    }

    await fs.writeFile(walletName, JSON.stringify(wallet, null, 4), 'utf-8');
    return loadWallet();
}

export async function loadWallet() {
    let walletJson;
    try {
        walletJson = await fs.readFile(walletName, 'utf-8');
        return JSON.parse(walletJson);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // If the error is 'ENOENT', the file does not exist, so return a new wallet.
            return newWallet();
        }
        // If the error is anything else, rethrow it.
        throw error;
    }
}

export async function newWallet(mnemonic, overwrite) {
    try {
        await fs.access(walletName);
        if (!overwrite) {
            throw new Error(exceptions.UPDATE_FAILED);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        // If the error is 'ENOENT', the file does not exist, so we can ignore it.
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

        await saveWallet(wallet);
        return wallet;
    }
    catch (error) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }
}
