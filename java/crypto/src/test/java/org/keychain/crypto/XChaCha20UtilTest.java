package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.keychain.crypto.util.Hex;

class XChaCha20UtilTest {
    @Test
    void encryptDecryptRoundTrip() {
        byte[] key32 = Hex.decode("021510bc0b4faf0c8aba1a69c27c06bb6253d546a4e40176d4c948068116b66b");
        String plaintext = "hello keymaster";

        String cipher = XChaCha20Util.encryptString(key32, plaintext);
        String roundTrip = XChaCha20Util.decryptToString(key32, cipher);

        assertEquals(plaintext, roundTrip);
        assertTrue(cipher.length() > plaintext.length());
    }
}
