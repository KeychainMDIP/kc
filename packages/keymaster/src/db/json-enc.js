import crypto from 'crypto';

const algorithm = 'aes-256-gcm';      // Algorithm
const keyLength = 32;                 // 256 bit AES-256
const ivLength = 12;                  // 96-bit IV, standard for AES-GCM
const saltLength = 16;                // 128-bit salt
const iterations = 100000;            // PBKDF2 iterations
const digest = 'sha512';              // PBKDF2 hash function

export default class WalletEncrypted {
    constructor(baseWallet, passphrase) {
        this.baseWallet = baseWallet;
        this.passphrase = passphrase;
    }

    saveWallet(wallet, overwrite = false) {
        if (!this.passphrase) {
            throw new Error('KC_ENCRYPTED_PASSPHRASE not set');
        }

        const walletJson = JSON.stringify(wallet, null, 4);
        const salt = crypto.randomBytes(saltLength);
        const key = crypto.pbkdf2Sync(this.passphrase, salt, iterations, keyLength, digest);
        const iv = crypto.randomBytes(ivLength);
        const cipher = crypto.createCipheriv(algorithm, key, iv);

        let encrypted = cipher.update(walletJson, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);

        const authTag = cipher.getAuthTag();
        const combined = Buffer.concat([encrypted, authTag]);

        const encryptedData = {
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            data: combined.toString('base64')
        };

        return this.baseWallet.saveWallet(encryptedData, overwrite);
    }

    loadWallet() {
        if (!this.passphrase) {
            throw new Error('KC_ENCRYPTED_PASSPHRASE not set');
        }

        const encryptedData = this.baseWallet.loadWallet();
        if (!encryptedData) {
            return null;
        }

        if (!encryptedData.salt || !encryptedData.iv || !encryptedData.data) {
            throw new Error('Wallet not encrypted');
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
            decrypted = decipher.update(encryptedJSON, null, 'utf8');
            decrypted += decipher.final('utf8');
        } catch (err) {
            throw new Error('Incorrect passphrase.');
        }

        return JSON.parse(decrypted);
    }
}
