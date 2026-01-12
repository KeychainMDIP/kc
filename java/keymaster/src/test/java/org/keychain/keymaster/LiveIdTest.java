package org.keychain.keymaster;

import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.GatekeeperHttpClient;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMemory;

@Tag("live")
class LiveIdTest {
    private static final String REGISTRY = "hyperswarm";
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

    protected String testRegistry() {
        return "local";
    }

    @Test
    @Tag("live")
    void createIdDefaultRegistry() {
        Keymaster keymaster = liveKeymaster();
        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(did);

        org.junit.jupiter.api.Assertions.assertEquals(REGISTRY, doc.mdip.registry);
    }

    @Test
    @Tag("live")
    void createIdCustomDefaultRegistry() {
        GatekeeperClient gatekeeper = gatekeeperClient();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        String customRegistry = testRegistry();
        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase", customRegistry);

        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(did);

        org.junit.jupiter.api.Assertions.assertEquals(customRegistry, doc.mdip.registry);
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
    void removeAndRenameId() {
        Keymaster keymaster = liveKeymaster();
        String did = keymaster.createId("Bob");
        boolean renamed = keymaster.renameId("Bob", "Alice");
        org.junit.jupiter.api.Assertions.assertTrue(renamed);

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
}
