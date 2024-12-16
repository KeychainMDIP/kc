let baseWallet;
let cachedWallet;

export function setWallet(wallet) {
    baseWallet = wallet;
}

export async function saveWallet(wallet, overwrite = false) {
    cachedWallet = wallet;
    return await baseWallet.saveWallet(wallet, overwrite);
}

export async function loadWallet() {
    if (!cachedWallet) {
        cachedWallet = await baseWallet.loadWallet();
    }

    return cachedWallet;
}
