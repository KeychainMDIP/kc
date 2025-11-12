import {EncryptedWallet, WalletFile, WalletEncFile} from "../types.js";

export function isEncryptedWallet(obj: any): obj is EncryptedWallet {
    return obj != null
        && typeof obj === 'object'
        && 'salt' in obj
        && 'iv' in obj
        && 'data' in obj;
}

export function isV1WithEnc(obj: any): obj is WalletEncFile {
    return !!obj && obj.version === 1 && typeof obj.enc === 'string' && obj.seed?.mnemonicEnc;
}

export function isV1Decrypted(obj: any): obj is WalletFile {
    return !!obj && obj.version === 1 && obj.seed?.mnemonicEnc && !('enc' in obj);
}

export function isLegacyV0(obj: any): obj is WalletFile {
    return !!obj && (!obj.version || obj.version === 0) && !!obj.seed?.hdkey && typeof obj.seed.mnemonic === 'string';
}
