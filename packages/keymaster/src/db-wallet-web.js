const walletName = 'mdip-keymaster';

export function saveWallet(wallet, overwrite = false) {
    if (!overwrite && window.localStorage.getItem(walletName)) {
        return false;
    }

    window.localStorage.setItem(walletName, JSON.stringify(wallet));
    return true;
}

export function loadWallet() {
    const walletJson = window.localStorage.getItem(walletName);

    if (walletJson) {
        return JSON.parse(walletJson);
    }

    return newWallet();
}
