package org.keychain.cid;

public final class Multibase {
    private Multibase() {
    }

    public static byte[] decode(String value) {
        if (value == null || value.length() < 2) {
            throw new IllegalArgumentException("value");
        }

        char prefix = value.charAt(0);
        String payload = value.substring(1);

        if (prefix == 'z') {
            return Base58Btc.decode(payload);
        }
        if (prefix == 'b') {
            return Base32Lower.decode(payload);
        }

        throw new IllegalArgumentException("value");
    }
}
