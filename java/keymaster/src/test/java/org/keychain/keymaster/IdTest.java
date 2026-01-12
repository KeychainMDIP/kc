package org.keychain.keymaster;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.JwkPublic;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.GatekeeperStub;

class IdTest {
    private static final String REGISTRY = "hyperswarm";

    private Keymaster newKeymaster(GatekeeperStub gatekeeper) {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        return new Keymaster(store, gatekeeper, "passphrase");
    }

    @Test
    void createIdStoresWalletEntry() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        String did = keymaster.createId("Bob");
        WalletFile wallet = keymaster.loadWallet();

        org.junit.jupiter.api.Assertions.assertEquals(did, wallet.ids.get("Bob").did);
        org.junit.jupiter.api.Assertions.assertEquals("Bob", wallet.current);
    }

    @Test
    void createIdUnicodeName() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        String name = "unicode-name";
        String did = keymaster.createId(name);
        WalletFile wallet = keymaster.loadWallet();

        org.junit.jupiter.api.Assertions.assertEquals(did, wallet.ids.get(name).did);
        org.junit.jupiter.api.Assertions.assertEquals(name, wallet.current);
    }

    @Test
    void createIdDefaultRegistry() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(did);

        org.junit.jupiter.api.Assertions.assertEquals("hyperswarm", doc.mdip.registry);
    }

    @Test
    void createIdCustomDefaultRegistry() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase", "local");

        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(did);

        org.junit.jupiter.api.Assertions.assertEquals("local", doc.mdip.registry);
    }

    @Test
    void createIdOperationDefaultRegistry() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        Operation op = keymaster.createIdOperation("Bob");

        org.junit.jupiter.api.Assertions.assertEquals("create", op.type);
        org.junit.jupiter.api.Assertions.assertEquals("hyperswarm", op.mdip.registry);
        org.junit.jupiter.api.Assertions.assertNotNull(op.publicJwk);
        org.junit.jupiter.api.Assertions.assertNotNull(op.signature);
    }

    @Test
    void createIdOperationCustomRegistry() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        Operation op = keymaster.createIdOperation("Alice", 0, "local");

        org.junit.jupiter.api.Assertions.assertEquals("local", op.mdip.registry);
        org.junit.jupiter.api.Assertions.assertNotNull(op.signature);
    }

    @Test
    void createIdOperationDoesNotMutateWallet() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        WalletFile before = keymaster.loadWallet();
        int counterBefore = before.counter;

        keymaster.createIdOperation("Dave");

        WalletFile after = keymaster.loadWallet();
        org.junit.jupiter.api.Assertions.assertEquals(counterBefore, after.counter);
        org.junit.jupiter.api.Assertions.assertFalse(after.ids.containsKey("Dave"));
        org.junit.jupiter.api.Assertions.assertEquals(before.current, after.current);
    }

    @Test
    void createIdOperationSignatureValid() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        Operation op = keymaster.createIdOperation("Frank");

        java.util.Map<String, Object> unsigned = new java.util.LinkedHashMap<>();
        unsigned.put("type", op.type);
        unsigned.put("created", op.created);
        unsigned.put("mdip", op.mdip);
        unsigned.put("publicJwk", op.publicJwk);

        String msgHash = new KeymasterCryptoImpl().hashJson(unsigned);
        org.junit.jupiter.api.Assertions.assertEquals(msgHash, op.signature.hash);

        JwkPublic publicJwk = new JwkPublic(
            op.publicJwk.kty,
            op.publicJwk.crv,
            op.publicJwk.x,
            op.publicJwk.y
        );
        boolean isValid = new KeymasterCryptoImpl().verifySig(msgHash, op.signature.value, publicJwk);
        org.junit.jupiter.api.Assertions.assertTrue(isValid);
    }

    @Test
    void createIdOperationCreatesResolvableDid() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        Operation op = keymaster.createIdOperation("Grace");
        String did = gatekeeper.createDID(op);

        MdipDocument doc = keymaster.resolveDID(did);
        org.junit.jupiter.api.Assertions.assertEquals(did, doc.didDocument.id);
        org.junit.jupiter.api.Assertions.assertEquals("agent", doc.mdip.type);
    }

    @Test
    void removeIdDeletesWalletEntry() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        keymaster.createId("Bob");
        keymaster.removeId("Bob");

        WalletFile wallet = keymaster.loadWallet();
        org.junit.jupiter.api.Assertions.assertTrue(wallet.ids.isEmpty());
        org.junit.jupiter.api.Assertions.assertEquals("", wallet.current);
    }

    @Test
    void renameIdUpdatesCurrent() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        String did = keymaster.createId("Bob");
        boolean ok = keymaster.renameId("Bob", "Alice");

        WalletFile wallet = keymaster.loadWallet();
        org.junit.jupiter.api.Assertions.assertTrue(ok);
        org.junit.jupiter.api.Assertions.assertEquals(did, wallet.ids.get("Alice").did);
        org.junit.jupiter.api.Assertions.assertEquals("Alice", wallet.current);
    }

    @Test
    void setCurrentIdSwitches() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        keymaster.createId("Bob");
        keymaster.createId("Alice");
        keymaster.setCurrentId("Bob");

        WalletFile wallet = keymaster.loadWallet();
        org.junit.jupiter.api.Assertions.assertEquals("Bob", wallet.current);
    }

    @Test
    void listIdsAndGetCurrentId() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        keymaster.createId("Alice");
        keymaster.createId("Bob");
        keymaster.createId("Carol");
        keymaster.createId("Victor");

        List<String> ids = keymaster.listIds();
        org.junit.jupiter.api.Assertions.assertEquals(4, ids.size());
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Alice"));
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Bob"));
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Carol"));
        org.junit.jupiter.api.Assertions.assertTrue(ids.contains("Victor"));

        org.junit.jupiter.api.Assertions.assertEquals("Victor", keymaster.getCurrentId());
    }

    @Test
    void backupAndRecoverId() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        String did = keymaster.createId("Bob");
        boolean ok = keymaster.backupId();
        org.junit.jupiter.api.Assertions.assertTrue(ok);

        String mnemonic = keymaster.decryptMnemonic();
        keymaster.newWallet(mnemonic, true);
        org.junit.jupiter.api.Assertions.assertTrue(keymaster.loadWallet().ids.isEmpty());

        String name = keymaster.recoverId(did);
        WalletFile wallet = keymaster.loadWallet();
        org.junit.jupiter.api.Assertions.assertEquals("Bob", name);
        org.junit.jupiter.api.Assertions.assertTrue(wallet.ids.containsKey("Bob"));
        org.junit.jupiter.api.Assertions.assertEquals("Bob", wallet.current);
    }

    @Test
    void testAgentOnAsset() {
        GatekeeperStub gatekeeper = new GatekeeperStub();
        Keymaster keymaster = newKeymaster(gatekeeper);

        keymaster.createId("Bob");
        String assetDid = keymaster.createAsset(Map.of("name", "mockAnchor"), REGISTRY);
        org.junit.jupiter.api.Assertions.assertFalse(keymaster.testAgent(assetDid));
    }
}
