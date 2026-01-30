package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.util.Hex;

class EcdhVectorsTest {
    @Test
    void sharedSecretMatchesVector() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode vectors;
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            vectors = root.get("vectors");
        }

        JsonNode encryptNode = vectors.get("encrypt");
        JwkPrivate senderPrivate = toPrivate(encryptNode.get("sender").get("privateJwk"));
        JwkPublic receiverPublic = toPublic(encryptNode.get("receiver").get("publicJwk"));

        byte[] shared = Secp256k1Ecdh.sharedSecretCompressed(receiverPublic, senderPrivate);
        String sharedHex = Hex.encode(shared);

        JsonNode ecdhNode = vectors.get("ecdh");
        String expectedSharedHex = ecdhNode.get("sharedSecretCompressedHex").asText();
        assertEquals(expectedSharedHex, sharedHex);
    }

    private static JwkPublic toPublic(JsonNode node) {
        return new JwkPublic(
            node.get("kty").asText(),
            node.get("crv").asText(),
            node.get("x").asText(),
            node.get("y").asText()
        );
    }

    private static JwkPrivate toPrivate(JsonNode node) {
        return new JwkPrivate(
            node.get("kty").asText(),
            node.get("crv").asText(),
            node.get("x").asText(),
            node.get("y").asText(),
            node.get("d").asText()
        );
    }
}
