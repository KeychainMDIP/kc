package org.keychain.keymaster;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.GatekeeperHttpClient;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.junit.jupiter.api.Test;
import org.keychain.keymaster.testutil.TestFixtures;

@Tag("live")
class LiveCredentialTest {
    private static final String REGISTRY = "local";
    private static final String DEFAULT_GATEKEEPER_URL = "http://localhost:4224";
    private static final String ENV_GATEKEEPER_URL = "KC_GATEKEEPER_URL";

    protected GatekeeperClient gatekeeperClient() {
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        String override = System.getenv(ENV_GATEKEEPER_URL);
        if (override != null && !override.isBlank()) {
            options.baseUrl = override;
        } else {
            options.baseUrl = DEFAULT_GATEKEEPER_URL;
        }
        return new GatekeeperHttpClient(options);
    }

    protected Keymaster liveKeymaster() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        return new Keymaster(store, gatekeeperClient(), "passphrase");
    }

    protected String registry() {
        return REGISTRY;
    }

    @Test
    @Tag("live")
    void createSchemaAndTemplate() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Alice");

        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        java.util.Map<String, Object> template = keymaster.createTemplate(schemaDid);

        org.junit.jupiter.api.Assertions.assertNotNull(schemaDid);
        org.junit.jupiter.api.Assertions.assertNotNull(template);
        org.junit.jupiter.api.Assertions.assertEquals(schemaDid, template.get("$schema"));
    }

    @Test
    @Tag("live")
    void bindAndIssueCredential() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());

        java.util.Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid);
        String credentialDid = keymaster.issueCredential(bound);

        java.util.Map<String, Object> vc = keymaster.getCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertNotNull(vc);
        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, vc.get("issuer"));
        Object subjectObj = vc.get("credentialSubject");
        org.junit.jupiter.api.Assertions.assertTrue(subjectObj instanceof java.util.Map<?, ?>);
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, subject.get("id"));
    }

    @Test
    @Tag("live")
    void bindCredentialWithDefaults() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> custom = new java.util.LinkedHashMap<>();
        custom.put("email", "alice@example.com");

        Map<String, Object> vc = keymaster.bindCredential(schemaDid, subjectDid, null, null, custom);

        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, vc.get("issuer"));
        Object subjectObj = vc.get("credentialSubject");
        org.junit.jupiter.api.Assertions.assertTrue(subjectObj instanceof Map<?, ?>);
        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) subjectObj;
        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, subject.get("id"));
        Object credObj = vc.get("credential");
        org.junit.jupiter.api.Assertions.assertTrue(credObj instanceof Map<?, ?>);
        @SuppressWarnings("unchecked")
        Map<String, Object> cred = (Map<String, Object>) credObj;
        org.junit.jupiter.api.Assertions.assertEquals("alice@example.com", cred.get("email"));
    }

    @Test
    @Tag("live")
    void bindCredentialForDifferentUser() {
        Keymaster keymaster = liveKeymaster();
        String issuerDid = keymaster.createId("Alice");
        String subjectDid = keymaster.createId("Bob");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());

        keymaster.setCurrentId("Alice");
        Map<String, Object> vc = keymaster.bindCredential(schemaDid, subjectDid);

        org.junit.jupiter.api.Assertions.assertEquals(issuerDid, vc.get("issuer"));
        Object subjectObj = vc.get("credentialSubject");
        org.junit.jupiter.api.Assertions.assertTrue(subjectObj instanceof Map<?, ?>);
        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) subjectObj;
        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, subject.get("id"));
    }

    @Test
    @Tag("live")
    void publishCredentialReveal() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        java.util.Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid);
        String credentialDid = keymaster.issueCredential(bound);

        keymaster.publishCredential(credentialDid, true);

        MdipDocument doc = keymaster.resolveDID(subjectDid);
        Map<String, Object> manifest = manifestFromDoc(doc);
        Object entryObj = manifest.get(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(entryObj instanceof Map<?, ?>);
        @SuppressWarnings("unchecked")
        Map<String, Object> entry = (Map<String, Object>) entryObj;
        org.junit.jupiter.api.Assertions.assertNotNull(entry.get("credential"));
    }

    @Test
    @Tag("live")
    void publishCredentialNoReveal() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        java.util.Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid);
        String credentialDid = keymaster.issueCredential(bound);

        keymaster.publishCredential(credentialDid, false);

        MdipDocument doc = keymaster.resolveDID(subjectDid);
        Map<String, Object> manifest = manifestFromDoc(doc);
        Object entryObj = manifest.get(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(entryObj instanceof Map<?, ?>);
        @SuppressWarnings("unchecked")
        Map<String, Object> entry = (Map<String, Object>) entryObj;
        org.junit.jupiter.api.Assertions.assertTrue(entry.containsKey("credential"));
        org.junit.jupiter.api.Assertions.assertNull(entry.get("credential"));
    }

    @Test
    @Tag("live")
    void unpublishCredential() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        java.util.Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid);
        String credentialDid = keymaster.issueCredential(bound);
        keymaster.publishCredential(credentialDid, true);

        keymaster.unpublishCredential(credentialDid);

        MdipDocument doc = keymaster.resolveDID(subjectDid);
        Map<String, Object> manifest = manifestFromDoc(doc);
        org.junit.jupiter.api.Assertions.assertTrue(manifest.isEmpty());
    }

    @Test
    @Tag("live")
    void getCredential() {
        Keymaster keymaster = liveKeymaster();
        String credentialDid = issueCredential(keymaster, "Alice", "Alice");

        Map<String, Object> credential = keymaster.getCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertNotNull(credential);
        Object typesObj = credential.get("type");
        org.junit.jupiter.api.Assertions.assertTrue(typesObj instanceof List<?>);
        @SuppressWarnings("unchecked")
        List<Object> types = (List<Object>) typesObj;
        org.junit.jupiter.api.Assertions.assertTrue(types.contains("VerifiableCredential"));
    }

    @Test
    @Tag("live")
    void listIssued() {
        Keymaster keymaster = liveKeymaster();
        String credentialDid = issueCredential(keymaster, "Alice", "Alice");

        List<String> issued = keymaster.listIssued("Alice");
        org.junit.jupiter.api.Assertions.assertTrue(issued.contains(credentialDid));
    }

    @Test
    @Tag("live")
    void listIssuedEmpty() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Bob");

        List<String> issued = keymaster.listIssued("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(issued.isEmpty());
    }

    @Test
    @Tag("live")
    void listCredentialsEmpty() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Bob");

        List<String> held = keymaster.listCredentials("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(held.isEmpty());
    }

    @Test
    @Tag("live")
    void listCredentialsHeld() {
        Keymaster keymaster = liveKeymaster();
        String credentialDid = issueCredential(keymaster, "Alice", "Bob");

        keymaster.setCurrentId("Bob");
        boolean accepted = keymaster.acceptCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(accepted);

        List<String> held = keymaster.listCredentials("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(held.contains(credentialDid));
    }

    @Test
    @Tag("live")
    void acceptAndRemoveCredential() {
        Keymaster keymaster = liveKeymaster();
        String credentialDid = issueCredential(keymaster, "Alice", "Bob");

        keymaster.setCurrentId("Bob");
        boolean accepted = keymaster.acceptCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(accepted);

        List<String> held = keymaster.listCredentials("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(held.contains(credentialDid));

        WalletFile wallet = keymaster.loadWallet();
        IDInfo owner = wallet.ids.get("Alice");
        IDInfo holder = wallet.ids.get("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(owner.owned.contains(credentialDid));
        org.junit.jupiter.api.Assertions.assertTrue(holder.held.contains(credentialDid));

        boolean removed = keymaster.removeCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(removed);
        List<String> after = keymaster.listCredentials("Bob");
        org.junit.jupiter.api.Assertions.assertFalse(after.contains(credentialDid));
    }

    @Test
    @Tag("live")
    void acceptCredentialCannotDecrypt() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Alice");
        keymaster.createId("Bob");
        keymaster.createId("Carol");

        keymaster.setCurrentId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, keymaster.fetchIdInfo("Bob").did);
        String credentialDid = keymaster.issueCredential(bound);

        keymaster.setCurrentId("Carol");
        boolean ok = keymaster.acceptCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertFalse(ok);
    }

    @Test
    @Tag("live")
    void acceptCredentialWrongSubject() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Alice");
        keymaster.createId("Bob");
        keymaster.createId("Carol");

        keymaster.setCurrentId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, keymaster.fetchIdInfo("Bob").did);
        String credentialDid = keymaster.issueCredential(bound);
        Map<String, Object> vc = keymaster.getCredential(credentialDid);
        String wrappedForCarol = keymaster.encryptJSON(vc, "Carol");

        keymaster.setCurrentId("Carol");
        boolean ok = keymaster.acceptCredential(wrappedForCarol);
        org.junit.jupiter.api.Assertions.assertFalse(ok);
    }

    @Test
    @Tag("live")
    void acceptCredentialInvalidDid() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Alice");
        keymaster.createId("Bob");

        keymaster.setCurrentId("Bob");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());

        boolean ok = keymaster.acceptCredential(schemaDid);
        org.junit.jupiter.api.Assertions.assertFalse(ok);
    }

    @Test
    @Tag("live")
    void removeCredentialReturnsFalseWhenNotHeld() {
        Keymaster keymaster = liveKeymaster();
        String agentDid = keymaster.createId("Alice");

        boolean ok = keymaster.removeCredential(agentDid);
        org.junit.jupiter.api.Assertions.assertFalse(ok);
    }

    @Test
    @Tag("live")
    void getCredentialReturnsNullForNonCredential() {
        Keymaster keymaster = liveKeymaster();
        String bobDid = keymaster.createId("Bob");
        String did = keymaster.encryptJSON(TestFixtures.mockJson(), bobDid);

        Map<String, Object> credential = keymaster.getCredential(did);
        org.junit.jupiter.api.Assertions.assertNull(credential);
    }

    @Test
    @Tag("live")
    void issueCredentialFromTemplate() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> template = keymaster.createTemplate(schemaDid);

        java.time.Instant now = java.time.Instant.now();
        String validFrom = now.toString();
        String validUntil = now.plusSeconds(3600).toString();

        IssueCredentialOptions options = new IssueCredentialOptions();
        options.subject = subjectDid;
        options.schema = schemaDid;
        options.validFrom = validFrom;
        options.validUntil = validUntil;

        String did = keymaster.issueCredential(template, options);
        Map<String, Object> vc = keymaster.getCredential(did);

        org.junit.jupiter.api.Assertions.assertEquals(validFrom, vc.get("validFrom"));
        org.junit.jupiter.api.Assertions.assertEquals(validUntil, vc.get("validUntil"));
    }

    @Test
    @Tag("live")
    void publishCredentialRejectsNonCredential() {
        Keymaster keymaster = liveKeymaster();
        String bobDid = keymaster.createId("Bob");
        String did = keymaster.encryptJSON(TestFixtures.mockJson(), bobDid);

        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> {
            keymaster.publishCredential(did, false);
        });
    }

    @Test
    @Tag("live")
    void updateCredential() {
        Keymaster keymaster = liveKeymaster();
        String credentialDid = issueCredential(keymaster, "Alice", "Alice");

        Map<String, Object> vc = keymaster.getCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertNotNull(vc);
        vc.put("validUntil", java.time.Instant.now().plusSeconds(3600).toString());

        boolean ok = keymaster.updateCredential(credentialDid, vc);
        org.junit.jupiter.api.Assertions.assertTrue(ok);

        MdipDocument doc = keymaster.resolveDID(credentialDid);
        org.junit.jupiter.api.Assertions.assertNotNull(doc.didDocumentMetadata);
        org.junit.jupiter.api.Assertions.assertEquals("2", doc.didDocumentMetadata.version);
    }

    @Test
    @Tag("live")
    void revokeCredential() {
        Keymaster keymaster = liveKeymaster();
        String credentialDid = issueCredential(keymaster, "Alice", "Alice");

        boolean ok = keymaster.revokeCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(ok);

        MdipDocument revoked = keymaster.resolveDID(credentialDid);
        org.junit.jupiter.api.Assertions.assertNotNull(revoked.didDocumentMetadata);
        org.junit.jupiter.api.Assertions.assertTrue(Boolean.TRUE.equals(revoked.didDocumentMetadata.deactivated));
    }

    private Map<String, Object> manifestFromDoc(MdipDocument doc) {
        if (doc == null || doc.didDocumentData == null) {
            return Collections.emptyMap();
        }
        if (!(doc.didDocumentData instanceof Map<?, ?>)) {
            return Collections.emptyMap();
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) doc.didDocumentData;
        Object manifestObj = data.get("manifest");
        if (!(manifestObj instanceof Map<?, ?>)) {
            return Collections.emptyMap();
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> manifest = (Map<String, Object>) manifestObj;
        return manifest;
    }

    private String issueCredential(Keymaster keymaster, String issuerName, String subjectName) {
        String issuerDid = keymaster.createId(issuerName);
        String subjectDid = issuerDid;
        if (!issuerName.equals(subjectName)) {
            keymaster.createId(subjectName);
            subjectDid = keymaster.fetchIdInfo(subjectName).did;
            keymaster.setCurrentId(issuerName);
        }

        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid);
        return keymaster.issueCredential(bound);
    }
}
