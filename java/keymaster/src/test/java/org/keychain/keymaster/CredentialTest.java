package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.testutil.AssertUtils;
import org.keychain.keymaster.testutil.GatekeeperStateful;
import org.keychain.keymaster.testutil.KeymasterTestSupport;
import org.keychain.keymaster.testutil.TestFixtures;

class CredentialTest {
    private static final String REGISTRY = "hyperswarm";

    @Test
    void createSchemaAndTemplate() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        createId(keymaster, gatekeeper, "Alice", "did:test:alice");

        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        Map<String, Object> template = keymaster.createTemplate(schemaDid);

        assertEquals(schemaDid, template.get("$schema"));
        assertEquals("TBD", template.get("email"));
    }

    @Test
    void bindCredentialUsesDefaultTemplate() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String aliceDid = createId(keymaster, gatekeeper, "Alice", "did:test:alice");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        Map<String, Object> vc = keymaster.bindCredential(schemaDid, bobDid);
        assertEquals(aliceDid, vc.get("issuer"));

        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) vc.get("credentialSubject");
        assertEquals(bobDid, subject.get("id"));

        @SuppressWarnings("unchecked")
        Map<String, Object> credential = (Map<String, Object>) vc.get("credential");
        assertEquals("TBD", credential.get("email"));

        @SuppressWarnings("unchecked")
        List<String> types = (List<String>) vc.get("type");
        assertEquals(List.of("VerifiableCredential", schemaDid), types);
        AssertUtils.assertCredentialShape(vc);
    }

    @Test
    void bindCredentialUsesProvidedCredential() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        createId(keymaster, gatekeeper, "Alice", "did:test:alice");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        Map<String, Object> provided = Map.of("email", "bob@mock.com");
        Map<String, Object> vc = keymaster.bindCredential(schemaDid, bobDid, null, null, provided);

        @SuppressWarnings("unchecked")
        Map<String, Object> credential = (Map<String, Object>) vc.get("credential");
        assertEquals("bob@mock.com", credential.get("email"));
        AssertUtils.assertCredentialShape(vc);
    }

    @Test
    void issueCredentialFromBound() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred1";
        String credentialDid = keymaster.issueCredential(bound);

        assertEquals("did:test:cred1", credentialDid);
        @SuppressWarnings("unchecked")
        Map<String, Object> vc = (Map<String, Object>) keymaster.decryptJSON(credentialDid);
        assertEquals(bobDid, vc.get("issuer"));
        AssertUtils.assertCredentialShape(vc);

        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) vc.get("credentialSubject");
        assertEquals(bobDid, subject.get("id"));

        @SuppressWarnings("unchecked")
        Map<String, Object> credential = (Map<String, Object>) vc.get("credential");
        assertEquals("TBD", credential.get("email"));
        AssertUtils.assertCredentialShape(vc);

        WalletFile wallet = keymaster.loadWallet();
        assertTrue(wallet.ids.get("Bob").owned.contains(credentialDid));
    }

    @Test
    void issueCredentialFromTemplateWithOptions() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        Map<String, Object> template = keymaster.createTemplate(schemaDid);
        IssueCredentialOptions options = new IssueCredentialOptions();
        options.schema = schemaDid;
        options.subject = bobDid;
        options.validFrom = Instant.now().toString();
        options.validUntil = Instant.now().plusSeconds(3600).toString();

        gatekeeper.createResponse = "did:test:cred2";
        String credentialDid = keymaster.issueCredential(template, options);
        assertEquals("did:test:cred2", credentialDid);

        @SuppressWarnings("unchecked")
        Map<String, Object> vc = (Map<String, Object>) keymaster.decryptJSON(credentialDid);
        assertEquals(bobDid, vc.get("issuer"));
        assertEquals(options.validFrom, vc.get("validFrom"));
        assertEquals(options.validUntil, vc.get("validUntil"));
        AssertUtils.assertCredentialShape(vc);

        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) vc.get("credentialSubject");
        assertEquals(bobDid, subject.get("id"));
    }

    @Test
    void publishCredentialReveals() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred1";
        String credentialDid = keymaster.issueCredential(bound);

        keymaster.publishCredential(credentialDid, true);

        MdipDocument doc = keymaster.resolveDID(bobDid);
        @SuppressWarnings("unchecked")
        Map<String, Object> manifest = (Map<String, Object>) ((Map<String, Object>) doc.didDocumentData).get("manifest");
        @SuppressWarnings("unchecked")
        Map<String, Object> vc = (Map<String, Object>) keymaster.decryptJSON(credentialDid);

        assertEquals(vc, manifest.get(credentialDid));
        AssertUtils.assertCredentialShape(vc);
    }

    @Test
    void publishCredentialWithoutReveal() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred2";
        String credentialDid = keymaster.issueCredential(bound);

        keymaster.publishCredential(credentialDid, false);

        MdipDocument doc = keymaster.resolveDID(bobDid);
        @SuppressWarnings("unchecked")
        Map<String, Object> manifest = (Map<String, Object>) ((Map<String, Object>) doc.didDocumentData).get("manifest");
        @SuppressWarnings("unchecked")
        Map<String, Object> vc = (Map<String, Object>) manifest.get(credentialDid);

        assertTrue(vc.containsKey("credential"));
        assertEquals(null, vc.get("credential"));
        AssertUtils.assertCredentialShape(vc);
    }

    @Test
    void unpublishCredentialRemovesManifestEntry() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred3";
        String credentialDid = keymaster.issueCredential(bound);

        keymaster.publishCredential(credentialDid, true);
        keymaster.unpublishCredential(credentialDid);

        MdipDocument doc = keymaster.resolveDID(bobDid);
        @SuppressWarnings("unchecked")
        Map<String, Object> manifest = (Map<String, Object>) ((Map<String, Object>) doc.didDocumentData).get("manifest");
        assertTrue(manifest.isEmpty());
    }

    @Test
    void acceptCredentialAddsToHeld() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        createId(keymaster, gatekeeper, "Alice", "did:test:alice");

        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        String bobDid = keymaster.lookupDID("Bob");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred4";
        String credentialDid = keymaster.issueCredential(bound);

        setCurrent(keymaster, "Bob");
        boolean ok = keymaster.acceptCredential(credentialDid);
        assertTrue(ok);

        WalletFile wallet = keymaster.loadWallet();
        assertTrue(wallet.ids.get("Bob").held.contains(credentialDid));
        assertTrue(wallet.ids.get("Alice").owned.contains(credentialDid));
    }

    @Test
    void acceptCredentialReturnsFalseWhenCannotDecrypt() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        createId(keymaster, gatekeeper, "Alice", "did:test:alice");
        createId(keymaster, gatekeeper, "Carol", "did:test:carol");

        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        String bobDid = keymaster.lookupDID("Bob");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred5";
        String credentialDid = keymaster.issueCredential(bound);

        setCurrent(keymaster, "Carol");
        boolean ok = keymaster.acceptCredential(credentialDid);
        assertTrue(!ok);
    }

    @Test
    void acceptCredentialReturnsFalseWhenSubjectMismatch() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        createId(keymaster, gatekeeper, "Alice", "did:test:alice");
        createId(keymaster, gatekeeper, "Carol", "did:test:carol");

        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        String bobDid = keymaster.lookupDID("Bob");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred6";
        String credentialDid = keymaster.issueCredential(bound);

        @SuppressWarnings("unchecked")
        Map<String, Object> vc = (Map<String, Object>) keymaster.getCredential(credentialDid);
        String carolDid = keymaster.lookupDID("Carol");
        String wrappedDid = keymaster.encryptJSON(vc, carolDid);

        setCurrent(keymaster, "Carol");
        boolean ok = keymaster.acceptCredential(wrappedDid);
        assertTrue(!ok);
    }

    @Test
    void acceptCredentialReturnsFalseForInvalidCredential() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        createId(keymaster, gatekeeper, "Alice", "did:test:alice");

        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");
        setCurrent(keymaster, "Bob");
        boolean ok = keymaster.acceptCredential(schemaDid);
        assertTrue(!ok);
    }

    @Test
    void listIssuedReturnsOnlyIssuerCredentials() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String aliceDid = createId(keymaster, gatekeeper, "Alice", "did:test:alice");
        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        setCurrent(keymaster, "Alice");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred1";
        String cred1 = keymaster.issueCredential(bound);

        setCurrent(keymaster, "Bob");
        Map<String, Object> bound2 = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred2";
        String cred2 = keymaster.issueCredential(bound2);

        setCurrent(keymaster, "Alice");
        List<String> issued = keymaster.listIssued(null);
        assertEquals(1, issued.size());
        assertTrue(issued.contains(cred1));
        assertTrue(!issued.contains(cred2));
        assertEquals(aliceDid, keymaster.lookupDID("Alice"));
    }

    @Test
    void listCredentialsReturnsHeldCredentials() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String aliceDid = createId(keymaster, gatekeeper, "Alice", "did:test:alice");
        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        setCurrent(keymaster, "Alice");
        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred1";
        String cred1 = keymaster.issueCredential(bound);
        gatekeeper.createResponse = "did:test:cred2";
        String cred2 = keymaster.issueCredential(bound);

        setCurrent(keymaster, "Bob");
        keymaster.acceptCredential(cred1);
        keymaster.acceptCredential(cred2);

        List<String> held = keymaster.listCredentials("Bob");
        assertEquals(List.of(cred1, cred2), held);
        assertEquals(bobDid, keymaster.lookupDID("Bob"));
        assertEquals(aliceDid, keymaster.lookupDID("Alice"));
    }

    @Test
    void updateCredentialUpdatesDocumentVersion() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred3";
        String credentialDid = keymaster.issueCredential(bound);

        @SuppressWarnings("unchecked")
        Map<String, Object> vc = (Map<String, Object>) keymaster.getCredential(credentialDid);
        AssertUtils.assertCredentialShape(vc);
        Map<String, Object> updated = new HashMap<>(vc);
        updated.put("credential", Map.of("email", "bob-updated@example.com"));

        assertTrue(keymaster.updateCredential(credentialDid, updated));
        MdipDocument doc = keymaster.resolveDID(credentialDid);
        assertEquals("2", doc.didDocumentMetadata.version);
    }

    @Test
    void revokeCredentialRemovesOwnedEntry() {
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = block("blockhash");
        Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

        String bobDid = createId(keymaster, gatekeeper, "Bob", "did:test:bob");
        String schemaDid = createSchema(keymaster, gatekeeper, "did:test:schema1");

        Map<String, Object> bound = keymaster.bindCredential(schemaDid, bobDid);
        gatekeeper.createResponse = "did:test:cred4";
        String credentialDid = keymaster.issueCredential(bound);

        WalletFile wallet = keymaster.loadWallet();
        assertTrue(wallet.ids.get("Bob").owned.contains(credentialDid));

        assertTrue(keymaster.revokeCredential(credentialDid));
        WalletFile updated = keymaster.loadWallet();
        assertTrue(!updated.ids.get("Bob").owned.contains(credentialDid));
    }

    private static BlockInfo block(String hash) {
        BlockInfo info = new BlockInfo();
        info.hash = hash;
        return info;
    }

    private static void setCurrent(Keymaster keymaster, String name) {
        keymaster.mutateWallet(wallet -> wallet.current = name);
    }

    private static String createId(Keymaster keymaster, GatekeeperStateful gatekeeper, String name, String did) {
        gatekeeper.createResponse = did;
        String created = keymaster.createId(name, REGISTRY);
        assertEquals(did, created);
        return created;
    }

    private static String createSchema(Keymaster keymaster, GatekeeperStateful gatekeeper, String did) {
        gatekeeper.createResponse = did;
        String created = keymaster.createSchema(TestFixtures.mockSchema(), REGISTRY);
        assertNotNull(created);
        assertEquals(did, created);
        return created;
    }
}
