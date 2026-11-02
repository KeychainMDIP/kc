package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Base64;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.util.Base64Url;

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
    @Test
    void saltsDoNotChangeJwkCiphertextOrMnemonicEncodings() {
        KeymasterCrypto crypto = new KeymasterCryptoImpl();
        JwkPair key = crypto.generateRandomJwk();
        assertEquals(32, Base64Url.decode(key.privateJwk.d).length);
        assertEquals(32, Base64Url.decode(key.publicJwk.x).length);
        assertEquals(32, Base64Url.decode(key.publicJwk.y).length);
        String ciphertext = crypto.encryptBytes(key.publicJwk, key.privateJwk, new byte[] {1, 2, 3});
        assertEquals(24 + 3 + 16, Base64Url.decode(ciphertext).length);
        EncryptedMnemonic mnemonic = MnemonicEncryption.encrypt("test", "passphrase", new byte[16], new byte[12]);
        assertEquals(16, Base64.getDecoder().decode(mnemonic.salt).length);
        assertTrue(mnemonic.salt.endsWith("=="));
        assertEquals(12, Base64.getDecoder().decode(mnemonic.iv).length);
        assertEquals(4 + 16, Base64.getDecoder().decode(mnemonic.data).length);
    }

}
