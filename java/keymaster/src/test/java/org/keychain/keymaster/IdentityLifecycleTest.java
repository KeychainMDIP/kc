package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestGatekeeper;

class IdentityLifecycleTest {
    private static final String MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    private static final String PASSPHRASE = "passphrase";
    private final ObjectMapper mapper = WalletJsonMapper.mapper();
    private final KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
    private final FailingStore store = new FailingStore();
    private final TestGatekeeper node = new TestGatekeeper();
    private final Keymaster keymaster = client();

    private Keymaster client() {
        return new Keymaster(store, node.client, PASSPHRASE, "local");
    }

    private void initialize() {
        keymaster.newWallet(MNEMONIC, false);
    }

    @ParameterizedTest
    @ValueSource(strings = {"refuse", "throw"})
    void failedReservationPreventsPublication(String failure) {
        initialize();
        var active = keymaster.loadWallet();
        store.failAt = store.attempts + 1;
        store.failure = failure;

        assertThrows(IllegalStateException.class, () -> keymaster.createId("Alice"));

        assertTrue(node.created.isEmpty());
        assertSame(active, keymaster.loadWallet());
        assertEquals(0, client().loadWallet().counter);
    }

    @ParameterizedTest
    @CsvSource({"refuse,false", "refuse,true", "throw,false", "throw,true"})
    void publishedAccountStaysConsumedAfterStorageFailure(String failure, boolean restart) {
        initialize();
        store.failAt = store.attempts + 2;
        store.failure = failure;

        assertThrows(IllegalStateException.class, () -> keymaster.createId("Orphan"));

        assertEquals(1, node.created.size());
        assertEquals(1, client().loadWallet().counter);
        assertTrue(client().loadWallet().ids.isEmpty());
        Keymaster next = restart ? client() : keymaster;
        String did = next.createId("Next");
        assertEquals(1, next.fetchIdInfo("Next").account);
        assertEquals(2, client().loadWallet().counter);
        assertNotEquals(node.created.get(0).publicJwk.x, node.created.get(1).publicJwk.x);
        assertEquals(node.doc(did).didDocument.verificationMethod.get(0).publicKeyJwk.x, next.fetchKeyPair("Next").publicJwk.x);
    }

    @Test
    void ambiguousPublicationFailureDoesNotReuseAccount() {
        initialize();
        node.afterCreate = () -> { throw new IllegalStateException("connection lost after acceptance"); };

        assertThrows(IllegalStateException.class, () -> keymaster.createId("Orphan"));

        node.afterCreate = () -> {};
        assertEquals(1, client().loadWallet().counter);
        client().createId("Next");
        assertNotEquals(node.created.get(0).publicJwk.x, node.created.get(1).publicJwk.x);
    }

    @Test
    void accountAndRotationRangesDoNotWrap() {
        initialize();
        keymaster.mutateWallet(wallet -> wallet.counter = Integer.MAX_VALUE);
        assertThrows(IllegalStateException.class, () -> keymaster.createId("Overflow"));
        assertTrue(node.created.isEmpty());
        keymaster.mutateWallet(wallet -> wallet.counter = 0);
        keymaster.createId("Alice");
        keymaster.mutateWallet(wallet -> wallet.ids.get("Alice").index = Integer.MAX_VALUE);
        assertThrows(IllegalStateException.class, keymaster::rotateKeys);
        assertEquals(0, node.updates);
    }

    @ParameterizedTest
    @ValueSource(strings = {".", "..", " . ", " .. ", "\u00a0.\ufeff", "", "\ufeff", "\u001cAlice", "\u0000Alice", "Alice\u0085"})
    void invalidNamesCannotPublishOrCreateAliases(String name) {
        initialize();
        assertThrows(IllegalArgumentException.class, () -> keymaster.createId(name));
        assertThrows(IllegalArgumentException.class, () -> keymaster.addName(name, "did:test:unused"));
        assertTrue(node.created.isEmpty());
        assertEquals(0, client().loadWallet().counter);
        assertTrue(keymaster.listNames(false).isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"\u00a0Alice\ufeff", "\u2007Alice\u202f", "\tAlice\r\n", "\u2028Alice\u2029", "\u1680Alice\u3000"})
    void namesUseJavaScriptWhitespaceNormalization(String name) {
        initialize();
        String did = keymaster.createId(name);
        assertEquals("Alice", keymaster.getCurrentId());
        assertEquals(did, keymaster.fetchIdInfo("Alice").did);
        assertFalse(keymaster.loadWallet().ids.containsKey(name));
    }

