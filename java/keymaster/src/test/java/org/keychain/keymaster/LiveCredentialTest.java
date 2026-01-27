package org.keychain.keymaster;

import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.WalletFile;
import org.junit.jupiter.api.Test;
import org.keychain.keymaster.testutil.LiveTestSupport;
import org.keychain.keymaster.testutil.TestFixtures;

import static org.junit.jupiter.api.Assertions.assertTrue;

@Tag("live")
class LiveCredentialTest {
    @TempDir
    Path tempDir;

    protected Keymaster liveKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    private void assertCredentialShape(Map<String, Object> vc) {
        assertTrue(vc.containsKey("@context"), "missing @context");
        assertTrue(vc.containsKey("type"), "missing type");
        assertTrue(vc.containsKey("issuer"), "missing issuer");
        assertTrue(vc.containsKey("credentialSubject"), "missing credentialSubject");
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
        org.junit.jupiter.api.Assertions.assertEquals("TBD", template.get("email"));
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
        assertCredentialShape(vc);
        Object subjectObj = vc.get("credentialSubject");
        org.junit.jupiter.api.Assertions.assertInstanceOf(java.util.Map.class, subjectObj);
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, subject.get("id"));
        Object credObj = vc.get("credential");
        org.junit.jupiter.api.Assertions.assertInstanceOf(java.util.Map.class, credObj);
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> cred = (java.util.Map<String, Object>) credObj;
        org.junit.jupiter.api.Assertions.assertEquals("TBD", cred.get("email"));
        org.junit.jupiter.api.Assertions.assertTrue(keymaster.verifySignature(vc));

