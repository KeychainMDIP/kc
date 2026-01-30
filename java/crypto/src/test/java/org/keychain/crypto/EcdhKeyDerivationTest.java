package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.util.Hex;

class EcdhKeyDerivationTest {
    @Test
    void derivedKeyMatchesVector() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode vectors;
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            vectors = root.get("vectors");
        }

        JsonNode ecdhNode = vectors.get("ecdh");
        String sharedHex = ecdhNode.get("sharedSecretCompressedHex").asText();
        String expectedKeyHex = ecdhNode.get("key32Hex").asText();

        byte[] shared = Hex.decode(sharedHex);
        byte[] key = Secp256k1Ecdh.deriveKey32(shared);

        assertEquals(expectedKeyHex, Hex.encode(key));
    }
}
