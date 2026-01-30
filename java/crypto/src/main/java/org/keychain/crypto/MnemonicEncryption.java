package org.keychain.crypto;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

public final class MnemonicEncryption {
    private static final String ENC_ALG = "AES/GCM/NoPadding";
    private static final String ENC_KDF = "PBKDF2WithHmacSHA512";
    private static final int ENC_ITER = 100_000;
    private static final int IV_LEN = 12;
    private static final int SALT_LEN = 16;
    private static final int KEY_LEN = 256;

    private static final SecureRandom RNG = new SecureRandom();

    private MnemonicEncryption() {}

    public static EncryptedMnemonic encrypt(String mnemonic, String passphrase) {
        byte[] salt = new byte[SALT_LEN];
        byte[] iv = new byte[IV_LEN];
        RNG.nextBytes(salt);
        RNG.nextBytes(iv);
        return encrypt(mnemonic, passphrase, salt, iv);
    }

    public static EncryptedMnemonic encrypt(String mnemonic, String passphrase, byte[] salt, byte[] iv) {
        if (mnemonic == null || passphrase == null) {
            throw new IllegalArgumentException("mnemonic and passphrase are required");
        }
        if (salt == null || salt.length != SALT_LEN) {
            throw new IllegalArgumentException("salt must be 16 bytes");
        }
        if (iv == null || iv.length != IV_LEN) {
            throw new IllegalArgumentException("iv must be 12 bytes");
        }

        try {
            SecretKey key = deriveKey(passphrase, salt);
            Cipher cipher = Cipher.getInstance(ENC_ALG);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] ct = cipher.doFinal(mnemonic.getBytes(StandardCharsets.UTF_8));

            return new EncryptedMnemonic(
                Base64.getEncoder().encodeToString(salt),
                Base64.getEncoder().encodeToString(iv),
                Base64.getEncoder().encodeToString(ct)
            );
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Mnemonic encryption failed", e);
        }
    }

    public static String decrypt(EncryptedMnemonic blob, String passphrase) {
        if (blob == null || passphrase == null) {
            throw new IllegalArgumentException("blob and passphrase are required");
        }

        try {
            byte[] salt = Base64.getDecoder().decode(blob.salt);
            byte[] iv = Base64.getDecoder().decode(blob.iv);
            byte[] data = Base64.getDecoder().decode(blob.data);

            SecretKey key = deriveKey(passphrase, salt);
            Cipher cipher = Cipher.getInstance(ENC_ALG);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] pt = cipher.doFinal(data);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Mnemonic decryption failed", e);
        }
    }

    private static SecretKey deriveKey(String passphrase, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(passphrase.toCharArray(), salt, ENC_ITER, KEY_LEN);
        SecretKeyFactory factory = SecretKeyFactory.getInstance(ENC_KDF);
        byte[] keyBytes = factory.generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }
}
