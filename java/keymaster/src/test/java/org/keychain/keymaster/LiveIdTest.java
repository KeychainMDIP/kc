package org.keychain.keymaster;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.testutil.LiveTestSupport;

@Tag("live")
class LiveIdTest {
    @TempDir
    Path tempDir;

    protected Keymaster liveKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    protected GatekeeperInterface gatekeeperClient() {
        return LiveTestSupport.gatekeeperClient();
    }

    protected String testRegistry() {
        return LiveTestSupport.DEFAULT_REGISTRY;
    }

    @Test
    @Tag("live")
    void createIdDefaultRegistry() {
        Keymaster keymaster = liveKeymaster();
        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(did);

        org.junit.jupiter.api.Assertions.assertEquals(LiveTestSupport.DEFAULT_REGISTRY, doc.mdip.registry);
    }

    @Test
    @Tag("live")
    void createIdCustomDefaultRegistry() {
        String customRegistry = testRegistry();
        Keymaster keymaster = LiveTestSupport.keymaster(tempDir, customRegistry);

        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(did);

        org.junit.jupiter.api.Assertions.assertEquals(customRegistry, doc.mdip.registry);
    }

    @Test
    @Tag("live")
    void createIdStoresWalletEntry() {
        Keymaster keymaster = liveKeymaster();

        String did = keymaster.createId("Bob");
        WalletFile wallet = keymaster.loadWallet();

        org.junit.jupiter.api.Assertions.assertEquals(did, wallet.ids.get("Bob").did);
        org.junit.jupiter.api.Assertions.assertEquals("Bob", wallet.current);
    }

    @Test
    @Tag("live")
    void createIdUnicodeName() {
        Keymaster keymaster = liveKeymaster();

        String name = "ҽ× ʍɑϲհíղɑ";
        String did = keymaster.createId(name);
        WalletFile wallet = keymaster.loadWallet();

        org.junit.jupiter.api.Assertions.assertEquals(did, wallet.ids.get(name).did);
        org.junit.jupiter.api.Assertions.assertEquals(name, wallet.current);
    }

    @Test
    @Tag("live")
    void createIdOperationMatchesRegistry() {
        Keymaster keymaster = liveKeymaster();
        String customRegistry = testRegistry();
        Operation op = keymaster.createIdOperation("Alice", 0, customRegistry);

        org.junit.jupiter.api.Assertions.assertEquals(customRegistry, op.mdip.registry);
        org.junit.jupiter.api.Assertions.assertEquals("create", op.type);
        org.junit.jupiter.api.Assertions.assertNotNull(op.publicJwk);
        org.junit.jupiter.api.Assertions.assertNotNull(op.signature);
    }

    @Test
    @Tag("live")
    void createIdOperationDefaultRegistry() {
        Keymaster keymaster = liveKeymaster();

        Operation op = keymaster.createIdOperation("Bob");

        org.junit.jupiter.api.Assertions.assertEquals("create", op.type);
        org.junit.jupiter.api.Assertions.assertEquals(LiveTestSupport.DEFAULT_REGISTRY, op.mdip.registry);
        org.junit.jupiter.api.Assertions.assertNotNull(op.publicJwk);
        org.junit.jupiter.api.Assertions.assertNotNull(op.signature);
    }

    @Test
    @Tag("live")
    void createIdOperationSignatureValid() {
        Keymaster keymaster = liveKeymaster();
        Operation op = keymaster.createIdOperation("Frank");

        java.util.Map<String, Object> unsigned = new java.util.LinkedHashMap<>();
        unsigned.put("type", op.type);
        unsigned.put("created", op.created);
        unsigned.put("mdip", op.mdip);
        unsigned.put("publicJwk", op.publicJwk);

        String msgHash = new KeymasterCryptoImpl().hashJson(unsigned);
        org.junit.jupiter.api.Assertions.assertEquals(msgHash, op.signature.hash);

        org.keychain.crypto.JwkPublic pub = new org.keychain.crypto.JwkPublic(
            op.publicJwk.kty,
            op.publicJwk.crv,
            op.publicJwk.x,
            op.publicJwk.y
        );
        boolean isValid = new KeymasterCryptoImpl().verifySig(msgHash, op.signature.value, pub);
        org.junit.jupiter.api.Assertions.assertTrue(isValid);
    }

