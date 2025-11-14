import { StoredWallet, WalletBase } from '../types.js';
import { AbstractBase } from './abstract-base.js';
import { isEncryptedWallet } from './typeGuards.js';

const algorithm = 'AES-GCM';
const kdf = 'PBKDF2';
const hash = 'SHA-512';
const keyLength = 256;                // 256 bit AES-256
const iterations = 100000;            // PBKDF2 iterations

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64ToBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function hasSubtle(): boolean {
    return typeof globalThis !== 'undefined' &&
        !!(globalThis.crypto && globalThis.crypto.subtle);
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

async function deriveKeyRaw(pass: string, salt: Uint8Array): Promise<Uint8Array> {
    const mod = await import('node-forge');
    const forge = (mod as any).default ?? mod;
    const raw = forge.pkcs5.pbkdf2(pass, u8ToStr(salt), iterations, 32, 'sha512');
    return strToU8(raw);
}

async function deriveKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
    const passKey = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(pass),
        { name: kdf },
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: kdf,
            salt,
            iterations,
            hash
        },
        passKey,
        { name: algorithm, length: keyLength },
        false,
        ["encrypt", "decrypt"]
    );
}

export default class WalletWebEncrypted extends AbstractBase {
    private baseWallet: WalletBase;
    private readonly passphrase: string;

    constructor(baseWallet: WalletBase, passphrase: string) {
        super();
        this.baseWallet = baseWallet;
        this.passphrase = passphrase;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        // encryption wrapper deprecated, save without encrypting
        return await this.baseWallet.saveWallet(wallet, overwrite);
    }

    async loadWallet(): Promise<StoredWallet | null> {
        const encryptedData = await this.baseWallet.loadWallet();
        if (!encryptedData) {
            return null;
        }

        if (!isEncryptedWallet(encryptedData)) {
            return encryptedData;
        }

        if (!this.passphrase) {
            throw new Error('Passphrase not set');
        }

        const salt = new Uint8Array(base64ToBuffer(encryptedData.salt));
        const iv = new Uint8Array(base64ToBuffer(encryptedData.iv));
        const dataU8 = new Uint8Array(base64ToBuffer(encryptedData.data));

        if (hasSubtle()) {
            const key = await deriveKey(this.passphrase, salt);
            try {
                const decrypted = await crypto.subtle.decrypt(
                    { name: algorithm, iv },
                    key,
                    dataU8
                );

                const decryptedJson = textDecoder.decode(new Uint8Array(decrypted));
                return JSON.parse(decryptedJson);
            } catch (err) {
                throw new Error('Incorrect passphrase.');
            }
        }

        const mod = await import('node-forge');
        const forge = (mod as any).default ?? mod;

        const keyRaw = await deriveKeyRaw(this.passphrase, salt); // 32 bytes
        const keyStr = u8ToStr(keyRaw);
        const ivStr  = u8ToStr(iv);

        const TAG_LEN = 16;
        const ct  = dataU8.subarray(0, dataU8.length - TAG_LEN);
        const tag = dataU8.subarray(dataU8.length - TAG_LEN);

        const decipher = forge.cipher.createDecipher('AES-GCM', keyStr);
        decipher.start({ iv: ivStr, tagLength: 128, tag: u8ToStr(tag) });
        decipher.update(forge.util.createBuffer(u8ToStr(ct)));
        decipher.finish();

        const bytes = strToU8(decipher.output.getBytes());
        const json = textDecoder.decode(bytes);
        return JSON.parse(json);
    }
}
