import { WalletFile, WalletEncFile } from "../types.js";

export function isV1WithEnc(obj: any): obj is WalletEncFile {
    return !!obj && obj.version === 1 && typeof obj.enc === 'string' && obj.seed?.mnemonicEnc;
}

export function isV1Decrypted(obj: any): obj is WalletFile {
    return !!obj && obj.version === 1 && obj.seed?.mnemonicEnc && !('enc' in obj);
}

export function isLegacyV0(obj: any): obj is WalletFile {
    return !!obj && (!obj.version || obj.version === 0) && !!obj.seed?.hdkey && typeof obj.seed.mnemonic === 'string';
}

export function isValidWalletPayload(data: any): boolean {
    return !!data && typeof data === 'object' && !Array.isArray(data)
        && !('seed' in data) && !('version' in data) && !('enc' in data)
        && Number.isSafeInteger(data.counter) && data.counter >= 0
        && !!data.ids && typeof data.ids === 'object' && !Array.isArray(data.ids)
        && Object.values(data.ids).every((id: any) =>
            !!id && typeof id === 'object' && !Array.isArray(id)
            && typeof id.did === 'string' && !!id.did
            && Number.isSafeInteger(id.account) && id.account >= 0
            && Number.isSafeInteger(id.index) && id.index >= 0
        );
}
