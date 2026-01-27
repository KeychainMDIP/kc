package org.keychain.crypto;

import java.nio.charset.StandardCharsets;
import com.google.crypto.tink.aead.internal.InsecureNonceXChaCha20Poly1305;
import org.keychain.crypto.util.Base64Url;
import org.keychain.crypto.util.Bytes;
import java.util.function.Supplier;

public final class XChaCha20Util {
    private static final int NONCE_LENGTH = 24;
    private static final Supplier<byte[]> NONCE_SUPPLIER = () -> Bytes.random(NONCE_LENGTH);

    private XChaCha20Util() {}

    public static String encrypt(byte[] key32, byte[] plaintext) {
        if (key32 == null || key32.length != 32) {
            throw new IllegalArgumentException("key32 must be 32 bytes");
        }

        try {
            byte[] nonce = NONCE_SUPPLIER.get();
            InsecureNonceXChaCha20Poly1305 cipher = new InsecureNonceXChaCha20Poly1305(key32);
            byte[] ciphertext = cipher.encrypt(nonce, plaintext, new byte[0]);

            byte[] out = Bytes.concat(nonce, ciphertext);
            return Base64Url.encode(out);
        } catch (Exception e) {
            throw new IllegalStateException("Encryption failed", e);
        }
    }

    public static byte[] decrypt(byte[] key32, String nonceCiphertextB64Url) {
        if (key32 == null || key32.length != 32) {
            throw new IllegalArgumentException("key32 must be 32 bytes");
        }

        byte[] data = Base64Url.decode(nonceCiphertextB64Url);
        if (data.length <= NONCE_LENGTH) {
            throw new IllegalArgumentException("ciphertext too short");
        }

        byte[] nonce = new byte[NONCE_LENGTH];
        byte[] ciphertext = new byte[data.length - NONCE_LENGTH];
        System.arraycopy(data, 0, nonce, 0, NONCE_LENGTH);
        System.arraycopy(data, NONCE_LENGTH, ciphertext, 0, ciphertext.length);

        try {
            InsecureNonceXChaCha20Poly1305 cipher = new InsecureNonceXChaCha20Poly1305(key32);
            return cipher.decrypt(nonce, ciphertext, new byte[0]);
        } catch (Exception e) {
            throw new IllegalStateException("Decryption failed", e);
        }
    }

    public static String encryptString(byte[] key32, String plaintext) {
        return encrypt(key32, plaintext.getBytes(StandardCharsets.UTF_8));
    }

    public static String decryptToString(byte[] key32, String nonceCiphertextB64Url) {
        return new String(decrypt(key32, nonceCiphertextB64Url), StandardCharsets.UTF_8);
    }
}
