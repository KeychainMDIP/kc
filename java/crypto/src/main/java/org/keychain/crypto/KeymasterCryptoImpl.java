package org.keychain.crypto;

import org.keychain.crypto.util.Base64Url;
import org.keychain.crypto.util.Bytes;

public class KeymasterCryptoImpl implements KeymasterCrypto {
    @Override
    public String generateMnemonic() {
        return MnemonicUtil.generateMnemonic();
    }

    @Override
    public HdKey generateHdKey(String mnemonic) {
        return HdKeyUtil.toHdKey(HdKeyUtil.masterFromMnemonic(mnemonic));
    }

    @Override
    public HdKey generateHdKeyJson(HdKeyJson json) {
        if (json == null) throw new IllegalArgumentException("json is required");
        return HdKeyUtil.toHdKey(HdKeyUtil.fromXpriv(json.xpriv));
    }

    @Override
    public JwkPair generateJwk(byte[] privateKeyBytes) {
        return Secp256k1Jwk.fromPrivateKey(privateKeyBytes);
    }

    @Override
    public JwkPair generateRandomJwk() {
        while (true) {
            try {
                return Secp256k1Jwk.fromPrivateKey(Bytes.random(32));
            } catch (IllegalArgumentException ignored) {
                // Rejection sampling keeps the secret scalar inside the curve order.
            }
        }
    }

    @Override
    public byte[] convertJwkToCompressedBytes(JwkPublic jwk) {
        return Secp256k1Jwk.toCompressed(jwk);
    }

    @Override
    public String hashMessage(String msg) {
        return Hashing.sha256Hex(msg);
    }

    @Override
    public String hashMessage(byte[] bytes) {
        return Hashing.sha256Hex(bytes);
    }

    @Override
    public String hashJson(Object obj) {
        return Hashing.hashCanonicalJson(obj);
    }

    @Override
    public String signHash(String msgHashHex, JwkPrivate privateJwk) {
        return Secp256k1Sign.signHash(msgHashHex, privateJwk);
    }

    @Override
    public boolean verifySig(String msgHashHex, String sigCompactHex, JwkPublic publicJwk) {
        return Secp256k1Sign.verifySig(msgHashHex, sigCompactHex, publicJwk);
    }

    @Override
    public String encryptBytes(JwkPublic pubKey, JwkPrivate privKey, byte[] data) {
        byte[] shared = Secp256k1Ecdh.sharedSecretCompressed(pubKey, privKey);
        byte[] key32 = Secp256k1Ecdh.deriveKey32(shared);
        return XChaCha20Util.encrypt(key32, data);
    }

    @Override
    public byte[] decryptBytes(JwkPublic pubKey, JwkPrivate privKey, String ciphertextB64Url) {
        byte[] shared = Secp256k1Ecdh.sharedSecretCompressed(pubKey, privKey);
        byte[] key32 = Secp256k1Ecdh.deriveKey32(shared);
        return XChaCha20Util.decrypt(key32, ciphertextB64Url);
    }

    @Override
    public String encryptMessage(JwkPublic pubKey, JwkPrivate privKey, String message) {
        return encryptBytes(pubKey, privKey, Bytes.utf8(message));
    }

    @Override
    public String decryptMessage(JwkPublic pubKey, JwkPrivate privKey, String ciphertextB64Url) {
        return Bytes.fromUtf8(decryptBytes(pubKey, privKey, ciphertextB64Url));
    }

    @Override
    public String generateRandomSalt() {
        return "u" + Base64Url.encode(Bytes.random(32));
    }
}
