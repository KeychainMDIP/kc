package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import java.util.stream.Stream;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestFixtures;
import org.keychain.keymaster.testutil.TestGatekeeper;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

@SuppressWarnings("unchecked")
class AssetGroupCleanupTest {
    private final ObjectMapper mapper = WalletJsonMapper.mapper();
    private final TestGatekeeper node = new TestGatekeeper();
    private final WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
    private final Keymaster keymaster = new Keymaster(store, node.client, "passphrase", "local");
    private String alice;
    private String bob;

    @BeforeEach
    void initialize() {
        keymaster.newWallet("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", false);
        alice = keymaster.createId("Alice");
        bob = keymaster.createId("Bob");
        keymaster.setCurrentId("Alice");
    }

    @Test
    void resolutionForwardsHistoricalAndConfirmationOptionsUnchanged() {
        String did = keymaster.createAsset(Map.of("original", true));
        assertTrue(keymaster.updateAsset(did, Map.of("newer", true)));
        ResolveDIDOptions options = new ResolveDIDOptions();
        options.versionSequence = 1;
        options.versionTime = "2099-01-01T00:00:00Z";
        options.confirm = true;
        options.verify = true;
        JsonNode before = mapper.valueToTree(options);
        assertEquals(Map.of("original", true), keymaster.resolveAsset(did, options));
        assertEquals(before, mapper.valueToTree(node.resolveOptions.get(node.resolveOptions.size() - 1)));
        assertEquals(before, mapper.valueToTree(options));
    }

    @ParameterizedTest
    @ValueSource(strings = {"connection", "timeout", "permission", "not-found", "resolution-error"})
    void resolutionFailuresArePropagated(String failure) {
        String did = keymaster.createAsset(Map.of("data", true));
        RuntimeException error = failure.equals("permission") ? new IllegalArgumentException("HTTP 403")
            : new IllegalStateException(failure);
        if (failure.equals("not-found")) node.docs.remove(suffix(did));
        else if (failure.equals("resolution-error")) {
            node.doc(did).didResolutionMetadata = new org.keychain.gatekeeper.model.MdipDocument.DidResolutionMetadata();
            node.doc(did).didResolutionMetadata.error = "temporarilyUnavailable";
        } else node.beforeResolve = value -> { if (did.equals(value)) throw error; };
        RuntimeException actual = assertThrows(RuntimeException.class, () -> keymaster.resolveAsset(did));
        if (!failure.equals("not-found") && !failure.equals("resolution-error")) assertSame(error, actual);
    }

    @ParameterizedTest
    @ValueSource(strings = {"agent", "revoked", "controller", "data", "false", "zero", "empty-string"})
    void unavailableAssetDataReturnsAnEmptyObject(String shape) {
        String did = keymaster.createAsset(Map.of("data", true));
        switch (shape) {
            case "agent": did = alice; break;
            case "revoked": node.doc(did).didDocumentMetadata.deactivated = true; break;
            case "controller": node.doc(did).didDocument.controller = null; break;
            case "data": node.doc(did).didDocumentData = null; break;
            case "false": node.doc(did).didDocumentData = false; break;
            case "zero": node.doc(did).didDocumentData = 0; break;
            case "empty-string": node.doc(did).didDocumentData = ""; break;
            default: fail(shape);
        }
        assertEquals(Map.of(), keymaster.resolveAsset(did));
    }

    @Test
    void assetDataUsesTheReferenceControllerContractWithoutAnExtraMdipTypeCheck() {
        String did = keymaster.createAsset(List.of());
        node.doc(did).mdip = null;
        assertEquals(List.of(), keymaster.resolveAsset(did));
    }

    @Test
    void shallowAssetUpdatesRetainExplicitNullsWithoutChangingThePatch() {
        String did = keymaster.createAsset(Map.of("kept", true, "nullable", "before", "nested", Map.of("old", true)));
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("nullable", null);
        patch.put("nested", Map.of("new", true));
        JsonNode before = mapper.valueToTree(patch);
        assertTrue(keymaster.updateAsset(did, patch));
        Map<?, ?> data = (Map<?, ?>) keymaster.resolveAsset(did);
        assertEquals(true, data.get("kept"));
        assertTrue(data.containsKey("nullable"));
        assertNull(data.get("nullable"));
        assertEquals(Map.of("new", true), data.get("nested"));
        assertEquals(before, mapper.valueToTree(patch));
    }

