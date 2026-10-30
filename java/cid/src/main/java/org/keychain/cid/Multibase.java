package org.keychain.cid;

import java.math.BigInteger;

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

        if (prefix == 'k' && payload.matches("[0-9a-z]+")) {
            int zeros = 0;
            while (zeros < payload.length() && payload.charAt(zeros) == '0') zeros++;
            byte[] number = new BigInteger(payload, 36).toByteArray();
            int offset = number[0] == 0 ? 1 : 0;
            byte[] decoded = new byte[zeros + number.length - offset];
            System.arraycopy(number, offset, decoded, zeros, number.length - offset);
            return decoded;
        }
        throw new IllegalArgumentException("value");
    }
}
