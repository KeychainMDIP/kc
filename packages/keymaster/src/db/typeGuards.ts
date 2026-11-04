import {
    IDInfo,
    LegacyIDInfo,
    LegacyWalletEncFile,
    LegacyWalletFile,
    WalletFile,
} from "../types.js";

export function isV2Wallet(obj: any): obj is WalletFile {
    return !!obj && typeof obj === 'object' && !Array.isArray(obj)
        && obj.version === 2
        && typeof obj.provider?.type === 'string' && !!obj.provider.type
        && typeof obj.provider?.walletFingerprint === 'string' && !!obj.provider.walletFingerprint
        && !!obj.ids && typeof obj.ids === 'object' && !Array.isArray(obj.ids)
        && Object.values(obj.ids).every(isValidIDInfo)
        && !('seed' in obj) && !('enc' in obj);
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

export function isValidIDInfo(id: any): id is IDInfo {
    return !!id && typeof id === 'object' && !Array.isArray(id)
        && typeof id.did === 'string' && !!id.did
        && typeof id.keyRef === 'string' && !!id.keyRef;
}

export function isValidLegacyIDInfo(id: any): id is LegacyIDInfo {
    return !!id && typeof id === 'object' && !Array.isArray(id)
        && typeof id.did === 'string' && !!id.did
        && Number.isSafeInteger(id.account) && id.account >= 0
        && Number.isSafeInteger(id.index) && id.index >= 0;
}

export function isValidWalletPayload(data: any): boolean {
    return !!data && typeof data === 'object' && !Array.isArray(data)
        && !('seed' in data) && !('version' in data) && !('enc' in data)
        && Number.isSafeInteger(data.counter) && data.counter >= 0
        && !!data.ids && typeof data.ids === 'object' && !Array.isArray(data.ids)
        && Object.values(data.ids).every(isValidLegacyIDInfo);
}
