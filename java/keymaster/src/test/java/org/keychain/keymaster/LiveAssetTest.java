package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.testutil.LiveTestSupport;

@Tag("live")
class LiveAssetTest {
    @TempDir
    private Path tempDir;

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    @Test
    void createAssetFromObjectAnchor() {
        Keymaster keymaster = newKeymaster();
        String ownerDid = keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertEquals(dataDid, doc.didDocument.id);
        assertEquals(ownerDid, doc.didDocument.controller);
        assertEquals(mockAnchor, doc.didDocumentData);
    }

    @Test
    void createAssetFromStringAnchor() {
        Keymaster keymaster = newKeymaster();
        String ownerDid = keymaster.createId("Bob");
        String mockAnchor = "mockAnchor";
        String dataDid = keymaster.createAsset(mockAnchor);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertEquals(dataDid, doc.didDocument.id);
        assertEquals(ownerDid, doc.didDocument.controller);
        assertEquals(mockAnchor, doc.didDocumentData);
    }

    @Test
    void createAssetFromListAnchor() {
        Keymaster keymaster = newKeymaster();
        String ownerDid = keymaster.createId("Bob");
        List<Integer> mockAnchor = List.of(1, 2, 3);
        String dataDid = keymaster.createAsset(mockAnchor);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertEquals(dataDid, doc.didDocument.id);
        assertEquals(ownerDid, doc.didDocument.controller);
        assertEquals(mockAnchor, doc.didDocumentData);
    }

    @Test
    void createAssetForDifferentValidId() {
        Keymaster keymaster = newKeymaster();
        String ownerDid = keymaster.createId("Bob");
        String mockAnchor = "mockAnchor";

        keymaster.createId("Alice");

        CreateAssetOptions options = new CreateAssetOptions();
        options.registry = LiveTestSupport.DEFAULT_REGISTRY;
        options.controller = "Bob";
        String dataDid = keymaster.createAsset(mockAnchor, options);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertEquals(dataDid, doc.didDocument.id);
        assertEquals(ownerDid, doc.didDocument.controller);
        assertEquals(mockAnchor, doc.didDocumentData);
    }

    @Test
    void createAssetWithSpecifiedName() {
        Keymaster keymaster = newKeymaster();
        String ownerDid = keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String mockName = "mockName";

        CreateAssetOptions options = new CreateAssetOptions();
        options.name = mockName;
        String dataDid = keymaster.createAsset(mockAnchor, options);
        MdipDocument doc = keymaster.resolveDID(mockName);

        assertEquals(dataDid, doc.didDocument.id);
        assertEquals(ownerDid, doc.didDocument.controller);
        assertEquals(mockAnchor, doc.didDocumentData);
    }

    @Test
    void createAssetThrowsWhenNoCurrentId() {
        Keymaster keymaster = newKeymaster();
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");

        IllegalStateException error = assertThrows(IllegalStateException.class, () ->
            keymaster.createAsset(mockAnchor)
        );
        assertEquals("Keymaster: No current ID", error.getMessage());
    }

