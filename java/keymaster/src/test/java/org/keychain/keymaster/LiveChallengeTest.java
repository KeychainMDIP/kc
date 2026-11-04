package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.testutil.LiveTestSupport;
import org.keychain.keymaster.testutil.TestFixtures;

@Tag("live")
@ExtendWith(LiveTestSupport.class)
class LiveChallengeTest {
    @TempDir
    Path tempDir;

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    @Test
    void createChallengeEmptyDefaults() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String did = keymaster.createChallenge(Map.of(), LiveTestSupport.localAssets());
        MdipDocument doc = keymaster.resolveDID(did);

        assertEquals(did, doc.didDocument.id);
        assertEquals(alice, doc.didDocument.controller);
        assertEquals(Map.of("challenge", Map.of()), doc.didDocumentData);

        long now = System.currentTimeMillis();
        long validUntil = java.time.Instant.parse(doc.mdip.validUntil).toEpochMilli();
        long ttl = validUntil - now;
        assertTrue(ttl < 60 * 60 * 1000);
    }

    @Test
    void createChallengeEmptyWithExpiry() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String validUntil = java.time.Instant.now().plusSeconds(3600).toString();

        CreateAssetOptions options = LiveTestSupport.localAssets();
        options.validUntil = validUntil;
        String did = keymaster.createChallenge(Map.of(), options);
        MdipDocument doc = keymaster.resolveDID(did);

        assertEquals(did, doc.didDocument.id);
        assertEquals(alice, doc.didDocument.controller);
        assertEquals(Map.of("challenge", Map.of()), doc.didDocumentData);
        assertEquals(validUntil, doc.mdip.validUntil);
    }

    @Test
    void createChallengeWithCredentials() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");

        keymaster.setCurrentId("Alice");
        String credentialDid = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> challenge = Map.of(
            "credentials",
            List.of(Map.of(
                "schema", credentialDid,
                "issuers", List.of(alice, bob)
            ))
        );

        String did = keymaster.createChallenge(challenge, LiveTestSupport.localAssets());
        MdipDocument doc = keymaster.resolveDID(did);

        assertEquals(did, doc.didDocument.id);
        assertEquals(alice, doc.didDocument.controller);
        assertEquals(Map.of("challenge", challenge), doc.didDocumentData);
    }

    @Test
    void createChallengeInvalidValidUntil() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        CreateAssetOptions options = LiveTestSupport.localAssets();
        options.validUntil = "mockDate";
        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.createChallenge(Map.of(), options)
        );
        assertEquals("options.validUntil", error.getMessage());
    }
}