        WalletFile wallet = keymaster.loadWallet();
        IDInfo owner = wallet.ids.get("Alice");
        org.junit.jupiter.api.Assertions.assertTrue(owner.owned.contains(credentialDid));
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
        org.junit.jupiter.api.Assertions.assertInstanceOf(Map.class, subjectObj);
        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) subjectObj;
        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, subject.get("id"));
        Object credObj = vc.get("credential");
        org.junit.jupiter.api.Assertions.assertInstanceOf(Map.class, credObj);
        @SuppressWarnings("unchecked")
        Map<String, Object> cred = (Map<String, Object>) credObj;
        org.junit.jupiter.api.Assertions.assertEquals("alice@example.com", cred.get("email"));
        assertCredentialShape(vc);
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
        org.junit.jupiter.api.Assertions.assertInstanceOf(Map.class, subjectObj);
        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) subjectObj;
        org.junit.jupiter.api.Assertions.assertEquals(subjectDid, subject.get("id"));
        assertCredentialShape(vc);
    }

    @Test
    @Tag("live")
    void publishCredentialReveal() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        java.util.Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid);
        String credentialDid = keymaster.issueCredential(bound);

        PublishCredentialOptions reveal = new PublishCredentialOptions();
        reveal.reveal = true;
        keymaster.publishCredential(credentialDid, reveal);

        MdipDocument doc = keymaster.resolveDID(subjectDid);
        Map<String, Object> manifest = manifestFromDoc(doc);
        Object entryObj = manifest.get(credentialDid);
        org.junit.jupiter.api.Assertions.assertInstanceOf(Map.class, entryObj);
        @SuppressWarnings("unchecked")
        Map<String, Object> entry = (Map<String, Object>) entryObj;
        org.junit.jupiter.api.Assertions.assertNotNull(entry.get("credential"));
        Map<String, Object> vc = keymaster.getCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertNotNull(vc);
        assertCredentialShape(vc);
    }

    @Test
    @Tag("live")
    void publishCredentialNoReveal() {
        Keymaster keymaster = liveKeymaster();
        String subjectDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        java.util.Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid);
        String credentialDid = keymaster.issueCredential(bound);

        PublishCredentialOptions noReveal = new PublishCredentialOptions();
        noReveal.reveal = false;
        keymaster.publishCredential(credentialDid, noReveal);

        MdipDocument doc = keymaster.resolveDID(subjectDid);
        Map<String, Object> manifest = manifestFromDoc(doc);
        Object entryObj = manifest.get(credentialDid);
        org.junit.jupiter.api.Assertions.assertInstanceOf(Map.class, entryObj);
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
        PublishCredentialOptions reveal = new PublishCredentialOptions();
        reveal.reveal = true;
        keymaster.publishCredential(credentialDid, reveal);

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
        org.junit.jupiter.api.Assertions.assertInstanceOf(List.class, typesObj);
        @SuppressWarnings("unchecked")
        List<Object> types = (List<Object>) typesObj;
        org.junit.jupiter.api.Assertions.assertTrue(types.contains("VerifiableCredential"));
    }

    @Test
    @Tag("live")
    void listIssued() {
        Keymaster keymaster = liveKeymaster();
        String credentialDid = issueCredential(keymaster, "Bob", "Bob");

        List<String> issued = keymaster.listIssued("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(issued.contains(credentialDid));
    }

    @Test
    @Tag("live")
    void listIssuedReturnsOnlyIssuerCredentials() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Alice");
        keymaster.createId("Bob");
        keymaster.setCurrentId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());

        Map<String, Object> boundAlice = keymaster.bindCredential(schemaDid, keymaster.fetchIdInfo("Bob").did);
        String aliceCred = keymaster.issueCredential(boundAlice);

        keymaster.setCurrentId("Bob");
        Map<String, Object> boundBob = keymaster.bindCredential(schemaDid, keymaster.fetchIdInfo("Bob").did);
        String bobCred = keymaster.issueCredential(boundBob);

        List<String> issuedByAlice = keymaster.listIssued("Alice");
        org.junit.jupiter.api.Assertions.assertTrue(issuedByAlice.contains(aliceCred));
        org.junit.jupiter.api.Assertions.assertFalse(issuedByAlice.contains(bobCred));

        List<String> issuedByBob = keymaster.listIssued("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(issuedByBob.contains(bobCred));
        org.junit.jupiter.api.Assertions.assertFalse(issuedByBob.contains(aliceCred));
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
        keymaster.createId("Alice");
        keymaster.createId("Bob");
        keymaster.setCurrentId("Alice");
        String schemaDid = keymaster.createSchema(TestFixtures.mockSchema());
        String bobDid = keymaster.fetchIdInfo("Bob").did;
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        String credentialDid = keymaster.issueCredential(bound);
        String credentialDid2 = keymaster.issueCredential(bound);

        keymaster.setCurrentId("Bob");
        boolean accepted = keymaster.acceptCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(accepted);
        org.junit.jupiter.api.Assertions.assertTrue(keymaster.acceptCredential(credentialDid2));

        List<String> held = keymaster.listCredentials("Bob");
        org.junit.jupiter.api.Assertions.assertTrue(held.contains(credentialDid));
        org.junit.jupiter.api.Assertions.assertTrue(held.contains(credentialDid2));
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
        assertCredentialShape(vc);
    }

    @Test
    @Tag("live")
    void publishCredentialRejectsNonCredential() {
        Keymaster keymaster = liveKeymaster();
        String bobDid = keymaster.createId("Bob");
        String did = keymaster.encryptJSON(TestFixtures.mockJson(), bobDid);

        PublishCredentialOptions noReveal = new PublishCredentialOptions();
        noReveal.reveal = false;
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () ->
            keymaster.publishCredential(did, noReveal)
        );
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

        WalletFile before = keymaster.loadWallet();
        IDInfo owner = before.ids.get("Alice");
        org.junit.jupiter.api.Assertions.assertTrue(owner.owned.contains(credentialDid));

        boolean ok = keymaster.revokeCredential(credentialDid);
        org.junit.jupiter.api.Assertions.assertTrue(ok);

        MdipDocument revoked = keymaster.resolveDID(credentialDid);
        org.junit.jupiter.api.Assertions.assertNotNull(revoked.didDocumentMetadata);
        org.junit.jupiter.api.Assertions.assertEquals(true, revoked.didDocumentMetadata.deactivated);

        WalletFile after = keymaster.loadWallet();
        org.junit.jupiter.api.Assertions.assertFalse(after.ids.get("Alice").owned.contains(credentialDid));
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
        String subjectDid = keymaster.createId(issuerName);
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
