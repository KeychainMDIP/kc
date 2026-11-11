package org.keychain.crypto.util;

import java.security.SecureRandom;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

public final class Bytes {
    private static final SecureRandom RNG = new SecureRandom();

    private Bytes() {}

    // TextEncoder replaces malformed UTF-16 with U+FFFD, while Java's default encoder uses '?'.
    public static byte[] utf8(String text) {
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .replaceWith(new byte[] {(byte) 0xef, (byte) 0xbf, (byte) 0xbd})
                .encode(CharBuffer.wrap(text));
            byte[] bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
            return bytes;
        } catch (CharacterCodingException e) {
            throw new IllegalArgumentException("Unable to encode UTF-8", e);
        }
    }

    public static String fromUtf8(byte[] bytes) {
        byte[] normalized = bytes;
        for (int i = 0; i + 1 < bytes.length; i++) {
            // TextDecoder replaces each byte of a UTF-8 surrogate encoding separately.
            if ((bytes[i] & 0xff) == 0xed && (bytes[i + 1] & 0xe0) == 0xa0) {
                if (normalized == bytes) normalized = bytes.clone();
                normalized[i] = (byte) 0xff;
            }
        }
        String text = new String(normalized, StandardCharsets.UTF_8);
        return !text.isEmpty() && text.charAt(0) == '\ufeff' ? text.substring(1) : text;
    }

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