    @Test
    @Tag("live")
    void createIdOperationDoesNotMutateWallet() {
        Keymaster keymaster = liveKeymaster();

        WalletFile before = keymaster.loadWallet();
        int counterBefore = before.counter;

        keymaster.createIdOperation("Dave");

        WalletFile after = keymaster.loadWallet();
        org.junit.jupiter.api.Assertions.assertEquals(counterBefore, after.counter);
        org.junit.jupiter.api.Assertions.assertFalse(after.ids.containsKey("Dave"));
        org.junit.jupiter.api.Assertions.assertEquals(before.current, after.current);
    }

    @Test
    @Tag("live")
    void createIdOperationCreatesResolvableDid() {
        Keymaster keymaster = liveKeymaster();

        Operation op = keymaster.createIdOperation("Grace");
        String did = gatekeeperClient().createDID(op);

        MdipDocument doc = keymaster.resolveDID(did);
        org.junit.jupiter.api.Assertions.assertEquals(did, doc.didDocument.id);
        org.junit.jupiter.api.Assertions.assertEquals("agent", doc.mdip.type);
    }

    @Test
    @Tag("live")
    void removeAndRenameId() {
        Keymaster keymaster = liveKeymaster();
        String did = keymaster.createId("Bob");
        boolean renamed = keymaster.renameId("Bob", "Alice");
        org.junit.jupiter.api.Assertions.assertTrue(renamed);

        org.junit.jupiter.api.Assertions.assertEquals("Alice", keymaster.loadWallet().current);
        org.junit.jupiter.api.Assertions.assertEquals(did, keymaster.loadWallet().ids.get("Alice").did);

        boolean removed = keymaster.removeId("Alice");
        org.junit.jupiter.api.Assertions.assertTrue(removed);

        org.junit.jupiter.api.Assertions.assertTrue(keymaster.loadWallet().ids.isEmpty());
        org.junit.jupiter.api.Assertions.assertEquals("", keymaster.loadWallet().current);
        org.junit.jupiter.api.Assertions.assertEquals(did, keymaster.resolveDID(did).didDocument.id);
    }

    @Test
    @Tag("live")
    void setGetCurrentIdAndListIds() {
        Keymaster keymaster = liveKeymaster();
        keymaster.createId("Alice");
        keymaster.createId("Bob");
        keymaster.createId("Carol");
        keymaster.createId("Victor");

        keymaster.setCurrentId("Carol");
        String current = keymaster.getCurrentId();
        org.junit.jupiter.api.Assertions.assertEquals("Carol", current);

        List<String> ids = keymaster.listIds();
        org.junit.jupiter.api.Assertions.assertEquals(4, ids.size());
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Alice"));
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Bob"));
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Carol"));
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Victor"));
    }

    @Test
    @Tag("live")
    void backupAndRecoverId() {
        Keymaster keymaster = liveKeymaster();
        String did = keymaster.createId("Bob");
        boolean ok = keymaster.backupId();
        org.junit.jupiter.api.Assertions.assertTrue(ok);

        String mnemonic = keymaster.decryptMnemonic();
        keymaster.newWallet(mnemonic, true);
        org.junit.jupiter.api.Assertions.assertTrue(keymaster.loadWallet().ids.isEmpty());

        String name = keymaster.recoverId(did);
        org.junit.jupiter.api.Assertions.assertEquals("Bob", name);
        org.junit.jupiter.api.Assertions.assertTrue(keymaster.loadWallet().ids.containsKey("Bob"));
    }

    @Test
    @Tag("live")
    void testAgent() {
        Keymaster keymaster = liveKeymaster();
        String did = keymaster.createId("Bob");
        boolean isAgent = keymaster.testAgent(did);
        org.junit.jupiter.api.Assertions.assertTrue(isAgent);
    }

    @Test
    @Tag("live")
    void testAgentOnAsset() {
        Keymaster keymaster = liveKeymaster();

        keymaster.createId("Bob");
        String assetDid = keymaster.createAsset(Map.of("name", "mockAnchor"), LiveTestSupport.DEFAULT_REGISTRY);
        org.junit.jupiter.api.Assertions.assertFalse(keymaster.testAgent(assetDid));
    }
}
