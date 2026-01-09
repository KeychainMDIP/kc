package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.api.Test;

class CryptoVectorsTest {
    @Test
    void vectorsMustBePopulated() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            JsonNode vectors = root.get("vectors");
            assertNotNull(vectors, "vectors object is required");

            boolean populated = true;
            populated &= !vectors.get("mnemonic").isNull();
            populated &= !vectors.get("hdKey").isNull();
            populated &= !vectors.get("jwk").isNull();
            populated &= !vectors.get("hash").isNull();
            populated &= !vectors.get("signature").isNull();
            populated &= !vectors.get("encrypt").isNull();
            populated &= !vectors.get("mnemonicEnc").isNull();
            populated &= !vectors.get("ecdh").isNull();

            assertTrue(populated, "Populate crypto-v1.json with JS reference vectors before enabling tests");
        }
    }
}
