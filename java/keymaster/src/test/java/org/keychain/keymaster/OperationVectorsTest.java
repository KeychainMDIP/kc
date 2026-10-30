package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.CanonicalJson;
import org.keychain.crypto.JwkPrivate;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.model.EcdsaJwkPublic;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.Signature;
import org.keychain.keymaster.testutil.TestFixtures;

class OperationVectorsTest {
    @Test
    void signedUpdateMatchesReferenceAndKeepsTheInputUnchanged() throws Exception {
        JsonNode vector = TestFixtures.readVector("operations-v1.json").get("updateDID");
        ObjectMapper mapper = new ObjectMapper();
        KeymasterCrypto crypto = new KeymasterCryptoImpl();
        Clock signed = Clock.fixed(Instant.parse(vector.get("signed").asText()), ZoneOffset.UTC);
        OperationFactory factory = new OperationFactory(new OperationBuilder(signed), new OperationSignerImpl(crypto, signed));
        MdipDocument doc = mapper.treeToValue(vector.get("doc"), MdipDocument.class);
        JsonNode before = mapper.valueToTree(doc);
        JwkPrivate key = privateKey(vector.get("privateJwk"));

        Operation operation = factory.createSignedUpdateDidOperation(
            vector.get("did").asText(), vector.get("previd").asText(), vector.get("blockid").asText(),
            doc, key, vector.get("signerDid").asText()
        );

        assertEquals(CanonicalJson.canonicalize(vector.get("signedOperation")), CanonicalJson.canonicalize(operation));
        assertEquals(before, mapper.valueToTree(doc));
        Signature signature = operation.signature;
        assertTrue(crypto.verifySig(signature.hash, signature.value, key));
        operation.signature = null;
        assertEquals(signature.hash, crypto.hashJson(operation));
    }

    @Test
    void signedCreateOperationMatchesReferenceVector() throws Exception {
        JsonNode vector = TestFixtures.readVector("operations-v1.json").get("createId");
        KeymasterCrypto crypto = new KeymasterCryptoImpl();
        Clock created = Clock.fixed(Instant.parse(vector.get("created").asText()), ZoneOffset.UTC);
        Clock signed = Clock.fixed(Instant.parse(vector.get("signed").asText()), ZoneOffset.UTC);
        OperationFactory factory = new OperationFactory(
            new OperationBuilder(created), new OperationSignerImpl(crypto, signed)
        );
        JwkPrivate privateJwk = privateKey(vector.get("privateJwk"));

        Operation operation = factory.createSignedCreateIdOperation(
            vector.get("registry").asText(),
            new ObjectMapper().treeToValue(vector.get("publicJwk"), EcdsaJwkPublic.class),
            privateJwk,
            vector.get("blockid").asText()
        );

        assertEquals(
            CanonicalJson.canonicalize(vector.get("signedOperation")),
            CanonicalJson.canonicalize(operation)
        );
        Signature signature = operation.signature;
        assertTrue(crypto.verifySig(signature.hash, signature.value, privateJwk));
        operation.signature = null;
        assertEquals(signature.hash, crypto.hashJson(operation));
    }

    private static JwkPrivate privateKey(JsonNode key) {
        return new JwkPrivate(
            key.get("kty").asText(), key.get("crv").asText(),
            key.get("x").asText(), key.get("y").asText(), key.get("d").asText()
        );
    }
}
