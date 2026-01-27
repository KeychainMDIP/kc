package org.keychain.crypto;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

import org.keychain.crypto.util.Hex;

public final class Hashing {
    private Hashing() {}

    public static String sha256Hex(String msg) {
        return sha256Hex(msg.getBytes(StandardCharsets.UTF_8));
    }

    public static String sha256Hex(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return Hex.encode(digest.digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public static String hashCanonicalJson(Object obj) {
        String canonical = CanonicalJson.canonicalize(obj);
        return sha256Hex(canonical.getBytes(StandardCharsets.UTF_8));
    }
}
