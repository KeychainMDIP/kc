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

        if (!hasSubtle()) {
            throw new Error('Web Cryptography API not available');
        }

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
}
