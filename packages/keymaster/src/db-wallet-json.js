import fs from 'fs/promises';

const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;

export async function saveWallet(wallet, overwrite) {
    if (!overwrite) {
        try {
            await fs.access(walletName);
            return false;
        }
        catch (error) {
            // If the file does not exist, we can ignore it.
        }
    }

    // Create the folder if it doesn't exist
    try {
        await fs.mkdir(dataFolder, { recursive: true });
    }
    catch (error) {
        // If the directory already exists, we can ignore it.
    }

    // Write the wallet data to the file
    await fs.writeFile(walletName, JSON.stringify(wallet, null, 4));
    return true;
}

export async function loadWallet() {
    try {
        const walletJson = await fs.readFile(walletName, 'utf-8');
        return JSON.parse(walletJson);
    }
    catch (error) {
        // Return null if the wallet can't be read and parsed
        return null;
    }
}
