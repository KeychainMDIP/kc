
const ENC_ALG = 'AES-GCM';
const ENC_KDF = 'PBKDF2';
const ENC_HASH = 'SHA-512';
const ENC_ITER = 100_000;
const IV_LEN = 12;
const SALT_LEN = 16;

export async function encMnemonic(mnemonic: string, pass: string) {
    const salt = await randBytes(SALT_LEN);
    const iv = await randBytes(IV_LEN);

    if (hasSubtle()) {
        const key = await deriveKey(pass, salt);
        const ct = await crypto.subtle.encrypt({ name: ENC_ALG, iv }, key, new TextEncoder().encode(mnemonic));
        return { salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) };
    }

    const mod = await import('node-forge');
    const forge = (mod as any).default ?? mod;

    const keyRaw = await deriveKeyRaw(pass, salt);
    const keyStr = u8ToStr(keyRaw);
    const ivStr  = u8ToStr(iv);

    const cipher = forge.cipher.createCipher('AES-GCM', keyStr);
    cipher.start({ iv: ivStr, tagLength: 128 });
    cipher.update(forge.util.createBuffer(mnemonic, 'utf8'));
    cipher.finish();

    const ct  = strToU8(cipher.output.getBytes());
    const tag = strToU8(cipher.mode.tag.getBytes());
    const packed = concatU8(ct, tag);

    return { salt: b64(salt), iv: b64(iv), data: b64(packed) };
}

export async function decMnemonic(blob: { salt: string; iv: string; data: string }, pass: string) {
    const salt = ub64(blob.salt);
    const iv = ub64(blob.iv);
    const data = ub64(blob.data);

    if (hasSubtle()) {
        const key = await deriveKey(pass, salt);
        const pt = await crypto.subtle.decrypt({ name: ENC_ALG, iv }, key, data);
        return new TextDecoder().decode(pt);
    }

    const mod = await import('node-forge');
    const forge = (mod as any).default ?? mod;

    const keyRaw = await deriveKeyRaw(pass, salt);
    const keyStr = u8ToStr(keyRaw);
    const ivStr  = u8ToStr(iv);

    const TAG_LEN = 16;
    const ct  = data.slice(0, data.length - TAG_LEN);
    const tag = data.slice(data.length - TAG_LEN);

    const decipher = forge.cipher.createDecipher('AES-GCM', keyStr);
    decipher.start({ iv: ivStr, tagLength: 128, tag: u8ToStr(tag) });
    decipher.update(forge.util.createBuffer(u8ToStr(ct)));
    decipher.finish();

    const outBytes = strToU8(decipher.output.getBytes());
    return new TextDecoder().decode(outBytes);
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

const hasRand = () =>
    typeof globalThis !== 'undefined' &&
    (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function');

function concatU8(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

async function randBytes(len: number): Promise<Uint8Array> {
    if (hasRand()) {
        const u8 = new Uint8Array(len);
        crypto.getRandomValues(u8);
        return u8;
    }
    const mod = await import('node-forge');
    const forge = (mod as any).default ?? mod;
    const bytes = forge.random.getBytesSync(len);
    return strToU8(bytes);
}

async function pbkdf2Sha512Fallback(pass: string, salt: Uint8Array, dkLen: number, iter: number): Promise<string /* raw-bytes */> {
    const mod = await import('node-forge');
    const forge = (mod as any).default ?? mod;
    return forge.pkcs5.pbkdf2(pass, u8ToStr(salt), iter, dkLen, 'sha512');
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

async function deriveKeyRaw(pass: string, salt: Uint8Array): Promise<Uint8Array> {
    const keyRawBytes = await pbkdf2Sha512Fallback(pass, salt, 32, ENC_ITER);
    return strToU8(keyRawBytes);
}

function u8ToStr(u8: Uint8Array): string {
    let s = '';
    for (let i = 0; i < u8.length; i++) {
        s += String.fromCharCode(u8[i]);
    }
    return s;
}

function strToU8(s: string): Uint8Array {
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        u8[i] = s.charCodeAt(i) & 0xff;
    }
    return u8;
}
