import * as bip39 from 'bip39';
import * as secp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto/utils'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';
import { base64url } from 'multiformats/bases/base64';
import { Cipher, HDKeyJSON, EcdsaJwkPublic, EcdsaJwkPrivate, EcdsaJwkPair } from './types.js';

// vv Browser specific modifications
import HDKeyBrowser from '@mdip/browser-hdkey';
// ^^ Browser specific modifications

import canonicalizeModule from 'canonicalize';
const canonicalize = canonicalizeModule as unknown as (input: unknown) => string;

// Polyfill for synchronous signatures
// Recommendation from https://github.com/paulmillr/noble-secp256k1/blob/main/README.md
secp.etc.hmacSha256Sync = (k: Uint8Array, ...m: Uint8Array[]): Uint8Array => hmac(sha256, k, secp.etc.concatBytes(...m));

export default class CipherWeb implements Cipher {
    generateMnemonic(): string {
        return bip39.generateMnemonic();
    }

    generateHDKey(mnemonic: string): HDKeyBrowser {
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        return HDKeyBrowser.fromMasterSeed(seed);
    }

    generateHDKeyJSON(json: HDKeyJSON): HDKeyBrowser {
        return HDKeyBrowser.fromJSON(json);
    }

    generateJwk(privateKeyBytes: Uint8Array): EcdsaJwkPair {
        const compressedPublicKeyBytes = secp.getPublicKey(privateKeyBytes);
        const compressedPublicKeyHex = secp.etc.bytesToHex(compressedPublicKeyBytes);
        const curvePoints = secp.ProjectivePoint.fromHex(compressedPublicKeyHex);
        const uncompressedPublicKeyBytes = curvePoints.toRawBytes(false); // false = uncompressed
        // we need uncompressed public key so that it contains both the x and y values for the JWK format:
        // the first byte is a header that indicates whether the key is uncompressed (0x04 if uncompressed).
        // bytes 1 - 32 represent X
        // bytes 33 - 64 represent Y
        const d = base64url.baseEncode(privateKeyBytes);
        // skip the first byte because it's used as a header to indicate whether the key is uncompressed
        const x = base64url.baseEncode(uncompressedPublicKeyBytes.subarray(1, 33));
        const y = base64url.baseEncode(uncompressedPublicKeyBytes.subarray(33, 65));

        const publicJwk: EcdsaJwkPublic = {
            // alg: 'ES256K',
            kty: 'EC',
            crv: 'secp256k1',
            x,
            y
        };

        const privateJwk: EcdsaJwkPrivate = { ...publicJwk, d };

        return { publicJwk, privateJwk };
    }

    generateRandomJwk(): EcdsaJwkPair {
        const privKey = secp.utils.randomPrivateKey();
        return this.generateJwk(privKey);
    }

    convertJwkToCompressedBytes(jwk: EcdsaJwkPublic): Uint8Array {
        const xBytes = base64url.baseDecode(jwk.x);
        const yBytes = base64url.baseDecode(jwk.y);

        // Determine the prefix (02 for even y, 03 for odd y)
        const prefix = yBytes[yBytes.length - 1] % 2 === 0 ? 0x02 : 0x03;

        // Construct compressed key
        return new Uint8Array([prefix, ...xBytes]);
    }

    hashMessage(msg: string | Uint8Array): string {
        const hash = sha256(msg);
        return Buffer.from(hash).toString('hex');
    }

    hashJSON(json: unknown): string {
        const canonical = canonicalize(json);
        return this.hashMessage(canonical);
    }
    
    canonicalizeJSON(json: unknown): string {
        return canonicalize(json);
    }

    signHash(msgHash: string, privateJwk: EcdsaJwkPrivate): string {
        const privKey = base64url.baseDecode(privateJwk.d);
        const signature = secp.sign(msgHash, privKey);

        return signature.toCompactHex();
    }

    verifySig(msgHash: string, sigHex: string, publicJwk: EcdsaJwkPublic): boolean {
        const compressedPublicKeyBytes = this.convertJwkToCompressedBytes(publicJwk);
        const signature = secp.Signature.fromCompact(sigHex);

        return secp.verify(signature, msgHash, compressedPublicKeyBytes);
    }

    encryptBytes(pubKey: EcdsaJwkPublic, privKey: EcdsaJwkPrivate, data: Uint8Array): string {
        const priv = base64url.baseDecode(privKey.d);
        const pub = this.convertJwkToCompressedBytes(pubKey);
        const ss = secp.getSharedSecret(priv, pub);
        const key = ss.slice(0, 32);
        const chacha = managedNonce(xchacha20poly1305)(key);
        const ciphertext = chacha.encrypt(data);

        return base64url.baseEncode(ciphertext);
    }

    decryptBytes(pubKey: EcdsaJwkPublic, privKey: EcdsaJwkPrivate, ciphertext: string): Uint8Array {
        const priv = base64url.baseDecode(privKey.d);
        const pub = this.convertJwkToCompressedBytes(pubKey);
        const ss = secp.getSharedSecret(priv, pub);
        const key = ss.slice(0, 32);
        const chacha = managedNonce(xchacha20poly1305)(key);
        const cipherdata = base64url.baseDecode(ciphertext);

        return chacha.decrypt(cipherdata);
    }

    encryptMessage(pubKey: EcdsaJwkPublic, privKey: EcdsaJwkPrivate, message: string): string {
        const data = utf8ToBytes(message);
        return this.encryptBytes(pubKey, privKey, data);
    }

    decryptMessage(pubKey: EcdsaJwkPublic, privKey: EcdsaJwkPrivate, ciphertext: string): string {
        const data = this.decryptBytes(pubKey, privKey, ciphertext);
        return bytesToUtf8(data);
    }

    generateRandomSalt(): string {
        const array = new Uint8Array(32);
        if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(array);
        } else if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
            globalThis.crypto.getRandomValues(array);
        } else {
            throw new Error('No secure random number generator available.');
        }
        return base64url.encode(array);
    }
}
