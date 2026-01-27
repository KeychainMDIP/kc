package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.api.Test;

class EncryptionVectorsTest {
    @Test
    void decryptsJsCiphertext() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode vectors;
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            vectors = root.get("vectors");
        }

        JsonNode encryptNode = vectors.get("encrypt");
        String ciphertext = encryptNode.get("ciphertext").asText();
        String plaintext = encryptNode.get("plaintext").asText();

        JwkPrivate senderPrivate = toPrivate(encryptNode.get("sender").get("privateJwk"));
        JwkPublic receiverPublic = toPublic(encryptNode.get("receiver").get("publicJwk"));

        byte[] shared = Secp256k1Ecdh.sharedSecretCompressed(receiverPublic, senderPrivate);
        byte[] key32 = Secp256k1Ecdh.deriveKey32(shared);

        String decrypted = XChaCha20Util.decryptToString(key32, ciphertext);
        assertEquals(plaintext, decrypted);
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