    @Test
    void allNameWritersShareTheNormalizedNamespace() {
        initialize();
        String did = keymaster.createId("Alice");
        keymaster.addName("Friend", did);
        assertThrows(IllegalArgumentException.class, () -> keymaster.renameId("Alice", "\u00a0Friend\ufeff"));
        assertThrows(IllegalArgumentException.class, () -> keymaster.addName("Alice", did));
        keymaster.mutateWallet(wallet -> {
            wallet.names.put("\u2007Legacy\u202f", did);
            wallet.ids.put(" Historical ", mapper.convertValue(wallet.ids.get("Alice"), IDInfo.class));
        });
        assertThrows(IllegalArgumentException.class, () -> keymaster.createId("Legacy"));
        assertThrows(IllegalArgumentException.class, () -> keymaster.addName("Historical", did));
        assertEquals(1, node.created.size());
        assertTrue(keymaster.renameId("Alice", "\u00a0Renamed\ufeff"));
        assertEquals("Renamed", keymaster.getCurrentId());
        assertEquals(did, keymaster.getName("Friend"));
    }

    @Test
    void operationPreparationStillDoesNotReserveAnAccount() {
        initialize();
        keymaster.createIdOperation("Prepared", 4);
        assertEquals(0, keymaster.loadWallet().counter);
        assertTrue(node.created.isEmpty());
    }

    @Test
    void oldBackupReconcilesAfterMultipleRotations() {
        initialize();
        String did = keymaster.createId("Alice");
        assertTrue(keymaster.backupId());
        assertTrue(keymaster.rotateKeys());
        assertTrue(keymaster.rotateKeys());
        String currentKey = keymaster.fetchKeyPair(null).publicJwk.x;
        keymaster.newWallet(MNEMONIC, true);

        assertEquals("Alice", keymaster.recoverId("did:other:" + suffix(did)));

        Keymaster restarted = client();
        assertEquals(2, restarted.fetchIdInfo("Alice").index);
        assertEquals(currentKey, restarted.fetchKeyPair(null).publicJwk.x);
        assertTrue(restarted.rotateKeys());
        assertEquals(3, restarted.fetchIdInfo("Alice").index);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void recoveryPreservesTheHighestConsumedAccount(boolean reset) {
        initialize();
        keymaster.createId("First");
        keymaster.createId("Second");
        String did = keymaster.createId("Third");
        keymaster.backupId();
        if (reset) {
            keymaster.newWallet(MNEMONIC, true);
        } else {
            keymaster.createId("Fourth");
            keymaster.removeId("Third");
        }

        assertEquals("Third", keymaster.recoverId(did));
        int nextAccount = reset ? 3 : 4;
        assertEquals(nextAccount, keymaster.loadWallet().counter);
        keymaster.createId("Next");
        assertEquals(nextAccount, client().fetchIdInfo("Next").account);
    }

    @ParameterizedTest
    @ValueSource(strings = {"alias", "padded-id", "dot", "missing-index", "fractional-account", "wrong-did", "missing-key", "foreign-key", "oversized-index", "safe-limit-index", "rounded-safe-limit-index", "exhausted-account"})
    void invalidRecoveryCannotChangeWallet(String invalid) throws Exception {
        initialize();
        String did = keymaster.createId("Alice");
        keymaster.backupId();
        ObjectNode data = mapper.createObjectNode();
        data.put("name", "Alice");
        ObjectNode id = mapper.valueToTree(keymaster.fetchIdInfo("Alice"));
        data.set("id", id);
        if ("dot".equals(invalid)) data.put("name", "\u00a0..\ufeff");
        if ("missing-index".equals(invalid)) id.remove("index");
        if ("fractional-account".equals(invalid)) id.put("account", 0.5);
        if ("exhausted-account".equals(invalid)) id.put("account", Integer.MAX_VALUE);
        if ("wrong-did".equals(invalid)) id.put("did", keymaster.createId("Other"));
        if ("missing-key".equals(invalid)) node.doc(did).didDocument.verificationMethod.get(0).publicKeyJwk = null;
        if ("foreign-key".equals(invalid)) {
            String other = keymaster.createId("Other");
            node.doc(did).didDocument.verificationMethod.get(0).publicKeyJwk = node.doc(other).didDocument.verificationMethod.get(0).publicKeyJwk;
        }
        if ("oversized-index".equals(invalid)) node.doc(did).didDocument.verificationMethod.get(0).id = "#key-2147483649";
        if ("safe-limit-index".equals(invalid)) node.doc(did).didDocument.verificationMethod.get(0).id = "#key-9007199254740992";
        if ("rounded-safe-limit-index".equals(invalid)) node.doc(did).didDocument.verificationMethod.get(0).id = "#key-9007199254740993";
        var root = keymaster.hdKeyPair();
        node.vault(did).didDocumentData = Map.of("backup", crypto.encryptMessage(root.publicJwk, root.privateJwk, mapper.writeValueAsString(data)));
        keymaster.newWallet(MNEMONIC, true);
        if ("alias".equals(invalid)) keymaster.addName("Alice", did);
        if ("padded-id".equals(invalid)) {
            keymaster.mutateWallet(wallet -> wallet.ids.put(" Alice ", mapper.convertValue(id, IDInfo.class)));
        }
        JsonNode before = mapper.valueToTree(store.loadWallet());

        assertThrows(RuntimeException.class, () -> keymaster.recoverId(did));

        assertEquals(before, mapper.valueToTree(store.loadWallet()));
        assertEquals(0, keymaster.loadWallet().counter);
        assertFalse(keymaster.loadWallet().ids.containsKey("Alice"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"refuse", "throw"})
    void acceptedRotationKeepsItsKeyAfterPersistenceFailure(String failure) {
        initialize();
        String did = keymaster.createId("Alice");
        JsonNode stored = mapper.valueToTree(store.loadWallet());
        store.failAt = store.attempts + 1;
        store.failure = failure;

        assertThrows(IllegalStateException.class, keymaster::rotateKeys);

        assertEquals(stored, mapper.valueToTree(store.loadWallet()));
        assertEquals(1, keymaster.fetchIdInfo(null).index);
        assertEquals(node.doc(did).didDocument.verificationMethod.get(0).publicKeyJwk.x, keymaster.fetchKeyPair(null).publicJwk.x);
        keymaster.addName("PersistReconciliation", did);
        assertEquals(1, client().fetchIdInfo(null).index);
        assertNotNull(client().fetchKeyPair(null));
    }

    @Test
    void rejectedRotationDoesNotAdvanceTheKey() {
        initialize();
        keymaster.createId("Alice");
        String key = keymaster.fetchKeyPair(null).publicJwk.x;
        node.rejectUpdate = true;
        assertThrows(IllegalStateException.class, keymaster::rotateKeys);
        assertEquals(0, keymaster.fetchIdInfo(null).index);
        assertEquals(key, keymaster.fetchKeyPair(null).publicJwk.x);
    }

    @ParameterizedTest
    @ValueSource(strings = {"seed", "account"})
    void acceptedRotationCannotChangeAReplacementWallet(String different) {
        initialize();
        keymaster.createId("Alice");
        var replacement = mapper.convertValue(keymaster.loadWallet(), WalletFile.class);
        if ("seed".equals(different)) {
            Keymaster other = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), PASSPHRASE);
            replacement.seed = other.newWallet("legal winner thank year wave sausage worth useful legal winner thank yellow", false).seed;
        } else {
            replacement.ids.get("Alice").account = 1;
            replacement.counter = 2;
        }
        JsonNode expected = mapper.valueToTree(replacement);
        node.afterUpdate = () -> assertTrue(keymaster.saveWallet(replacement, true));

        assertThrows(IllegalStateException.class, keymaster::rotateKeys);

        assertEquals(1, node.updates);
        assertEquals(expected, mapper.valueToTree(keymaster.loadWallet()));
        assertEquals(expected, mapper.valueToTree(client().loadWallet()));
    }