    @Test
    void templateResolvesTheSchemaAliasAndNamesListingDoesNotMutateTheWallet() {
        String schema = keymaster.createSchema(TestFixtures.mockSchema());
        keymaster.addName("schema-alias", schema);
        JsonNode before = mapper.valueToTree(keymaster.loadWallet());
        assertEquals(schema, keymaster.createTemplate("schema-alias").get("$schema"));
        assertEquals("TBD", keymaster.createTemplate("schema-alias").get("email"));
        Map<String, String> names = keymaster.listNames(true);
        assertEquals(alice, names.get("Alice"));
        names.clear();
        assertEquals(before, mapper.valueToTree(keymaster.loadWallet()));
    }

    static Stream<Arguments> indexedAssetData() {
        Map<String, Object> arrayProperties = new LinkedHashMap<>();
        arrayProperties.put("0", "first");
        arrayProperties.put("1", null);
        arrayProperties.put("2", Map.of("nested", true));
        return Stream.of(
            Arguments.of(java.util.Arrays.asList("first", null, Map.of("nested", true)), arrayProperties),
            Arguments.of("A\uD83E\uDDEA", Map.of("0", "A", "1", "\uD83E", "2", "\uDDEA")),
            Arguments.of(List.of(), Map.of()),
            Arguments.of(42, Map.of()),
            Arguments.of(true, Map.of())
        );
    }

    @ParameterizedTest
    @MethodSource("indexedAssetData")
    void clonesAndUpdatesPreserveIndexedAssetContents(Object source, Map<String, Object> properties) {
        JsonNode before = mapper.valueToTree(source);
        String did = keymaster.createAsset(source);
        String clone = keymaster.cloneAsset(did, "local", null);
        Map<String, Object> expectedClone = new LinkedHashMap<>(properties);
        expectedClone.put("cloned", did);
        assertEquals(expectedClone, keymaster.resolveAsset(clone));
        assertEquals(before, mapper.valueToTree(keymaster.resolveAsset(did)));

        Map<String, Object> expectedUpdate = new LinkedHashMap<>(properties);
        expectedUpdate.put("label", "kept");
        assertTrue(keymaster.updateAsset(did, Map.of("label", "kept")));
        assertEquals(expectedUpdate, keymaster.resolveAsset(did));
        assertEquals(before, mapper.valueToTree(source));
    }

