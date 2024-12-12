let baseWallet;
let cachedWallet;

export function setWallet(wallet) {
    baseWallet = wallet;
}

export function saveWallet(wallet, overwrite = false) {
    cachedWallet = wallet;
    return baseWallet.saveWallet(wallet, overwrite);
}

export function loadWallet() {
    if (!cachedWallet) {
        cachedWallet = baseWallet.loadWallet();
    }

    return cachedWallet;
}
