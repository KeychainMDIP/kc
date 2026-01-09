package org.keychain.crypto;

public interface KeymasterCrypto {
    String generateMnemonic();

    HdKey generateHdKey(String mnemonic);
    HdKey generateHdKeyJson(HdKeyJson json);

    JwkPair generateJwk(byte[] privateKeyBytes);
    JwkPair generateRandomJwk();
    byte[] convertJwkToCompressedBytes(JwkPublic jwk);

    String hashMessage(String msg);
    String hashMessage(byte[] bytes);
    String hashJson(Object obj);

    String signHash(String msgHashHex, JwkPrivate privateJwk);
    boolean verifySig(String msgHashHex, String sigCompactHex, JwkPublic publicJwk);

    String encryptBytes(JwkPublic pubKey, JwkPrivate privKey, byte[] data);
    byte[] decryptBytes(JwkPublic pubKey, JwkPrivate privKey, String ciphertextB64Url);

    String encryptMessage(JwkPublic pubKey, JwkPrivate privKey, String message);
    String decryptMessage(JwkPublic pubKey, JwkPrivate privKey, String ciphertextB64Url);

    String generateRandomSalt();
}