    @Test
    void acceptedRotationReconcilesTheInitiatingIdentityAfterASelectionChange() {
        initialize();
        String alice = keymaster.createId("Alice");
        keymaster.createId("Bob");
        keymaster.setCurrentId("Alice");
        node.afterUpdate = () -> keymaster.setCurrentId("Bob");

        assertThrows(IllegalStateException.class, keymaster::rotateKeys);

        assertEquals("Bob", keymaster.getCurrentId());
        assertEquals(1, keymaster.fetchIdInfo("Alice").index);
        assertEquals(0, keymaster.fetchIdInfo("Bob").index);
        assertEquals(node.doc(alice).didDocument.verificationMethod.get(0).publicKeyJwk.x, keymaster.fetchKeyPair("Alice").publicJwk.x);
        keymaster.addName("PersistReconciliation", alice);
        assertNotNull(client().fetchKeyPair("Alice"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"legacy-key", "#key-01", "#key-9999999999999999999999999999999999999"})
    void recoveryUsesBackupIndexWhenTheKeyHintIsNotUsable(String method) {
        initialize();
        String did = keymaster.createId("Alice");
        keymaster.backupId();
        node.doc(did).didDocument.verificationMethod.get(0).id = method;
        keymaster.newWallet(MNEMONIC, true);

        assertEquals("Alice", keymaster.recoverId(did));

        assertEquals(0, keymaster.fetchIdInfo("Alice").index);
        assertNotNull(keymaster.fetchKeyPair("Alice"));
    }

    @Test
    void onlyAnUnconfirmedVersionOneMayRotate() {
        initialize();
        node.confirmed = false;
        String did = keymaster.createId("Alice", "hyperswarm");

        assertTrue(keymaster.rotateKeys());

        assertEquals(1, keymaster.fetchIdInfo(null).index);
        assertEquals("2", node.doc(did).didDocumentMetadata.version);
        assertTrue(node.requestedInitialKey);
        assertThrows(IllegalStateException.class, keymaster::rotateKeys);
        assertEquals(1, node.updates);
    }

    private static String suffix(String did) { return did.substring(did.lastIndexOf(':') + 1); }

    private static class FailingStore extends WalletJsonMemory<WalletEncFile> {
        int attempts;
        int failAt = -1;
        String failure;
        FailingStore() { super(WalletEncFile.class); }
        @Override
        public boolean saveWallet(WalletEncFile wallet, boolean overwrite) {
            if (++attempts == failAt) {
                if ("throw".equals(failure)) throw new IllegalStateException("storage failed");
                return false;
            }
            return super.saveWallet(wallet, overwrite);
        }
    }

}
