package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.testutil.LiveTestSupport;
import org.keychain.keymaster.testutil.TestFixtures;

@Tag("live")
class LiveResponseTest {
    @TempDir
    Path tempDir;

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    @Test
    void createResponseValidSimpleChallenge() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");
        keymaster.createId("Victor");

        keymaster.setCurrentId("Alice");

        String credentialDid = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> boundCredential = keymaster.bindCredential(credentialDid, bob);
        String vcDid = keymaster.issueCredential(boundCredential);

        keymaster.setCurrentId("Bob");
        boolean ok = keymaster.acceptCredential(vcDid);
        assertTrue(ok);

        WalletFile wallet = keymaster.loadWallet();
        assertTrue(wallet.ids.get("Alice").owned.contains(vcDid));
        assertTrue(wallet.ids.get("Bob").held.contains(vcDid));

        keymaster.setCurrentId("Victor");
        Map<String, Object> challenge = Map.of(
            "credentials",
            List.of(Map.of(
                "schema", credentialDid,
                "issuers", List.of(alice)
            ))
        );
        String challengeDid = keymaster.createChallenge(challenge);

        keymaster.setCurrentId("Bob");
        String responseDid = keymaster.createResponse(challengeDid);
        Object responseObj = keymaster.decryptJSON(responseDid);
        if (!(responseObj instanceof Map<?, ?>)) {
            throw new IllegalStateException("response did not decrypt");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> responseMap = (Map<String, Object>) responseObj;
        @SuppressWarnings("unchecked")
        Map<String, Object> response = (Map<String, Object>) responseMap.get("response");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> credentials =
            (List<Map<String, Object>>) response.get("credentials");

        assertEquals(challengeDid, response.get("challenge"));
        assertEquals(1, credentials.size());
        assertEquals(vcDid, credentials.get(0).get("vc"));
    }

    @Test
    void verifyResponseEmptyChallenge() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");

        keymaster.setCurrentId("Alice");
        String challengeDid = keymaster.createChallenge();

        keymaster.setCurrentId("Bob");
        String responseDid = keymaster.createResponse(challengeDid);

        keymaster.setCurrentId("Alice");
        Map<String, Object> verify = keymaster.verifyResponse(responseDid);

