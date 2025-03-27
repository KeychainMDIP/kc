import { WalletBase, StoredWallet} from '../types.js'
import { isEncryptedWallet } from './typeGuards.js';

const algorithm = 'AES-GCM';
const kdf = 'PBKDF2';
const hash = 'SHA-512';
const keyLength = 256;                // 256 bit AES-256
const ivLength = 12;                  // 96-bit IV, standard for AES-GCM
const saltLength = 16;                // 128-bit salt
const iterations = 100000;            // PBKDF2 iterations

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
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

export default class WalletWebEncrypted implements WalletBase {
    private baseWallet: WalletBase;
    private readonly passphrase: string;

    constructor(baseWallet: WalletBase, passphrase: string) {
        this.baseWallet = baseWallet;
        this.passphrase = passphrase;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        if (!this.passphrase) {
            throw new Error('Passphrase not set');
        }

        const walletJson = JSON.stringify(wallet, null, 4);
        const salt = crypto.getRandomValues(new Uint8Array(saltLength));
        const key = await deriveKey(this.passphrase, salt);
        const iv = crypto.getRandomValues(new Uint8Array(ivLength));
        const data = textEncoder.encode(walletJson);

        const ciphertext = await crypto.subtle.encrypt(
            { name: algorithm, iv },
            key,
            data
        );

        const encryptedData = {
            salt: bufferToBase64(salt),
            iv: bufferToBase64(iv),
            data: bufferToBase64(ciphertext)
        };

        return await this.baseWallet.saveWallet(encryptedData, overwrite);
    }

    async loadWallet(): Promise<StoredWallet> {
        if (!this.passphrase) {
            throw new Error('Passphrase not set');
        }

        const encryptedData = await this.baseWallet.loadWallet();
        if (!encryptedData) {
            return null;
        }

        if (!isEncryptedWallet(encryptedData)) {
            throw new Error('Wallet not encrypted');
        }

        const salt = new Uint8Array(base64ToBuffer(encryptedData.salt));
        const iv = new Uint8Array(base64ToBuffer(encryptedData.iv));
        const ciphertext = base64ToBuffer(encryptedData.data);
        const key = await deriveKey(this.passphrase, salt);

        let decrypted;
        try {
            decrypted = await crypto.subtle.decrypt(
                { name: algorithm, iv },
                key,
                ciphertext
            );
        } catch (err) {
            throw new Error('Incorrect passphrase.');
        }

        const decryptedJson = textDecoder.decode(new Uint8Array(decrypted));
        return JSON.parse(decryptedJson);
    }
}
