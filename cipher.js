
import * as secp from '@noble/secp256k1';
import { base64url } from 'multiformats/bases/base64';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto/utils'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';

function generateJwk(privateKeyBytes) {
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

function convertJwkToCompressedBytes(jwk) {
    const xBytes = base64url.baseDecode(jwk.x);
    const yBytes = base64url.baseDecode(jwk.y);

    // Determine the prefix (02 for even y, 03 for odd y)
    const prefix = yBytes[yBytes.length - 1] % 2 === 0 ? 0x02 : 0x03;

    // Construct compressed key
    return new Uint8Array([prefix, ...xBytes]);
}

async function verifySig(msgHash, sigHex, publicJwk) {
    const compressedPublicKeyBytes = convertJwkToCompressedBytes(publicJwk);
    const signature = secp.Signature.fromCompact(sigHex);
    const isValid = secp.verify(signature, msgHash, compressedPublicKeyBytes);
    return isValid;
}

function encryptMessage(pubKey, privKey, message) {
    const priv = base64url.baseDecode(privKey.d);
    const pub = convertJwkToCompressedBytes(pubKey);
    const ss = secp.getSharedSecret(priv, pub);
    const key = ss.slice(0, 32);
    const chacha = managedNonce(xchacha20poly1305)(key); // manages nonces for you
    const data = utf8ToBytes(message);
    const ciphertext = chacha.encrypt(data);

    return base64url.baseEncode(ciphertext);
}

function decryptMessage(pubKey, privKey, ciphertext) {
    const priv = base64url.baseDecode(privKey.d);
    const pub = convertJwkToCompressedBytes(pubKey);
    const ss = secp.getSharedSecret(priv, pub);
    const key = ss.slice(0, 32);
    const chacha = managedNonce(xchacha20poly1305)(key); // manages nonces for you
    const cipherdata = base64url.baseDecode(ciphertext);
    const data = chacha.decrypt(cipherdata);

    return bytesToUtf8(data);
}

export {
    generateJwk,
    verifySig,
    encryptMessage,
    decryptMessage,
}
