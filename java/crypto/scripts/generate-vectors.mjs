import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CipherNode from '@mdip/cipher/node';
import { base64url } from 'multiformats/bases/base64';
import * as secp from '@noble/secp256k1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cipher = new CipherNode();
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const hdkey = cipher.generateHDKey(mnemonic);

const account = 0;
const index = 0;
const derivationPath = `m/44'/0'/${account}'/0/${index}`;
const derived = hdkey.derive(derivationPath);
const jwkPair = cipher.generateJwk(derived.privateKey);

const hashInput = { foo: 'bar', count: 1, list: [1, 2, 3] };
const hashHex = cipher.hashJSON(hashInput);
const signatureHex = cipher.signHash(hashHex, jwkPair.privateJwk);

const receiverPriv = base64url.baseDecode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI');
const receiverJwk = cipher.generateJwk(receiverPriv);
const plaintext = 'hello keymaster';
const ciphertext = cipher.encryptMessage(receiverJwk.publicJwk, jwkPair.privateJwk, plaintext);

const receiverCompressed = cipher.convertJwkToCompressedBytes(receiverJwk.publicJwk);
const sharedSecret = secp.getSharedSecret(derived.privateKey, receiverCompressed);
const key32 = sharedSecret.slice(0, 32);

const passphrase = 'passphrase';
const salt = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const iv = Uint8Array.from([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
const encKey = await deriveKey(passphrase, salt);
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, new TextEncoder().encode(mnemonic));

const walletPlain = {
    counter: 1,
    ids: {
        Alice: {
            did: 'did:test:alice',
            account: 0,
            index: 0,
            held: ['did:test:cred1'],
            owned: ['did:test:asset1'],
        },
    },
    current: 'Alice',
    names: {
        alias: 'did:test:alice',
    },
};

const masterJwk = cipher.generateJwk(hdkey.privateKey);
const walletEnc = cipher.encryptMessage(masterJwk.publicJwk, masterJwk.privateJwk, JSON.stringify(walletPlain));

const vectors = {
    description: 'Keymaster crypto compatibility vectors (generated from JS reference)',
    version: 1,
    vectors: {
        mnemonic: {
            phrase: mnemonic,
        },
        hdKey: {
            xpriv: hdkey.privateExtendedKey,
            xpub: hdkey.publicExtendedKey,
            account,
            index,
            path: derivationPath,
        },
        jwk: {
            publicJwk: jwkPair.publicJwk,
            privateJwk: jwkPair.privateJwk,
        },
        hash: {
            input: hashInput,
            hashHex,
        },
        signature: {
            hashHex,
            signatureHex,
            signerPublicJwk: jwkPair.publicJwk,
        },
        encrypt: {
            plaintext,
            ciphertext,
            sender: jwkPair,
            receiver: receiverJwk,
        },
        ecdh: {
            sharedSecretCompressedHex: Buffer.from(sharedSecret).toString('hex'),
            key32Hex: Buffer.from(key32).toString('hex'),
        },
        mnemonicEnc: {
            mnemonic,
            passphrase,
            salt: Buffer.from(salt).toString('base64'),
            iv: Buffer.from(iv).toString('base64'),
            data: Buffer.from(new Uint8Array(ct)).toString('base64'),
        },
        walletEnc: {
            version: 1,
            seed: {
                mnemonicEnc: {
                    salt: Buffer.from(salt).toString('base64'),
                    iv: Buffer.from(iv).toString('base64'),
                    data: Buffer.from(new Uint8Array(ct)).toString('base64'),
                },
            },
            enc: walletEnc,
            passphrase,
            wallet: walletPlain,
        },
    },
};

const outputPath = path.join(__dirname, '..', 'src', 'test', 'resources', 'vectors', 'crypto-v1.json');
await fs.writeFile(outputPath, JSON.stringify(vectors, null, 2));
console.log(`Wrote ${outputPath}`);

const walletPath = path.join(__dirname, '..', '..', 'keymaster', 'src', 'test', 'resources', 'vectors', 'wallet-v1.json');
await fs.mkdir(path.dirname(walletPath), { recursive: true });
await fs.writeFile(walletPath, JSON.stringify(vectors.vectors.walletEnc, null, 2));
console.log(`Wrote ${walletPath}`);

async function deriveKey(pass, saltBytes) {
    const passKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pass),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-512' },
        passKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}
