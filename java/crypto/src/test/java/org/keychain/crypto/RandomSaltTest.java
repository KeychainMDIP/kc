package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Base64;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class RandomSaltTest {
    @Test
    void saltsUseTheReferenceMultibaseEncodingAndFresh32ByteEntropy() {
        KeymasterCrypto crypto = new KeymasterCryptoImpl();
        Set<String> salts = new HashSet<>();
        for (int i = 0; i < 32; i++) {
            String salt = crypto.generateRandomSalt();
            assertTrue(salt.matches("u[A-Za-z0-9_-]{43}"));
            assertEquals(32, Base64.getUrlDecoder().decode(salt.substring(1)).length);
            assertTrue(salts.add(salt));
        }
    }
}
