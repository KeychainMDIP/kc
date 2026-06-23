package org.keychain.cid;

import java.util.Arrays;

public final class Base58Btc {
    private static final String ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    private static final int[] INDEXES = new int[128];

    static {
        Arrays.fill(INDEXES, -1);
        for (int i = 0; i < ALPHABET.length(); i += 1) {
            INDEXES[ALPHABET.charAt(i)] = i;
        }
    }

    private Base58Btc() {
    }

    public static byte[] decode(String input) {
        if (input == null || input.isEmpty()) {
            throw new IllegalArgumentException("input");
        }

        int zeros = 0;
        while (zeros < input.length() && input.charAt(zeros) == '1') {
            zeros += 1;
        }

        byte[] input58 = new byte[input.length()];
        for (int i = 0; i < input.length(); i += 1) {
            char c = input.charAt(i);
            if (c >= 128 || INDEXES[c] < 0) {
                throw new IllegalArgumentException("input");
            }
            input58[i] = (byte) INDEXES[c];
        }

        byte[] decoded = new byte[input.length()];
        int outputStart = decoded.length;
        int inputStart = zeros;
        while (inputStart < input58.length) {
            int mod = divmod256(input58, inputStart);
            if (input58[inputStart] == 0) {
                inputStart += 1;
            }
            decoded[--outputStart] = (byte) mod;
        }

        while (outputStart < decoded.length && decoded[outputStart] == 0) {
            outputStart += 1;
        }

        byte[] output = new byte[zeros + (decoded.length - outputStart)];
        System.arraycopy(decoded, outputStart, output, zeros, decoded.length - outputStart);
        return output;
    }

    private static int divmod256(byte[] number, int startAt) {
        int remainder = 0;
        for (int i = startAt; i < number.length; i += 1) {
            int digit = number[i] & 0xFF;
            int temp = remainder * 58 + digit;
            number[i] = (byte) (temp / 256);
            remainder = temp % 256;
        }
        return remainder;
    }
}
