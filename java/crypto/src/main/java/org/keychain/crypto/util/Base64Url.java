package org.keychain.crypto.util;

import java.util.Base64;

public final class Base64Url {
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private Base64Url() {}

    public static String encode(byte[] data) {
        return ENCODER.encodeToString(data);
    }

    public static byte[] decode(String data) {
        int end = data.length();
        while (end > 0 && data.charAt(end - 1) == '=') end--;
        String unpadded = data.substring(0, end);
        byte[] bytes = DECODER.decode(unpadded);
        if (!encode(bytes).equals(unpadded)) throw new IllegalArgumentException("Invalid base64url encoding");
        return bytes;
    }
}
