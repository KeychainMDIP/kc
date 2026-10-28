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
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.Signature;
import org.keychain.keymaster.testutil.TestFixtures;

class OperationVectorsTest {
    @Test
    void signedCreateOperationMatchesReferenceVector() throws Exception {
        JsonNode vector = TestFixtures.readVector("operations-v1.json").get("createId");
        KeymasterCrypto crypto = new KeymasterCryptoImpl();
        Clock created = Clock.fixed(Instant.parse(vector.get("created").asText()), ZoneOffset.UTC);
        Clock signed = Clock.fixed(Instant.parse(vector.get("signed").asText()), ZoneOffset.UTC);
        OperationFactory factory = new OperationFactory(
            new OperationBuilder(created), new OperationSignerImpl(crypto, signed)
        );
        JsonNode key = vector.get("privateJwk");
        JwkPrivate privateJwk = new JwkPrivate(
            key.get("kty").asText(), key.get("crv").asText(),
            key.get("x").asText(), key.get("y").asText(), key.get("d").asText()
        );

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
}
