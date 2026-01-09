package org.keychain.cid;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

public final class Base32Lower {
    private static final String ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
    private static final int[] INDEXES = new int[128];

    static {
        Arrays.fill(INDEXES, -1);
        for (int i = 0; i < ALPHABET.length(); i += 1) {
            char c = ALPHABET.charAt(i);
            INDEXES[c] = i;
            INDEXES[Character.toUpperCase(c)] = i;
        }
    }

    private Base32Lower() {
    }

    public static byte[] decode(String input) {
        if (input == null || input.isEmpty()) {
            throw new IllegalArgumentException("input");
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int buffer = 0;
        int bitsLeft = 0;

        for (int i = 0; i < input.length(); i += 1) {
            char c = input.charAt(i);
            if (c == '=') {
                continue;
            }
            if (c >= 128 || INDEXES[c] < 0) {
                throw new IllegalArgumentException("input");
            }

            buffer = (buffer << 5) | INDEXES[c];
            bitsLeft += 5;

            while (bitsLeft >= 8) {
                bitsLeft -= 8;
                out.write((buffer >> bitsLeft) & 0xFF);
                if (bitsLeft > 0) {
                    buffer &= (1 << bitsLeft) - 1;
                } else {
                    buffer = 0;
                }
            }
        }

        return out.toByteArray();
    }
}