    @ParameterizedTest
    @ValueSource(strings = {"test", "list", "template"})
    void schemaPredicatesRetainTheirFailureBehaviorWhenResolutionFails(String caller) {
        String schema = keymaster.createSchema(TestFixtures.mockSchema());
        node.beforeResolve = did -> {
            if (schema.equals(did)) throw new IllegalStateException("ECONNREFUSED");
        };
        if (caller.equals("test")) assertFalse(keymaster.testSchema(schema));
        else if (caller.equals("list")) assertEquals(List.of(), keymaster.listSchemas());
        else {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> keymaster.createTemplate(schema));
            assertEquals("Invalid parameter: schemaId", error.getMessage());
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void groupChangesKeepNestedMetadataAndTheOriginalLegacyShape(boolean legacy) {
        Map<String, Object> group = new LinkedHashMap<>(Map.of("name", "team", "members", List.of(), "extra", Map.of("kept", true)));
        Map<String, Object> data = legacy ? group : new LinkedHashMap<>(Map.of("group", group, "note", "keep"));
        String did = keymaster.createAsset(data);
        keymaster.addName("team", did);
        assertTrue(keymaster.addGroupMember("team", "Bob"));
        group.put("members", List.of(bob));
        assertEquals(data, keymaster.resolveAsset(did));
        int updates = node.updates;
        assertTrue(keymaster.addGroupMember(did, bob));
        assertEquals(updates, node.updates);
        assertTrue(keymaster.removeGroupMember(did, bob));
        group.put("members", List.of());
        assertEquals(data, keymaster.resolveAsset(did));
        updates = node.updates;
        assertTrue(keymaster.removeGroupMember(did, bob));
        assertEquals(updates, node.updates);
    }

    @ParameterizedTest
    @CsvSource({"false,false", "false,true", "true,false", "true,true"})
    void groupEditsSupportImmutableResolvedData(boolean legacy, boolean remove) {
        Map<String, Object> group = Map.of("name", "team", "members", remove ? List.of(bob) : List.of(), "note", "keep");
        String did = keymaster.createAsset(legacy ? group : Map.of("group", group, "other", "keep"));
        Keymaster readonly = new Keymaster(store, node.client, "passphrase", "local") {
            @Override
            public org.keychain.gatekeeper.model.MdipDocument resolveDID(String id, ResolveDIDOptions options) {
                var doc = super.resolveDID(id, options);
                if (did.equals(id)) {
                    Map<String, Object> data = (Map<String, Object>) doc.didDocumentData;
                    if (legacy) doc.didDocumentData = Map.copyOf(data);
                    else {
                        Map<String, Object> copy = new LinkedHashMap<>(data);
                        copy.put("group", Map.copyOf((Map<String, Object>) data.get("group")));
                        doc.didDocumentData = Map.copyOf(copy);
                    }
                }
                return doc;
            }
        };
        assertTrue(remove ? readonly.removeGroupMember(did, bob) : readonly.addGroupMember(did, bob));
        Map<String, Object> expected = new LinkedHashMap<>(group);
        expected.put("members", remove ? List.of() : List.of(bob));
        assertEquals(legacy ? expected : Map.of("group", expected, "other", "keep"), keymaster.resolveAsset(did));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void rejectedGroupChangesThrowWithoutRetryingOrChangingStoredMembers(boolean remove) {
        String group = keymaster.createGroup("team");
        if (remove) assertTrue(keymaster.addGroupMember(group, bob));
        List<String> before = new ArrayList<>(keymaster.getGroup(group).members);
        int attempts = node.submitted.size();
        node.rejectUpdate = true;
        IllegalStateException error = assertThrows(IllegalStateException.class, () -> {
            if (remove) keymaster.removeGroupMember(group, bob);
            else keymaster.addGroupMember(group, bob);
        });
        assertTrue(error.getMessage().contains("Please try again"));
        assertEquals(attempts + 1, node.submitted.size());
        assertEquals(before, keymaster.getGroup(group).members);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void concurrentEditsRejectOneAndAllowAnExplicitRetry(boolean remove) throws Exception {
        String group = keymaster.createGroup("team");
        if (remove) assertTrue(keymaster.addGroupMember(group, bob));
        CountDownLatch snapshots = new CountDownLatch(2);
        AtomicInteger reads = new AtomicInteger();
        node.afterResolve = did -> {
            if (did.equals(group) && reads.incrementAndGet() <= 2) {
                snapshots.countDown();
                try {
                    assertTrue(snapshots.await(5, TimeUnit.SECONDS), "Both group reads must finish");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError(e);
                }
            }
        };
        var executor = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> first = executor.submit(() -> keymaster.addGroupMember(group, alice));
            Future<Boolean> second = executor.submit(() -> remove ? keymaster.removeGroupMember(group, bob) : keymaster.addGroupMember(group, bob));
            int successes = 0;
            for (Future<Boolean> result : List.of(first, second)) {
                try {
                    assertTrue(result.get(10, TimeUnit.SECONDS));
                    successes++;
                } catch (ExecutionException error) {
                    assertTrue(error.getCause() instanceof IllegalStateException, String.valueOf(error.getCause()));
                    assertTrue(error.getCause().getMessage().contains("Please try again"));
                }
            }
            assertEquals(1, successes);
            assertTrue(keymaster.addGroupMember(group, alice));
            if (remove) assertTrue(keymaster.removeGroupMember(group, bob));
            else assertTrue(keymaster.addGroupMember(group, bob));
            assertEquals(remove ? Set.of(alice) : Set.of(alice, bob), Set.copyOf(keymaster.getGroup(group).members));
        } finally {
            snapshots.countDown();
            snapshots.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    @Test
    void groupTraversalTerminatesCyclesAndStillFindsLaterBranches() {
        String root = keymaster.createGroup("root");
        String cyclic = keymaster.createAsset(Map.of("name", "legacy", "members", List.of(root)));
        String leaf = keymaster.createGroup("leaf");
        assertTrue(keymaster.updateAsset(root, Map.of("group", Map.of("name", "root", "members", List.of(cyclic, leaf)))));
        assertTrue(keymaster.addGroupMember(leaf, bob));
        AtomicInteger reads = new AtomicInteger();
        node.beforeResolve = did -> assertTrue(reads.incrementAndGet() < 20, "Traversal repeated a cycle");
        assertFalse(keymaster.testGroup(root, alice));
        reads.set(0);
        assertTrue(keymaster.testGroup(root, bob));
        reads.set(0);
        keymaster.addName("root-alias", root);
        assertTrue(keymaster.testGroup("root-alias", "Bob"));
        node.beforeResolve = did -> {};
        assertThrows(IllegalArgumentException.class, () -> keymaster.addGroupMember(leaf, root));
    }

    @Test
    void diamondTraversalVisitsSharedDescendantsOnceAndDoesNotLeakAcrossCalls() {
        String leaf = keymaster.createGroup("leaf");
        String left = keymaster.createGroup("left");
        String right = keymaster.createGroup("right");
        String root = keymaster.createGroup("root");
        assertTrue(keymaster.addGroupMember(left, leaf));
        assertTrue(keymaster.addGroupMember(right, leaf));
        assertTrue(keymaster.addGroupMember(root, left));
        assertTrue(keymaster.addGroupMember(root, right));
        AtomicInteger reads = new AtomicInteger();
        node.beforeResolve = did -> { if (did.equals(leaf)) reads.incrementAndGet(); };
        assertFalse(keymaster.testGroup(root, bob));
        assertEquals(1, reads.get());
        node.beforeResolve = did -> {};
        assertTrue(keymaster.addGroupMember(leaf, bob));
        assertTrue(keymaster.testGroup(root, bob));
        assertTrue(keymaster.testGroup(root, left));
        assertTrue(keymaster.testGroup(root));
        assertFalse(keymaster.testGroup("missing", bob));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void deepGroupTraversalDoesNotUseTheJavaCallStack(boolean present) {
        var template = node.doc(keymaster.createGroup("chain"));
        List<String> chain = new ArrayList<>();
        for (int index = 0; index < 5000; index++) {
            byte[] hash = new byte[34];
            hash[0] = 0x12;
            hash[1] = 0x20;
            java.nio.ByteBuffer.wrap(hash, 30, 4).putInt(index + 1000);
            chain.add("did:test:" + org.bitcoinj.core.Base58.encode(hash));
        }
        for (int index = 0; index < chain.size(); index++) {
            var doc = mapper.convertValue(template, org.keychain.gatekeeper.model.MdipDocument.class);
            doc.didDocument.id = chain.get(index);
            List<String> members = index + 1 < chain.size() ? List.of(chain.get(index + 1))
                : present ? List.of(bob) : List.of(chain.get(0));
            doc.didDocumentData = Map.of("group", Map.of("name", "chain", "members", members));
            node.docs.put(suffix(chain.get(index)), doc);
        }
        int reads = node.resolvedDids.size();
        assertEquals(present, keymaster.testGroup(chain.get(0), "Bob"));
        assertEquals(reads + 5000, node.resolvedDids.size());
    }

    @Test
    void unavailableGroupBranchesDoNotHideALaterMatch() {
        String leaf = keymaster.createGroup("leaf");
        assertTrue(keymaster.addGroupMember(leaf, bob));
        String root = keymaster.createAsset(Map.of("group", Map.of("name", "root", "members",
            java.util.Arrays.asList(null, "Missing", alice, leaf))));
        node.beforeResolve = did -> {
            if (did.equals(alice)) throw new IllegalStateException("Unavailable member");
        };
        assertTrue(keymaster.testGroup(root, "Bob"));
        assertFalse(keymaster.testGroup(null, "Bob"));
    }

    @ParameterizedTest
    @MethodSource("cleanupFailures")
    void failedCleanupPreservesTheEntireWalletAndStorage(String entry, String failure) {
        String owned = keymaster.createAsset(Map.of("owned", true));
        String held = keymaster.createAsset(Map.of("held", true));
        String alias = keymaster.createAsset(Map.of("alias", true));
        keymaster.mutateWallet(wallet -> {
            wallet.ids.get("Bob").did = "did:test:invalid";
            var ordered = new LinkedHashMap<String, org.keychain.keymaster.model.IDInfo>();
            ordered.put("Bob", wallet.ids.get("Bob"));
            ordered.put("Alice", wallet.ids.get("Alice"));
            wallet.ids = ordered;
            wallet.ids.get("Alice").owned = new ArrayList<>(List.of("invalid", owned));
            wallet.ids.get("Alice").held = new ArrayList<>(List.of("invalid", held));
            wallet.names = new LinkedHashMap<>(Map.of("alias", alias, "invalid", "invalid"));
        });
        String target = Map.of("identity", alice, "owned", owned, "held", held, "alias", alias).get(entry);
        if (failure.equals("not-found")) node.docs.remove(suffix(target));
        else if (failure.equals("resolution-error")) {
            node.doc(target).didResolutionMetadata = new org.keychain.gatekeeper.model.MdipDocument.DidResolutionMetadata();
            node.doc(target).didResolutionMetadata.error = "temporarilyUnavailable";
        } else node.beforeResolve = did -> { if (did.equals(target)) throw new IllegalStateException("ECONNREFUSED"); };
        var active = keymaster.loadWallet();
        JsonNode original = mapper.valueToTree(active);
        JsonNode stored = mapper.valueToTree(store.loadWallet());
        assertThrows(RuntimeException.class, keymaster::fixWallet);
        assertSame(active, keymaster.loadWallet());
        assertEquals(original, mapper.valueToTree(active));
        assertEquals(stored, mapper.valueToTree(store.loadWallet()));
        Keymaster restarted = new Keymaster(store, node.client, "passphrase", "local");
        assertEquals(original, mapper.valueToTree(restarted.loadWallet()));
        node.beforeResolve = did -> {};
        keymaster.addName("later", alias);
        assertEquals("did:test:invalid", keymaster.loadWallet().ids.get("Bob").did);
        assertEquals(alias, keymaster.lookupDID("later"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Alice", "Bob", "both", "malformed"})
    void cleanupRepairsTheCurrentIdentityAndSurvivesRestart(String remove) {
        keymaster.setCurrentId("Alice");
        if (remove.equals("Alice") || remove.equals("both")) node.doc(alice).didDocumentMetadata.deactivated = true;
        if (remove.equals("Bob") || remove.equals("both")) node.doc(bob).didDocumentMetadata.deactivated = true;
        if (remove.equals("malformed")) keymaster.mutateWallet(wallet -> wallet.ids.get("Alice").did = "invalid");
        var result = keymaster.fixWallet();
        assertEquals(remove.equals("both") ? 2 : 1, result.idsRemoved);
        String current = remove.equals("both") ? "" : remove.equals("Bob") ? "Alice" : "Bob";
        assertEquals(current, keymaster.loadWallet().current);
        Keymaster restarted = new Keymaster(store, node.client, "passphrase", "local");
        assertEquals(current, restarted.loadWallet().current);
        if (!current.isEmpty()) assertNotNull(restarted.fetchKeyPair(null));
    }

    @Test
    void cleanupCountsOnlyMalformedAndConclusiveDeactivatedReferences() {
        String revoked = keymaster.createAsset(Map.of("revoked", true));
        String valid = keymaster.createAsset(Map.of("valid", true));
        node.doc(revoked).didDocumentMetadata.deactivated = true;
        keymaster.mutateWallet(wallet -> {
            wallet.ids.get("Alice").owned = new ArrayList<>(List.of("invalid", revoked, valid));
            wallet.ids.get("Alice").held = new ArrayList<>(List.of("invalid", revoked, valid));
            wallet.names = new LinkedHashMap<>(Map.of("invalid", "invalid", "revoked", revoked, "valid", valid));
        });
        var result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(2, result.ownedRemoved);
        assertEquals(2, result.heldRemoved);
        assertEquals(2, result.namesRemoved);
        assertEquals(List.of(valid), keymaster.loadWallet().ids.get("Alice").owned);
        assertEquals(List.of(valid), keymaster.listCredentials("Alice"));
        assertEquals(Map.of("valid", valid), keymaster.listNames(false));
    }

    private static Stream<Arguments> cleanupFailures() {
        return Stream.of("identity", "owned", "held", "alias").flatMap(entry ->
            Stream.of("connection", "timeout", "http-error", "not-found", "resolution-error")
                .map(failure -> Arguments.of(entry, failure)));
    }

    private static String suffix(String did) {
        return did.substring(did.lastIndexOf(':') + 1);
    }
}
