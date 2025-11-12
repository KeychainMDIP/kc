import { EncryptedWalletV0, WalletFile, WalletEncFile } from "../types.js";

export function isWalletEncryptedV0(obj: any): obj is EncryptedWalletV0 {
    return obj != null
        && typeof obj === 'object'
        && 'salt' in obj
        && 'iv' in obj
        && 'data' in obj;
}

export function isWalletEncrypted(obj: any): obj is WalletEncFile {
    return !!obj
        && typeof obj.version === 'number'
        && obj.version > 0
        && typeof obj.enc === 'string'
        && obj.seed?.mnemonicEnc;
}

export function isWalletDecrypted(obj: any): obj is WalletFile {
    return !!obj
        && typeof obj.version === 'number'
        && obj.version > 0
        && obj.seed?.mnemonicEnc
        && !('enc' in obj);
}

