package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.api.Test;

class MnemonicEncryptionTest {
    @Test
    void roundTripEncryptDecrypt() {
        String mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        String passphrase = "passphrase";

        EncryptedMnemonic enc = MnemonicEncryption.encrypt(mnemonic, passphrase);
        String dec = MnemonicEncryption.decrypt(enc, passphrase);

        assertEquals(mnemonic, dec);
    }

    @Test
    void matchesVector() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode vectors;
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            vectors = root.get("vectors");
        }

        JsonNode node = vectors.get("mnemonicEnc");
        String mnemonic = node.get("mnemonic").asText();
        String passphrase = node.get("passphrase").asText();

        EncryptedMnemonic enc = new EncryptedMnemonic(
            node.get("salt").asText(),
            node.get("iv").asText(),
            node.get("data").asText()
        );

        String decrypted = MnemonicEncryption.decrypt(enc, passphrase);
        assertEquals(mnemonic, decrypted);
    }
}
