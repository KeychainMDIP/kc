import * as bip39 from 'bip39';
import * as secp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto/utils'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';
import { base64url } from 'multiformats/bases/base64';
import canonicalize from 'canonicalize';

// vv Browser specific modifications
import HDKey from '@mdip/browser-hdkey';
// ^^ Browser specific modifications

// Polyfill for synchronous signatures
// Recommendation from https://github.com/paulmillr/noble-secp256k1/blob/main/README.md
secp.etc.hmacSha256Sync = (k, ...m) => hmac(sha256, k, secp.etc.concatBytes(...m));

export default class CipherWeb {
    generateMnemonic() {
        return bip39.generateMnemonic();
    }

    generateHDKey(mnemonic) {
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        return HDKey.fromMasterSeed(seed);
    }

    generateHDKeyJSON(json) {
        return HDKey.fromJSON(json);
    }

    generateJwk(privateKeyBytes) {
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

        const publicJwk = {
            // alg: 'ES256K',
            kty: 'EC',
            crv: 'secp256k1',
            x,
            y
        };

        const privateJwk = { ...publicJwk, d };

        return { publicJwk: publicJwk, privateJwk: privateJwk };
    }

    generateRandomJwk() {
        const privKey = secp.utils.randomPrivateKey();
        return this.generateJwk(privKey);
    }

    convertJwkToCompressedBytes(jwk) {
        const xBytes = base64url.baseDecode(jwk.x);
        const yBytes = base64url.baseDecode(jwk.y);

        // Determine the prefix (02 for even y, 03 for odd y)
        const prefix = yBytes[yBytes.length - 1] % 2 === 0 ? 0x02 : 0x03;

        // Construct compressed key
        return new Uint8Array([prefix, ...xBytes]);
    }

    hashMessage(msg) {
        const hash = sha256(msg);
        return Buffer.from(hash).toString('hex');
    }

    hashJSON(json) {
        return this.hashMessage(canonicalize(json));
    }

    signHash(msgHash, privateJwk) {
        const privKey = base64url.baseDecode(privateJwk.d);
        const signature = secp.sign(msgHash, privKey);

        return signature.toCompactHex();
    }

    verifySig(msgHash, sigHex, publicJwk) {
        const compressedPublicKeyBytes = this.convertJwkToCompressedBytes(publicJwk);
        const signature = secp.Signature.fromCompact(sigHex);

        return secp.verify(signature, msgHash, compressedPublicKeyBytes);
    }

    encryptMessage(pubKey, privKey, message) {
        const priv = base64url.baseDecode(privKey.d);
        const pub = this.convertJwkToCompressedBytes(pubKey);
        const ss = secp.getSharedSecret(priv, pub);
        const key = ss.slice(0, 32);
        const chacha = managedNonce(xchacha20poly1305)(key); // manages nonces for you
        const data = utf8ToBytes(message);
        const ciphertext = chacha.encrypt(data);

        return base64url.baseEncode(ciphertext);
    }

    decryptMessage(pubKey, privKey, ciphertext) {
        const priv = base64url.baseDecode(privKey.d);
        const pub = this.convertJwkToCompressedBytes(pubKey);
        const ss = secp.getSharedSecret(priv, pub);
        const key = ss.slice(0, 32);
        const chacha = managedNonce(xchacha20poly1305)(key); // manages nonces for you
        const cipherdata = base64url.baseDecode(ciphertext);
        const data = chacha.decrypt(cipherdata);

        return bytesToUtf8(data);
    }
}
