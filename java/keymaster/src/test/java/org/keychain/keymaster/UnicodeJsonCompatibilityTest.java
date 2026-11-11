package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestFixtures;
import org.keychain.keymaster.testutil.TestGatekeeper;

class UnicodeJsonCompatibilityTest {
    private static final String TEXT = "café 😀 " + (char) 0xd800;
    private final TestGatekeeper node = new TestGatekeeper();
    private final WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
    private final Keymaster keymaster = new Keymaster(store, node.client, "passphrase", "local");
    private String holder;

    @BeforeEach
    void initialize() {
        keymaster.newWallet("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", false);
        keymaster.createId("Issuer");
        holder = keymaster.createId("Holder");
        keymaster.setCurrentId("Issuer");
    }

    @Test
    void encryptedJsonPreservesLoneSurrogatesAndValidUnicode() {
        Map<String, Object> value = Map.of("text", TEXT, "key" + (char) 0xdfff, "value");
        String did = keymaster.encryptJSON(value, holder);
        keymaster.setCurrentId("Holder");
        assertEquals(value, keymaster.decryptJSON(did));
    }

    @Test
    void issuedCredentialsRetainTheirSignedClaimsThroughEncryption() {
        String schema = keymaster.createSchema(TestFixtures.mockSchema());
        Map<String, Object> credential = keymaster.bindCredential(schema, holder);
        credential.put("credential", Map.of("email", TEXT));
        String did = keymaster.issueCredential(credential);
        keymaster.setCurrentId("Holder");
        assertTrue(keymaster.acceptCredential(did));
        Map<String, Object> accepted = keymaster.getCredential(did);
        assertEquals(Map.of("email", TEXT), accepted.get("credential"));
        assertTrue(keymaster.verifySignature(accepted));
    }

    @Test
    void encryptedWalletMetadataSurvivesMutationExportAndRestart() {
        keymaster.mutateWallet(wallet -> wallet.additionalProperties().put("text", TEXT));
        assertEquals(TEXT, keymaster.loadWallet().additionalProperties().get("text"));
        assertEquals(TEXT, new Keymaster(store, node.client, "passphrase", "local").loadWallet().additionalProperties().get("text"));
        var exported = new WalletJsonMemory<>(WalletEncFile.class);
        assertTrue(exported.saveWallet(keymaster.exportEncryptedWallet(), false));
        assertEquals(TEXT, new Keymaster(exported, node.client, "passphrase", "local").loadWallet().additionalProperties().get("text"));
    }
}