        assertEquals(challengeDid, verify.get("challenge"));
        assertEquals(0, verify.get("requested"));
        assertEquals(0, verify.get("fulfilled"));
        assertEquals(true, verify.get("match"));
        assertEquals(bob, verify.get("responder"));
        assertEquals(List.of(), verify.get("credentials"));
        assertEquals(List.of(), verify.get("vps"));
    }

    @Test
    void verifyResponseSingleCredentialMatch() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        String carol = keymaster.createId("Carol");
        keymaster.createId("Victor");

        keymaster.setCurrentId("Alice");
        String credential1 = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bc1 = keymaster.bindCredential(credential1, carol);
        String vc1 = keymaster.issueCredential(bc1);

        keymaster.setCurrentId("Carol");
        keymaster.acceptCredential(vc1);

        keymaster.setCurrentId("Victor");
        Map<String, Object> challenge = Map.of(
            "credentials",
            List.of(Map.of("schema", credential1))
        );
        String challengeDid = keymaster.createChallenge(challenge);

        keymaster.setCurrentId("Carol");
        String responseDid = keymaster.createResponse(challengeDid);

        keymaster.setCurrentId("Victor");
        Map<String, Object> verify = keymaster.verifyResponse(responseDid);

        assertEquals(true, verify.get("match"));
        assertEquals(challengeDid, verify.get("challenge"));
        assertEquals(1, verify.get("requested"));
        assertEquals(1, verify.get("fulfilled"));
        @SuppressWarnings("unchecked")
        List<Object> vps = (List<Object>) verify.get("vps");
        assertEquals(1, vps.size());
    }

    @Test
    void verifyResponseSingleCredentialNoMatch() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        keymaster.createId("Carol");
        keymaster.createId("Victor");

        keymaster.setCurrentId("Alice");
        String credential1 = keymaster.createSchema(TestFixtures.mockSchema());

        keymaster.setCurrentId("Victor");
        Map<String, Object> challenge = Map.of(
            "credentials",
            List.of(Map.of("schema", credential1))
        );
        String challengeDid = keymaster.createChallenge(challenge);

        keymaster.setCurrentId("Carol");
        String responseDid = keymaster.createResponse(challengeDid);

        keymaster.setCurrentId("Victor");
        Map<String, Object> verify = keymaster.verifyResponse(responseDid);

        assertEquals(false, verify.get("match"));
        assertEquals(challengeDid, verify.get("challenge"));
        assertEquals(1, verify.get("requested"));
        assertEquals(0, verify.get("fulfilled"));
        @SuppressWarnings("unchecked")
        List<Object> vps = (List<Object>) verify.get("vps");
        assertEquals(0, vps.size());
    }

    @Test
    void verifyResponseUpdatedCredential() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        String carol = keymaster.createId("Carol");
        keymaster.createId("Victor");

        keymaster.setCurrentId("Alice");
        String credential1 = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bc1 = keymaster.bindCredential(credential1, carol);
        String vc1 = keymaster.issueCredential(bc1);

        keymaster.setCurrentId("Carol");
        keymaster.acceptCredential(vc1);

        keymaster.setCurrentId("Alice");
        Map<String, Object> credential2 = keymaster.getCredential(vc1);
        @SuppressWarnings("unchecked")
        Map<String, Object> updated = (Map<String, Object>) credential2.get("credential");
        updated.put("email", "updated@email.com");
        credential2.put("credential", updated);
        keymaster.updateCredential(vc1, credential2);

        keymaster.setCurrentId("Victor");
        Map<String, Object> challenge = Map.of(
            "credentials",
            List.of(Map.of("schema", credential1))
        );
        String challengeDid = keymaster.createChallenge(challenge);

        keymaster.setCurrentId("Carol");
        String responseDid = keymaster.createResponse(challengeDid);

        keymaster.setCurrentId("Victor");
        Map<String, Object> verify = keymaster.verifyResponse(responseDid);

        assertEquals(true, verify.get("match"));
        assertEquals(challengeDid, verify.get("challenge"));
        assertEquals(1, verify.get("requested"));
        assertEquals(1, verify.get("fulfilled"));
        @SuppressWarnings("unchecked")
        List<Object> vps = (List<Object>) verify.get("vps");
        assertEquals(1, vps.size());
    }

    @Test
    void verifyResponseWorkflowWithRevocations() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");
        String carol = keymaster.createId("Carol");
        keymaster.createId("Victor");

        keymaster.setCurrentId("Alice");
        String schema1 = keymaster.createSchema(TestFixtures.mockSchema());
        String schema2 = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bc1 = keymaster.bindCredential(schema1, carol);
        Map<String, Object> bc2 = keymaster.bindCredential(schema2, carol);
        String vc1 = keymaster.issueCredential(bc1);
        String vc2 = keymaster.issueCredential(bc2);

        keymaster.setCurrentId("Bob");
        String schema3 = keymaster.createSchema(TestFixtures.mockSchema());
        String schema4 = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bc3 = keymaster.bindCredential(schema3, carol);
        Map<String, Object> bc4 = keymaster.bindCredential(schema4, carol);
        String vc3 = keymaster.issueCredential(bc3);
        String vc4 = keymaster.issueCredential(bc4);

        keymaster.setCurrentId("Carol");
        keymaster.acceptCredential(vc1);
        keymaster.acceptCredential(vc2);
        keymaster.acceptCredential(vc3);
        keymaster.acceptCredential(vc4);

        keymaster.setCurrentId("Victor");
        Map<String, Object> challenge = Map.of(
            "credentials",
            List.of(
                Map.of("schema", schema1, "issuers", List.of(alice)),
                Map.of("schema", schema2, "issuers", List.of(alice)),
                Map.of("schema", schema3, "issuers", List.of(bob)),
                Map.of("schema", schema4, "issuers", List.of(bob))
            )
        );
        String challengeDid = keymaster.createChallenge(challenge);

        keymaster.setCurrentId("Carol");
        String responseDid = keymaster.createResponse(challengeDid);
        Object responseObj = keymaster.decryptJSON(responseDid);
        @SuppressWarnings("unchecked")
        Map<String, Object> responseMap = (Map<String, Object>) responseObj;
        @SuppressWarnings("unchecked")
        Map<String, Object> response = (Map<String, Object>) responseMap.get("response");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> credentials =
            (List<Map<String, Object>>) response.get("credentials");
        assertEquals(challengeDid, response.get("challenge"));
        assertEquals(4, credentials.size());

        keymaster.setCurrentId("Victor");
        Map<String, Object> verify1 = keymaster.verifyResponse(responseDid);
        assertEquals(true, verify1.get("match"));
        @SuppressWarnings("unchecked")
        List<Object> vps1 = (List<Object>) verify1.get("vps");
        assertEquals(4, vps1.size());

        keymaster.setCurrentId("Alice");
        keymaster.rotateKeys();
        keymaster.setCurrentId("Bob");
        keymaster.rotateKeys();
        keymaster.setCurrentId("Carol");
        keymaster.rotateKeys();
        keymaster.setCurrentId("Victor");
        keymaster.rotateKeys();

        Map<String, Object> verify2 = keymaster.verifyResponse(responseDid);
        assertEquals(true, verify2.get("match"));
        @SuppressWarnings("unchecked")
        List<Object> vps2 = (List<Object>) verify2.get("vps");
        assertEquals(4, vps2.size());

        keymaster.setCurrentId("Alice");
        keymaster.revokeCredential(vc1);

        keymaster.setCurrentId("Victor");
        Map<String, Object> verify3 = keymaster.verifyResponse(responseDid);
        assertEquals(false, verify3.get("match"));
        @SuppressWarnings("unchecked")
        List<Object> vps3 = (List<Object>) verify3.get("vps");
        assertEquals(3, vps3.size());

        keymaster.setCurrentId("Bob");
        keymaster.revokeCredential(vc3);

        keymaster.setCurrentId("Victor");
        Map<String, Object> verify4 = keymaster.verifyResponse(responseDid);
        assertEquals(false, verify4.get("match"));
        @SuppressWarnings("unchecked")
        List<Object> vps4 = (List<Object>) verify4.get("vps");
        assertEquals(2, vps4.size());
    }

    @Test
    void createResponseInvalidChallengeDid() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.createResponse(alice)
        );
        assertEquals("Invalid parameter: challengeDID", error.getMessage());
    }

    @Test
    void verifyResponseInvalidDidNotEncrypted() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");

        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.verifyResponse(alice)
        );
        assertEquals("Invalid parameter: did not encrypted", error.getMessage());
    }
}
