import crypto from 'crypto';
import { StoredWallet, WalletBase } from '../types.js';
import { AbstractBase } from './abstract-base.js';
import { isEncryptedWallet } from './typeGuards.js';

const algorithm = 'aes-256-gcm';      // Algorithm
const keyLength = 32;                 // 256 bit AES-256
const iterations = 100000;            // PBKDF2 iterations
const digest = 'sha512';              // PBKDF2 hash function

export default class WalletEncrypted extends AbstractBase {
    private baseWallet: WalletBase;
    private readonly passphrase: string;

    constructor(baseWallet: WalletBase, passphrase: string) {
        super();
        this.baseWallet = baseWallet;
        this.passphrase = passphrase;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        // encryption wrapper deprecated, save without encrypting
        return this.baseWallet.saveWallet(wallet, overwrite);
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
            throw new Error('KC_ENCRYPTED_PASSPHRASE not set');
        }

        const salt = Buffer.from(encryptedData.salt, 'base64');
        const iv = Buffer.from(encryptedData.iv, 'base64');
        const combined = Buffer.from(encryptedData.data, 'base64');

        const authTag = combined.subarray(combined.length - 16);
        const encryptedJSON = combined.subarray(0, combined.length - 16);
        const key = crypto.pbkdf2Sync(this.passphrase, salt, iterations, keyLength, digest);
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted;
        try {
            decrypted = decipher.update(encryptedJSON, undefined, 'utf8');
            decrypted += decipher.final('utf8');
        } catch (err) {
            throw new Error('Incorrect passphrase.');
        }

        return JSON.parse(decrypted);
    }
}
