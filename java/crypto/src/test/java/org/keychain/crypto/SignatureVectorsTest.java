package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.api.Test;

class SignatureVectorsTest {
    @Test
    void signaturesMatchVector() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode vectors;
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            vectors = root.get("vectors");
        }

        JsonNode signatureNode = vectors.get("signature");
        String hashHex = signatureNode.get("hashHex").asText();
        String expectedSignature = signatureNode.get("signatureHex").asText();

        JsonNode jwkNode = vectors.get("jwk");
        JwkPrivate privateJwk = toPrivate(jwkNode.get("privateJwk"));
        JwkPublic publicJwk = toPublic(signatureNode.get("signerPublicJwk"));

        String actualSignature = Secp256k1Sign.signHash(hashHex, privateJwk);
        assertEquals(expectedSignature, actualSignature);

        assertTrue(Secp256k1Sign.verifySig(hashHex, expectedSignature, publicJwk));
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
