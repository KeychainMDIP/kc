
const ENC_ALG = 'AES-GCM';
const ENC_KDF = 'PBKDF2';
const ENC_HASH = 'SHA-512';
const ENC_ITER = 100_000;
const IV_LEN = 12;
const SALT_LEN = 16;

export async function encMnemonic(mnemonic: string, pass: string) {
    const salt = await randBytes(SALT_LEN);
    const iv = await randBytes(IV_LEN);

    if (!hasSubtle()) {
        throw new Error('Web Cryptography API not available');
    }

    const key = await deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: ENC_ALG, iv }, key, new TextEncoder().encode(mnemonic));
    return { salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) };
}

export async function decMnemonic(blob: { salt: string; iv: string; data: string }, pass: string) {
    const salt = ub64(blob.salt);
    const iv = ub64(blob.iv);
    const data = ub64(blob.data);

    if (!hasSubtle()) {
        throw new Error('Web Cryptography API not available');
    }

    const key = await deriveKey(pass, salt);
    const pt = await crypto.subtle.decrypt({ name: ENC_ALG, iv }, key, data);
    return new TextDecoder().decode(pt);
}

const b64 = (buf: Uint8Array) => {
    return Buffer.from(buf).toString('base64');
}

const ub64 = (b64: string) => {
    return new Uint8Array(Buffer.from(b64, 'base64'));
}

const hasSubtle = () =>
    typeof globalThis !== 'undefined' &&
    !!(globalThis.crypto && globalThis.crypto.subtle);

async function randBytes(len: number): Promise<Uint8Array> {
    const u8 = new Uint8Array(len);
    crypto.getRandomValues(u8);
    return u8;
}

async function deriveKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const passKey = await crypto.subtle.importKey('raw', enc.encode(pass), { name: ENC_KDF }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: ENC_KDF, salt, iterations: ENC_ITER, hash: ENC_HASH },
        passKey,
        { name: ENC_ALG, length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}
