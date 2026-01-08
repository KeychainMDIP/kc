package org.keychain.crypto.util;

import java.security.SecureRandom;

public final class Bytes {
    private static final SecureRandom RNG = new SecureRandom();

    private Bytes() {}

    public static byte[] random(int length) {
        byte[] data = new byte[length];
        RNG.nextBytes(data);
        return data;
    }

    public static byte[] concat(byte[] left, byte[] right) {
        byte[] out = new byte[left.length + right.length];
        System.arraycopy(left, 0, out, 0, left.length);
        System.arraycopy(right, 0, out, left.length, right.length);
        return out;
    }
}
