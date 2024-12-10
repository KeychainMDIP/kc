import fs from 'fs';
import crypto from 'crypto';

const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;

const algorithm = 'aes-256-cbc';       // Algorithm
const keyLength = 32;                 // 256 bit AES-256
const ivLength = 16;                  // 128-bit AES block size
const saltLength = 16;                // 128-bit salt
const iterations = 200000;            // PBKDF2 iterations
const digest = 'sha512';               // PBKDF2 hash function

let passphrase;

export function setPassphrase(pp) {
    passphrase = pp;
}

export function saveWallet(wallet, overwrite = false) {
    if (fs.existsSync(walletName) && !overwrite) {
        return false;
    }

    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    if (!passphrase) {
        throw new Error('KC_ENCRYPTED_PASSPHRASE not set');
    }

    const walletJson = JSON.stringify(wallet, null, 4);
    const salt = crypto.randomBytes(saltLength);
    const key = crypto.pbkdf2Sync(passphrase, salt, iterations, keyLength, digest);
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    let encrypted = cipher.update(walletJson, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const encryptedData = {
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        data: encrypted
    };

    fs.writeFileSync(walletName, JSON.stringify(encryptedData, null, 4));

    return true;
}

export function loadWallet() {
    if (!fs.existsSync(walletName)) {
        return null;
    }

    if (!passphrase) {
        throw new Error('KC_ENCRYPTED_PASSPHRASE not set');
    }

    const encryptedJson = fs.readFileSync(walletName, 'utf8');
    const encryptedData = JSON.parse(encryptedJson);

    if (!encryptedData || !encryptedData.salt || !encryptedData.iv || !encryptedData.data) {
        throw new Error('Wallet not encrypted');
    }

    const salt = Buffer.from(encryptedData.salt, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const encryptedJSON = encryptedData.data;
    const key = crypto.pbkdf2Sync(passphrase, salt, iterations, keyLength, digest);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);

    let decrypted;
    try {
        decrypted = decipher.update(encryptedJSON, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
    } catch (err) {
        throw new Error('Incorrect passphrase.');
    }

    return JSON.parse(decrypted);
}
