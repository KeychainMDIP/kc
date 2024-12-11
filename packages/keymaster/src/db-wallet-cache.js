let actualWallet;
let cachedWallet;

export function setWallet(wallet) {
    actualWallet = wallet;
}

export function saveWallet(wallet, overwrite = false) {
    cachedWallet = null;
    return actualWallet.saveWallet(wallet, overwrite);
}

export function loadWallet() {
    if (!cachedWallet) {
        cachedWallet = actualWallet.loadWallet();
    }

    return cachedWallet;
}
