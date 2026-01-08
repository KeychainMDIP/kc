package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.JwkPrivate;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.model.EcdsaJwkPublic;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;

class OperationFactoryTest {
    @Test
    void createsSignedCreateIdOperation() throws Exception {
        ObjectMapper mapper = mapper();
        JsonNode root = loadVectors(mapper);
        JsonNode createNode = root.get("createId");

        JwkPrivate privateJwk = parsePrivateJwk(createNode.get("privateJwk"));
        EcdsaJwkPublic publicJwk = JwkConverter.toEcdsaJwkPublic(privateJwk);
        JsonNode expectedPublic = createNode.get("publicJwk");
        assertEquals(expectedPublic, mapper.valueToTree(publicJwk));

        String registry = createNode.get("registry").asText();
        String blockid = createNode.get("blockid").asText();
        Instant created = Instant.parse(createNode.get("created").asText());
        Instant signed = Instant.parse(createNode.get("signed").asText());

        OperationBuilder builder = new OperationBuilder(Clock.fixed(created, ZoneOffset.UTC));
        OperationSignerImpl signer = new OperationSignerImpl(new KeymasterCryptoImpl(), Clock.fixed(signed, ZoneOffset.UTC));
        OperationFactory factory = new OperationFactory(builder, signer);

        Operation actual = factory.createSignedCreateIdOperation(registry, publicJwk, privateJwk, blockid);
        JsonNode expected = createNode.get("signedOperation");
        assertEquals(expected, mapper.valueToTree(actual));
    }

    @Test
    void createsSignedUpdateDidOperation() throws Exception {
        ObjectMapper mapper = mapper();
        JsonNode root = loadVectors(mapper);
        JsonNode updateNode = root.get("updateDID");

        String did = updateNode.get("did").asText();
        String previd = updateNode.get("previd").asText();
        String blockid = updateNode.get("blockid").asText();
        String signerDid = updateNode.get("signerDid").asText();
        Instant signed = Instant.parse(updateNode.get("signed").asText());

        MdipDocument doc = mapper.treeToValue(updateNode.get("doc"), MdipDocument.class);
        JwkPrivate privateJwk = parsePrivateJwk(updateNode.get("privateJwk"));

        OperationSignerImpl signer = new OperationSignerImpl(new KeymasterCryptoImpl(), Clock.fixed(signed, ZoneOffset.UTC));
        OperationFactory factory = new OperationFactory(new OperationBuilder(), signer);

        Operation actual = factory.createSignedUpdateDidOperation(did, previd, blockid, doc, privateJwk, signerDid);
        JsonNode expected = updateNode.get("signedOperation");
        assertEquals(expected, mapper.valueToTree(actual));
    }

    private static JsonNode loadVectors(ObjectMapper mapper) throws Exception {
        try (InputStream input = OperationFactoryTest.class.getResourceAsStream("/vectors/operations-v1.json")) {
            assertNotNull(input, "operations-v1.json should be present in test resources");
            return mapper.readTree(input);
        }
    }

    private static ObjectMapper mapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        return mapper;
    }

    private static JwkPrivate parsePrivateJwk(JsonNode node) {
        String kty = node.get("kty").asText();
        String crv = node.get("crv").asText();
        String x = node.get("x").asText();
        String y = node.get("y").asText();
        String d = node.get("d").asText();
        return new JwkPrivate(kty, crv, x, y, d);
    }
}
