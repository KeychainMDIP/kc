import * as bip39 from 'bip39';
import * as secp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto/utils'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';
import { base64url } from 'multiformats/bases/base64';
import { Cipher, HDKeyJSON, EcdsaJwkPublic, EcdsaJwkPrivate, EcdsaJwkPair } from './types.js';
import canonicalizeModule from 'canonicalize';
const canonicalize = canonicalizeModule as unknown as (input: unknown) => string;

// Polyfill for synchronous signatures
secp.etc.hmacSha256Sync = (k: Uint8Array, ...m: Uint8Array[]): Uint8Array => hmac(sha256, k, secp.etc.concatBytes(...m));

export default abstract class CipherBase implements Cipher {
    abstract generateHDKey(mnemonic: string): any;
    abstract generateHDKeyJSON(json: HDKeyJSON): any;
    abstract generateRandomSalt(): string;

    generateMnemonic(): string {
        return bip39.generateMnemonic();
    }

    generateJwk(privateKeyBytes: Uint8Array): EcdsaJwkPair {
        const compressedPublicKeyBytes = secp.getPublicKey(privateKeyBytes);
        const compressedPublicKeyHex = secp.etc.bytesToHex(compressedPublicKeyBytes);
        const curvePoints = secp.ProjectivePoint.fromHex(compressedPublicKeyHex);
        const uncompressedPublicKeyBytes = curvePoints.toRawBytes(false);
        const d = base64url.baseEncode(privateKeyBytes);
        const x = base64url.baseEncode(uncompressedPublicKeyBytes.subarray(1, 33));
        const y = base64url.baseEncode(uncompressedPublicKeyBytes.subarray(33, 65));

        const publicJwk: EcdsaJwkPublic = {
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
        const prefix = yBytes[yBytes.length - 1] % 2 === 0 ? 0x02 : 0x03;
        return new Uint8Array([prefix, ...xBytes]);
    }

    hashMessage(msg: string | Uint8Array): string {
        const hash = sha256(msg);
        return Buffer.from(hash).toString('hex');
    }

    canonicalizeJSON(json: unknown): string {
        return canonicalize(json);
    }

    hashJSON(json: unknown): string {
        return this.hashMessage(this.canonicalizeJSON(json));
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

    hasLeadingZeroBits(hexHash: string, bits: number): boolean {
        const binary = BigInt('0x' + hexHash).toString(2).padStart(hexHash.length * 4, '0');
        return binary.startsWith('0'.repeat(bits));
    }

    addProofOfWork(obj: object, difficulty: number): object {
        if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 256) {
            throw new Error('Invalid difficulty: must be an integer between 0 and 256.');
        }

        let nonce = 0;

        while (true) {
            const candidate = {
                ...obj,
                pow: {
                    nonce: nonce.toString(16),
                    difficulty,
                }
            };
            const hash = this.hashJSON(candidate);

            if (this.hasLeadingZeroBits(hash, difficulty)) {
                return candidate;
            }

            nonce++;
        }
    }

    checkProofOfWork(obj: object): boolean {
        if (
            !obj ||
            typeof obj !== 'object' ||
            !('pow' in obj) ||
            typeof (obj as any).pow !== 'object' ||
            typeof (obj as any).pow.nonce !== 'string' ||
            typeof (obj as any).pow.difficulty !== 'number'
        ) {
            return false;
        }

        const hash = this.hashJSON(obj);

        return this.hasLeadingZeroBits(hash, (obj as any).pow.difficulty);
    }
}
