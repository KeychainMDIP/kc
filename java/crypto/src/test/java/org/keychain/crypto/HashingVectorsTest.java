package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.api.Test;

class HashingVectorsTest {
    @Test
    void canonicalHashMatchesVector() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode vectors;
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            vectors = root.get("vectors");
        }

        JsonNode hashNode = vectors.get("hash");
        JsonNode inputNode = hashNode.get("input");
        String expectedHex = hashNode.get("hashHex").asText();

        Object input = mapper.treeToValue(inputNode, Object.class);
        String actualHex = Hashing.hashCanonicalJson(input);

        assertEquals(expectedHex, actualHex);
    }
}