    @Test
    void createAssetThrowsWhenNameAlreadyUsed() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        CreateAssetOptions options = new CreateAssetOptions();
        options.name = "Bob";
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.createAsset(Map.of(), options)
        );
        assertEquals("Invalid parameter: name already used", error.getMessage());
    }

    @Test
    void createAssetThrowsOnInvalidData() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.createAsset(null)
        );
        assertEquals("data is required", error.getMessage());
    }

    @Test
    void cloneAssetDid() {
        Keymaster keymaster = newKeymaster();
        String ownerDid = keymaster.createId("Bob");
        Map<String, Object> mockData = Map.of("name", "mockData");
        String assetDid = keymaster.createAsset(mockData);
        String cloneDid = keymaster.cloneAsset(assetDid);
        MdipDocument doc = keymaster.resolveDID(cloneDid);

        assertNotEquals(assetDid, cloneDid);
        assertEquals(ownerDid, doc.didDocument.controller);

        Map<String, Object> expectedData = Map.of("name", "mockData", "cloned", assetDid);
        assertEquals(expectedData, doc.didDocumentData);
    }

    @Test
    void cloneAssetName() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockData = Map.of("name", "mockData");
        String assetDid = keymaster.createAsset(mockData);
        keymaster.addName("asset", assetDid);
        String cloneDid = keymaster.cloneAsset("asset");
        MdipDocument doc = keymaster.resolveDID(cloneDid);

        Map<String, Object> expectedData = Map.of("name", "mockData", "cloned", assetDid);
        assertEquals(expectedData, doc.didDocumentData);
    }

    @Test
    void cloneEmptyAsset() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String assetDid = keymaster.createAsset(Map.of());
        keymaster.addName("asset", assetDid);
        String cloneDid = keymaster.cloneAsset("asset");
        MdipDocument doc = keymaster.resolveDID(cloneDid);

        Map<String, Object> expectedData = Map.of("cloned", assetDid);
        assertEquals(expectedData, doc.didDocumentData);
    }

    @Test
    void cloneAClone() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockData = Map.of("name", "mockData");
        String assetDid = keymaster.createAsset(mockData);
        String cloneDid1 = keymaster.cloneAsset(assetDid);
        String cloneDid2 = keymaster.cloneAsset(cloneDid1);
        MdipDocument doc = keymaster.resolveDID(cloneDid2);

        Map<String, Object> expectedData = Map.of("name", "mockData", "cloned", cloneDid1);
        assertEquals(expectedData, doc.didDocumentData);
    }

    @Test
    void cloneAssetThrowsOnInvalidAsset() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.cloneAsset(bob)
        );
        assertEquals("id", error.getMessage());
    }

    @Test
    void transferAssetDidToAgentDid() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        assertTrue(keymaster.transferAsset(dataDid, alice));
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertEquals(alice, doc.didDocument.controller);

        List<String> assetsAlice = keymaster.listAssets("Alice");
        List<String> assetsBob = keymaster.listAssets("Bob");

        assertEquals(List.of(dataDid), assetsAlice);
        assertEquals(List.of(), assetsBob);
    }

    @Test
    void transferAssetNameToAgentName() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);
        keymaster.addName("asset", dataDid);

        assertTrue(keymaster.transferAsset("asset", "Alice"));
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertEquals(alice, doc.didDocument.controller);

        List<String> assetsAlice = keymaster.listAssets("Alice");
        List<String> assetsBob = keymaster.listAssets("Bob");

        assertEquals(List.of(dataDid), assetsAlice);
        assertEquals(List.of(), assetsBob);
    }

    @Test
    void transferAssetNoOpWhenControllerUnchanged() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        assertTrue(keymaster.transferAsset(dataDid, bob));
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertEquals(bob, doc.didDocument.controller);
        assertEquals("1", doc.didDocumentMetadata.version);
    }

    @Test
    void transferAssetThrowsOnInvalidDid() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.transferAsset("mockDID", bob)
        );
        assertEquals("unknown id", error.getMessage());
    }

    @Test
    void transferAssetThrowsWhenDidIsAgent() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.transferAsset(bob, bob)
        );
        assertEquals("asset did is not an asset", error.getMessage());
    }

    @Test
    void transferAssetThrowsOnInvalidController() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () ->
            keymaster.transferAsset(dataDid, dataDid)
        );
        assertEquals("controller did is not an agent", error.getMessage());
    }

    @Test
    void transferAssetThrowsWhenAssetNotOwned() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> {
            keymaster.removeId(bob);
            keymaster.transferAsset(dataDid, alice);
        });
        assertEquals("unknown id", error.getMessage());
    }

    @Test
    void listAssetsEmpty() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        List<String> assets = keymaster.listAssets();
        assertEquals(List.of(), assets);
    }

    @Test
    void listAssetsOwnedByCurrentId() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        List<String> assets = keymaster.listAssets();
        assertEquals(List.of(dataDid), assets);
    }

    @Test
    void listAssetsOwnedBySpecifiedId() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        keymaster.createId("Bob");
        List<String> assetsBob = keymaster.listAssets();
        List<String> assetsAlice = keymaster.listAssets("Alice");

        assertEquals(List.of(), assetsBob);
        assertEquals(List.of(dataDid), assetsAlice);
    }

    @Test
    void listAssetsExcludesEphemeralAssets() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String validUntil = java.time.Instant.now().plusSeconds(60).toString();

        CreateAssetOptions options = new CreateAssetOptions();
        options.validUntil = validUntil;
        keymaster.createAsset(mockAnchor, options);

        List<String> assets = keymaster.listAssets();
        assertEquals(List.of(), assets);
    }

    @Test
    void resolveAssetReturnsData() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAsset = Map.of("name", "mockAnchor");
        String did = keymaster.createAsset(mockAsset);

        Object asset = keymaster.resolveAsset(did);
        assertEquals(mockAsset, asset);
    }

    @Test
    void resolveAssetReturnsEmptyOnInvalidDid() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Bob");

        Object asset = keymaster.resolveAsset(agentDid);
        assertEquals(Map.of(), asset);
    }

    @Test
    void resolveAssetReturnsEmptyWhenRevoked() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAsset = Map.of("name", "mockAnchor");
        String did = keymaster.createAsset(mockAsset);
        keymaster.revokeDID(did);

        Object asset = keymaster.resolveAsset(did);
        assertEquals(Map.of(), asset);
    }

    @Test
    void updateAssetReplacesData() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAsset1 = Map.of("name", "original");
        Map<String, Object> mockAsset2 = Map.of("name", "updated");
        String did = keymaster.createAsset(mockAsset1);
        assertTrue(keymaster.updateAsset(did, mockAsset2));
        Object asset = keymaster.resolveAsset(did);

        assertEquals(mockAsset2, asset);
    }

    @Test
    void updateAssetMergesData() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAsset1 = Map.of("key1", "val1");
        Map<String, Object> mockAsset2 = Map.of("key2", "val2");
        String did = keymaster.createAsset(mockAsset1);
        assertTrue(keymaster.updateAsset(did, mockAsset2));
        Object asset = keymaster.resolveAsset(did);

        assertEquals(Map.of("key1", "val1", "key2", "val2"), asset);
    }

    @Test
    void updateAssetRemovesUndefinedProperty() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAsset1 = Map.of("key1", "val1", "key2", "val2");
        Map<String, Object> mockAsset2 = new java.util.HashMap<>();
        mockAsset2.put("key2", null);
        String did = keymaster.createAsset(mockAsset1);
        assertTrue(keymaster.updateAsset(did, mockAsset2));
        Object asset = keymaster.resolveAsset(did);

        assertEquals(Map.of("key1", "val1"), asset);
    }
}
