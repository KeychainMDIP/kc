package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestFixtures;

class WalletVectorsTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void loadsReferenceWalletAndRestoresItsEncryptedExport() throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        WalletJsonMemory<WalletEncFile> store = vectorStore(vector);
        String passphrase = vector.get("passphrase").asText();
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), passphrase);
        WalletFile expected = mapper.treeToValue(vector.get("wallet"), WalletFile.class);
        expected.version = vector.get("version").asInt();
        expected.seed = mapper.treeToValue(vector.get("seed"), Seed.class);

        WalletFile wallet = keymaster.loadWallet();

        assertEquals(mapper.valueToTree(expected), mapper.valueToTree(wallet));
        assertEquals(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            keymaster.decryptMnemonic()
        );
        WalletEncFile exported = keymaster.exportEncryptedWallet();
        assertEquals(1, exported.version);
        assertNotNull(exported.enc);
        assertTrue(exported.extra.isEmpty());
        assertEquals(vector.get("seed").get("mnemonicEnc"), mapper.valueToTree(exported.seed.mnemonicEnc));

        WalletJsonMemory<WalletEncFile> restoredStore = new WalletJsonMemory<>(WalletEncFile.class);
        assertTrue(restoredStore.saveWallet(exported, false));
        Keymaster restored = new Keymaster(restoredStore, TestFixtures.offlineGatekeeper(), passphrase);
        assertEquals(mapper.valueToTree(expected), mapper.valueToTree(restored.loadWallet()));
    }

    @Test
    void wrongPassphraseDoesNotReplaceReferenceWallet() throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        WalletJsonMemory<WalletEncFile> store = vectorStore(vector);
        JsonNode before = mapper.valueToTree(store.loadWallet());
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), "wrong passphrase");

        assertThrows(IllegalStateException.class, keymaster::loadWallet);

        assertEquals(before, mapper.valueToTree(store.loadWallet()));
    }

    private WalletJsonMemory<WalletEncFile> vectorStore(JsonNode vector) throws Exception {
        WalletEncFile stored = new WalletEncFile();
        stored.version = vector.get("version").asInt();
        stored.seed = mapper.treeToValue(vector.get("seed"), Seed.class);
        stored.enc = vector.get("enc").asText();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        assertTrue(store.saveWallet(stored, false));
        return store;
    }
}
