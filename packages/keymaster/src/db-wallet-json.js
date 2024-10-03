import fs from 'fs/promises';

const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;

export async function saveWallet(wallet, overwrite = false) {
    if (!overwrite) {
        try {
            await fs.access(walletName);
            return false;
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                return false;
            }
            // If the error is 'ENOENT', the file does not exist, so we can ignore it.
        }
    }

    // Create the folder if it doesn't exist
    try {
        await fs.mkdir(dataFolder, { recursive: true });
    }
    catch (error) {
        if (error.code !== 'EEXIST') {
            return false;
        }
        // If the error is 'EEXIST', the directory already exists, so we can ignore it.
    }

    // Write the wallet data to the file
    await fs.writeFile(walletName, JSON.stringify(wallet, null, 4));
    return true;
}

export async function loadWallet() {
    let walletJson;

    try {
        walletJson = await fs.readFile(walletName, 'utf-8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            // Return null if the wallet file doesn't exist
            return null;
        }
        // If the error is anything else, rethrow it.
        throw error;
    }

    try {
        return JSON.parse(walletJson);
    }
    catch (error) {
        //throw new Error(`Bad JSON ${walletJson}`);
        return null;
    }
}
