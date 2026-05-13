import {
    LegacyWalletEncFile,
    LegacyWalletFile,
    WalletFile,
} from "../types.js";

export function isV2Wallet(obj: any): obj is WalletFile {
    return !!obj && obj.version === 2 && typeof obj.provider?.type === 'string' && typeof obj.provider?.walletFingerprint === 'string' && !!obj.ids;
}

export function isV1WithEnc(obj: any): obj is LegacyWalletEncFile {
    return !!obj && obj.version === 1 && typeof obj.enc === 'string' && obj.seed?.mnemonicEnc;
}

export function isV1Decrypted(obj: any): obj is LegacyWalletFile {
    return !!obj && obj.version === 1 && obj.seed?.mnemonicEnc && !('enc' in obj);
}

export function isLegacyV0(obj: any): obj is LegacyWalletFile {
    return !!obj && (!obj.version || obj.version === 0) && !!obj.seed?.hdkey && typeof obj.seed.mnemonic === 'string';
}
