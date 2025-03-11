import {EncryptedWallet, StoredWallet} from "../types.js";

export function isEncryptedWallet(wallet: StoredWallet): wallet is EncryptedWallet {
    return wallet != null
        && typeof wallet === 'object'
        && 'salt' in wallet
        && 'iv' in wallet
        && 'data' in wallet;
}
