package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.crypto.CanonicalJson;
import org.keychain.crypto.JwkPair;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestFixtures;
import org.keychain.keymaster.testutil.TestGatekeeper;

class OperationBindingTest {
    private static final String MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    private final ObjectMapper mapper = WalletJsonMapper.mapper();
    private final TestGatekeeper node = new TestGatekeeper();
    private final WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
    private final Keymaster keymaster = new Keymaster(store, node.client, "passphrase", "local");
    private String alice;
    private String bob;

    @BeforeEach
    void initialize() {
        keymaster.newWallet(MNEMONIC, false);
        alice = keymaster.createId("Alice");
        bob = keymaster.createId("Bob");
        keymaster.setCurrentId("Alice");
    }

    @Test
    void aBlockedAssetCreationKeepsItsOwnerWithoutBlockingSelection() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicBoolean once = new AtomicBoolean();
        node.beforeResolve = did -> {
            if (did.equals(alice) && once.compareAndSet(false, true)) {
                entered.countDown();
                try {
                    assertTrue(release.await(10, TimeUnit.SECONDS));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(e);
                }
            }
        };
        var worker = Executors.newSingleThreadExecutor();
        try {
            var result = worker.submit(() -> keymaster.createAsset(Map.of("value", 1)));
            assertTrue(entered.await(10, TimeUnit.SECONDS));
            assertTrue(keymaster.setCurrentId("Bob"));
            release.countDown();
            String did = result.get(10, TimeUnit.SECONDS);
            assertEquals(alice, node.doc(did).didDocument.controller);
            assertTrue(keymaster.listAssets("Alice").contains(did));
            assertFalse(keymaster.listAssets("Bob").contains(did));
            assertEquals("Bob", keymaster.getCurrentId());
        } finally {
            release.countDown();
            worker.shutdownNow();
        }
    }

    @Test
    void aDelegatedControllerSignsWhileTheInitiatingOwnerTracksTheAsset() {
        switchOnResolve(bob, "Bob");
        String did = keymaster.createAsset(Map.of("value", 1), "local", bob, null);
        assertEquals(bob, node.doc(did).didDocument.controller);
        assertEquals(bob, node.created.get(node.created.size() - 1).signature.signer);
        assertTrue(keymaster.listAssets("Alice").contains(did));
        assertFalse(keymaster.listAssets("Bob").contains(did));
    }

    @Test
    void cloningKeepsTheInitiatingOwner() {
        String original = keymaster.createAsset(Map.of("value", 1));
        switchOnResolve(original, "Bob");
        String cloned = keymaster.cloneAsset(original);
        assertEquals(alice, node.doc(cloned).didDocument.controller);
        assertTrue(keymaster.listAssets("Alice").contains(cloned));
        assertFalse(keymaster.listAssets("Bob").contains(cloned));
    }

    @Test
    void encryptionKeepsTheSenderControllerAndBookkeepingTogether() {
        switchOnResolve(alice, "Bob");
        String did = keymaster.encryptMessage("private", bob);
        assertEquals(alice, encrypted(did).get("sender"));
        assertEquals(alice, node.doc(did).didDocument.controller);
        assertTrue(keymaster.listAssets("Alice").contains(did));
        assertFalse(keymaster.listAssets("Bob").contains(did));
        assertEquals("private", keymaster.decryptMessage(did));
        keymaster.setCurrentId("Alice");
        assertEquals("private", keymaster.decryptMessage(did));
    }

    @Test
    void signingUsesTheCapturedIdentityEvenIfSelectionChangesBeforeKeyLookup() {
        Keymaster signer = new Keymaster(store, node.client, "passphrase", "local") {
            @Override
            public JwkPair fetchKeyPair(String id) {
                setCurrentId("Bob");
                return super.fetchKeyPair(id);
            }
        };
        Map<String, Object> signed = signer.addSignature(Map.of("value", 1));
        assertEquals(alice, ((Map<?, ?>) signed.get("signature")).get("signer"));
        assertTrue(signer.verifySignature(signed));
    }

    @Test
    void encryptedAssetsMayHaveADelegatedControllerWithoutChangingTheSender() {
        EncryptOptions options = new EncryptOptions();
        options.controller = bob;
        switchOnResolve(alice, "Bob");
        String did = keymaster.encryptJSON(Map.of("value", 1), bob, options);
        assertEquals(alice, encrypted(did).get("sender"));
        assertEquals(bob, node.doc(did).didDocument.controller);
        assertTrue(keymaster.listAssets("Alice").contains(did));
        assertFalse(keymaster.listAssets("Bob").contains(did));
        assertEquals(Map.of("value", 1), keymaster.decryptJSON(did));
    }

    @Test
    void acceptanceStoresUnderTheHolderSelectedBeforeResolution() {
        String vc = credential();
        keymaster.setCurrentId("Bob");
        switchOnResolve(vc, "Alice");
        assertTrue(keymaster.acceptCredential(vc));
        assertTrue(keymaster.listCredentials("Bob").contains(vc));
        assertFalse(keymaster.listCredentials("Alice").contains(vc));
    }

    @Test
    void listIssuedDecryptsForTheRequestedIssuerRatherThanTheCurrentIdentity() {
        String vc = credential();
        keymaster.createId("Other");
        assertEquals(List.of(vc), keymaster.listIssued("Alice"));
        assertTrue(keymaster.listIssued().isEmpty());
    }

    @Test
    void issuanceKeepsTheOriginalIssuerThroughSigningAndEncryption() {
        String schema = keymaster.createSchema(TestFixtures.mockSchema());
        IssueCredentialOptions options = new IssueCredentialOptions();
        options.schema = schema;
        options.subject = bob;
        switchOnResolve(alice, "Bob");
        String vc = keymaster.issueCredential(Map.of("email", "alice@example.test"), options);
        Map<String, Object> plaintext = keymaster.getCredential(vc);
        assertEquals(alice, plaintext.get("issuer"));
        assertEquals(alice, ((Map<?, ?>) plaintext.get("signature")).get("signer"));
        assertEquals(alice, encrypted(vc).get("sender"));
        assertEquals(alice, node.doc(vc).didDocument.controller);
        assertTrue(keymaster.listAssets("Alice").contains(vc));
    }

    @Test
    void updatingACredentialKeepsItsIssuerAndEncryptionSender() {
        String vc = credential();
        Map<String, Object> replacement = new LinkedHashMap<>(keymaster.getCredential(vc));
        replacement.put("credential", Map.of("email", "updated@example.test"));
        switchOnResolve(vc, "Bob");
        assertTrue(keymaster.updateCredential(vc, replacement));
        assertEquals(alice, encrypted(vc).get("sender"));
        Map<String, Object> updated = keymaster.getCredential(vc);
        assertEquals(alice, updated.get("issuer"));
        assertEquals(alice, ((Map<?, ?>) updated.get("signature")).get("signer"));
        assertEquals(Map.of("email", "updated@example.test"), updated.get("credential"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Alice", "Bob"})
    void identityBackupKeepsItsInitiatingOwnerAndExplicitController(String target) {
        String targetDid = "Alice".equals(target) ? alice : bob;
        switchOnResolve(targetDid, "Bob");
        assertTrue(keymaster.backupId(target));
        String vault = (String) ((Map<?, ?>) node.doc(targetDid).didDocumentData).get("vault");
        assertEquals(targetDid, node.doc(vault).didDocument.controller);
        assertTrue(keymaster.listAssets("Alice").contains(vault));
        assertFalse(keymaster.listAssets("Bob").contains(vault));
    }

    @Test
    void responseCreationKeepsTheResponderAcrossChallengeResolution() {
        String[] flow = challengeFlow();
        switchOnResolve(flow[0], "Alice");
        String response = keymaster.createResponse(flow[0]);
        assertEquals(bob, node.doc(response).didDocument.controller);
        keymaster.setCurrentId("Requester");
        Map<?, ?> result = (Map<?, ?>) ((Map<?, ?>) keymaster.decryptJSON(response)).get("response");
        assertEquals(true, result.get("match"));
        Map<?, ?> pair = (Map<?, ?>) ((List<?>) result.get("credentials")).get(0);
        assertEquals(bob, node.doc((String) pair.get("vp")).didDocument.controller);
        assertEquals(flow[1], pair.get("vc"));
    }

    @Test
    void responseVerificationKeepsTheVerifierAcrossResponseResolution() {
        String[] flow = challengeFlow();
        String response = keymaster.createResponse(flow[0]);
        keymaster.setCurrentId("Requester");
        switchOnResolve(response, "Alice");
        Map<String, Object> verified = keymaster.verifyResponse(response);
        assertEquals(true, verified.get("match"));
        assertEquals(bob, verified.get("responder"));
        assertEquals(1, ((List<?>) verified.get("vps")).size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"name", "controller", "both"})
    void responseOptionsDoNotNameOrDelegateItsPresentations(String ignored) {
        String[] flow = challengeFlow();
        CreateResponseOptions options = new CreateResponseOptions();
        if (!"controller".equals(ignored)) options.name = "Alice";
        if (!"name".equals(ignored)) options.controller = alice;
        JsonNode before = mapper.valueToTree(options);

        String response = keymaster.createResponse(flow[0], options);

        assertEquals(bob, node.doc(response).didDocument.controller);
        assertEquals(before, mapper.valueToTree(options));
        keymaster.setCurrentId("Requester");
        Map<?, ?> result = (Map<?, ?>) ((Map<?, ?>) keymaster.decryptJSON(response)).get("response");
        assertEquals(true, result.get("match"));
        Map<?, ?> pair = (Map<?, ?>) ((List<?>) result.get("credentials")).get(0);
        assertEquals(bob, node.doc((String) pair.get("vp")).didDocument.controller);
    }

    @ParameterizedTest
    @ValueSource(strings = {"name", "controller", "both"})
    void issuanceOptionsDoNotNameOrDelegateTheCredential(String ignored) {
        String schema = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bound = keymaster.bindCredential(schema, bob, null, null, Map.of("email", "alice@example.test"));
        IssueCredentialOptions options = new IssueCredentialOptions();
        if (!"controller".equals(ignored)) options.name = "Alice";
        if (!"name".equals(ignored)) options.controller = bob;
        JsonNode before = mapper.valueToTree(options);

        String vc = keymaster.issueCredential(bound, options);

        assertEquals(alice, node.doc(vc).didDocument.controller);
        assertEquals(alice, encrypted(vc).get("sender"));
        assertTrue(keymaster.listAssets("Alice").contains(vc));
        assertFalse(keymaster.listAssets("Bob").contains(vc));
        assertEquals(before, mapper.valueToTree(options));
    }

    @ParameterizedTest
    @ValueSource(strings = {".", " .. ", "\u00a0", "Alice", " Alice "})
    void invalidAssetAliasesFailBeforePublication(String name) {
        CreateAssetOptions options = new CreateAssetOptions();
        options.name = name;
        int before = node.created.size();
        assertThrows(IllegalArgumentException.class, () -> keymaster.createAsset(Map.of("value", 1), options));
        assertEquals(before, node.created.size());
    }

    @Test
    void optionsApplyPrefixesBeforeSigningAndKeepEphemeralAssetsOnHyperswarm() {
        KeymasterOptions options = new KeymasterOptions();
        options.wallet = store;
        options.gatekeeper = node.client;
        options.passphrase = "passphrase";
        options.defaultRegistry = "local";
        options.didPrefix = "did:custom";
        options.maxNameLength = 8;
        Keymaster configured = new Keymaster(options);
        String id = configured.createId("Custom");
        assertTrue(id.startsWith("did:custom:"));
        assertThrows(IllegalArgumentException.class, () -> configured.createId("TooLongForLimit"));
        String asset = configured.createAsset(Map.of("value", 1));
        String backup = configured.backupWallet();
        String challenge = configured.createChallenge();
        for (String did : List.of(id, asset, backup, challenge)) {
            assertTrue(did.startsWith("did:custom:"));
            assertEquals("did:custom", node.doc(did).mdip.prefix);
        }
        assertEquals("hyperswarm", node.doc(challenge).mdip.registry);
        Operation seedBank = node.created.stream().filter(op -> "agent".equals(op.mdip.type) && op.created.startsWith("1970")).findFirst().orElseThrow();
        assertNull(seedBank.mdip.prefix);
        assertEquals("local", seedBank.mdip.registry);
    }

    @ParameterizedTest
    @ValueSource(strings = {"invalid", "did:Upper", "did:", "did:has-dash"})
    void invalidConfiguredPrefixesFailWithoutPublishing(String prefix) {
        KeymasterOptions options = new KeymasterOptions();
        options.wallet = store;
        options.passphrase = "passphrase";
        options.didPrefix = prefix;
        assertThrows(IllegalArgumentException.class, () -> new Keymaster(options));
        assertEquals(2, node.created.size());
    }

    @Test
    void unconfirmedEncryptionAndHistoricalDecryptionUseOnlyTheCreateKey() {
        node.confirmed = false;
        String pending = keymaster.createId("Pending", "hyperswarm");
        keymaster.setCurrentId("Alice");
        String encrypted = keymaster.encryptMessage("private", pending);
        keymaster.setCurrentId("Pending");
        String reply = keymaster.encryptMessage("reply", alice);
        keymaster.setCurrentId("Alice");
        node.resolveOptions.clear();
        node.resolvedDids.clear();
        assertEquals("reply", keymaster.decryptMessage(reply));
        String created = (String) encrypted(reply).get("created");
        assertEquals(3, node.resolveOptions.size());
        assertNull(node.resolveOptions.get(0));
        assertTrue(node.resolveOptions.get(1).confirm);
        assertEquals(created, node.resolveOptions.get(1).versionTime);
        assertEquals(1, node.resolveOptions.get(2).versionSequence);
        assertEquals(created, node.resolveOptions.get(2).versionTime);
        keymaster.setCurrentId("Pending");
        assertEquals("private", keymaster.decryptMessage(encrypted));
    }

    @Test
    void permanentResolutionFailuresAreNotReplacedWithAnUnconfirmedKey() {
        node.beforeResolve = did -> {
            if (did.equals(bob)) throw new IllegalStateException("HTTP 401");
        };
        assertThrows(IllegalStateException.class, () -> keymaster.encryptMessage("private", bob));
        assertFalse(node.requestedInitialKey);
    }

    @ParameterizedTest
    @ValueSource(strings = {"invalidDid", "representationNotSupported"})
    void failedResolutionCannotSupplyKeysEvenIfTheResponseRetainsThem(String error) {
        node.doc(bob).didResolutionMetadata = new MdipDocument.DidResolutionMetadata();
        node.doc(bob).didResolutionMetadata.error = error;
        assertThrows(IllegalArgumentException.class, () -> keymaster.encryptMessage("private", bob));
        assertFalse(node.requestedInitialKey);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void staleUpdatesKeepTheCallerAndCannotBeRetriedOverANewerVersion(boolean sameData) {
        MdipDocument stale = copy(node.doc(alice));
        node.doc(alice).didDocumentMetadata.versionId = "newer-version";
        if (!sameData) stale.didDocumentData = Map.of("value", "stale");
        JsonNode before = mapper.valueToTree(stale);
        assertFalse(keymaster.updateDID(stale));
        assertFalse(keymaster.updateDID(stale));
        assertEquals(before, mapper.valueToTree(stale));
        assertTrue(node.submitted.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void updatesWithoutMetadataRetainTheLegacyPathAndDoNotChangeTheCaller(boolean reject) {
        MdipDocument replacement = copy(node.doc(alice));
        String currentVersion = replacement.didDocumentMetadata.versionId;
        replacement.didDocumentMetadata = null;
        replacement.didDocumentData = Map.of("value", "updated");
        JsonNode before = mapper.valueToTree(replacement);
        node.rejectUpdate = reject;
        assertEquals(!reject, keymaster.updateDID(replacement));
        assertEquals(before, mapper.valueToTree(replacement));
        Operation submitted = node.submitted.get(0);
        assertEquals(currentVersion, submitted.previd);
        assertEquals("{}", CanonicalJson.canonicalize(submitted.doc.didDocumentMetadata));
        assertNull(submitted.doc.didResolutionMetadata);
    }

    @ParameterizedTest
    @ValueSource(strings = {"unpublish", "wallet-backup"})
    void rejectedUpdatesCannotReportSuccess(String action) {
        if ("unpublish".equals(action)) {
            String vc = credential();
            keymaster.setCurrentId("Bob");
            keymaster.publishCredential(vc);
            node.rejectUpdate = true;
            assertThrows(IllegalStateException.class, () -> keymaster.unpublishCredential(vc));
            assertTrue(((Map<?, ?>) ((Map<?, ?>) node.doc(bob).didDocumentData).get("manifest")).containsKey(vc));
        } else {
            node.rejectUpdate = true;
            assertThrows(IllegalStateException.class, keymaster::backupWallet);
        }
    }

    @Test
    void staleSeedBankUpdateRetainsItsVersionPrecondition() {
        MdipDocument update = keymaster.resolveSeedBank();
        node.doc(update.didDocument.id).didDocumentMetadata.versionId = "newer-version";
        JsonNode before = mapper.valueToTree(update);
        assertFalse(keymaster.updateSeedBank(update));
        assertEquals(before, mapper.valueToTree(update));
        assertTrue(node.submitted.isEmpty());
    }

    private void switchOnResolve(String target, String next) {
        AtomicBoolean once = new AtomicBoolean();
        node.beforeResolve = did -> {
            if (did.equals(target) && once.compareAndSet(false, true)) keymaster.setCurrentId(next);
        };
    }

    private String credential() {
        keymaster.setCurrentId("Alice");
        String schema = keymaster.createSchema(TestFixtures.mockSchema());
        return keymaster.issueCredential(keymaster.bindCredential(schema, bob, null, null, Map.of("email", "alice@example.test")));
    }

    private String[] challengeFlow() {
        String vc = credential();
        keymaster.setCurrentId("Bob");
        assertTrue(keymaster.acceptCredential(vc));
        keymaster.createId("Requester");
        keymaster.setCurrentId("Bob");
        Map<?, ?> credential = keymaster.getCredential(vc);
        String schema = (String) ((List<?>) credential.get("type")).get(1);
        keymaster.setCurrentId("Requester");
        String challenge = keymaster.createChallenge(Map.of("credentials", List.of(Map.of("schema", schema, "issuers", List.of(alice)))));
        keymaster.setCurrentId("Bob");
        return new String[] {challenge, vc};
    }

    private Map<?, ?> encrypted(String did) {
        return (Map<?, ?>) ((Map<?, ?>) node.doc(did).didDocumentData).get("encrypted");
    }

    private MdipDocument copy(MdipDocument doc) {
        return mapper.convertValue(doc, MdipDocument.class);
    }
}
