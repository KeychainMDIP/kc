package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.CheckWalletResult;
import org.keychain.keymaster.model.FixWalletResult;
import org.keychain.keymaster.model.HdKey;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJson;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.testutil.LiveTestSupport;
import org.keychain.keymaster.testutil.TestFixtures;

@Tag("live")
class LiveWalletTest {
    private static final String PASSPHRASE = LiveTestSupport.DEFAULT_PASSPHRASE;
    private static final String MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    @TempDir
    Path tempDir;

    private WalletJson<WalletEncFile> newStore(String name) {
        return LiveTestSupport.walletStore(tempDir.resolve(name));
    }

    private Keymaster newKeymaster(WalletJson<WalletEncFile> store) {
        return new Keymaster(store, LiveTestSupport.gatekeeperClient(), PASSPHRASE, LiveTestSupport.DEFAULT_REGISTRY);
    }

    private Keymaster newKeymaster() {
        return newKeymaster(newStore("wallet"));
    }

    private GatekeeperInterface gatekeeperClient() {
        return LiveTestSupport.gatekeeperClient();
    }

    @Test
    void loadWalletCreatesWalletOnFirstLoad() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet = keymaster.loadWallet();

        assertNotNull(wallet);
        assertEquals(1, wallet.version);
        assertEquals(0, wallet.counter);
        assertNotNull(wallet.seed);
        assertNotNull(wallet.seed.mnemonicEnc);
        assertNotNull(wallet.seed.mnemonicEnc.salt);
        assertNotNull(wallet.seed.mnemonicEnc.iv);
        assertNotNull(wallet.seed.mnemonicEnc.data);
        assertNotNull(wallet.ids);
        assertEquals(0, wallet.ids.size());
    }

    @Test
    void loadWalletReturnsSameInstanceFromCache() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet1 = keymaster.loadWallet();
        WalletFile wallet2 = keymaster.loadWallet();

        assertSame(wallet1, wallet2);
    }

    @Test
    void loadWalletThrowsOnIncorrectPassphrase() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        keymaster.newWallet(MNEMONIC, true);

        try {
            Keymaster wrong = new Keymaster(store, LiveTestSupport.gatekeeperClient(), "incorrect", LiveTestSupport.DEFAULT_REGISTRY);
            wrong.loadWallet();
            throw new IllegalStateException("expected exception");
        } catch (IllegalStateException e) {
            assertEquals("Mnemonic decryption failed", e.getMessage());
        }
    }

    @Test
    void saveWalletStoresAndLoads() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet = buildWallet(0);
        assertTrue(keymaster.saveWallet(wallet, true));

        WalletFile loaded = keymaster.loadWallet();
        assertEquals(wallet.counter, loaded.counter);
        assertEquals(wallet.version, loaded.version);
        assertEquals(wallet.seed.mnemonicEnc.salt, loaded.seed.mnemonicEnc.salt);
        assertEquals(wallet.seed.mnemonicEnc.iv, loaded.seed.mnemonicEnc.iv);
        assertEquals(wallet.seed.mnemonicEnc.data, loaded.seed.mnemonicEnc.data);
    }

    @Test
    void saveWalletIgnoresOverwriteFlagIfUnnecessary() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet = buildWallet(0);
        assertTrue(keymaster.saveWallet(wallet, false));
        WalletFile loaded = keymaster.loadWallet();
        assertEquals(wallet.counter, loaded.counter);
    }

    @Test
    void saveWalletOverwritesExistingWallet() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet = buildWallet(0);
        assertTrue(keymaster.saveWallet(wallet, true));

        WalletFile updated = buildWallet(1);
        assertTrue(keymaster.saveWallet(updated, true));

        WalletFile loaded = keymaster.loadWallet();
        assertEquals(1, loaded.counter);
    }

    @Test
    void saveWalletDoesNotOverwriteWhenFlagFalse() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet = buildWallet(0);
        assertTrue(keymaster.saveWallet(wallet, true));

        WalletFile updated = buildWallet(2);
        assertFalse(keymaster.saveWallet(updated, false));

        WalletFile loaded = keymaster.loadWallet();
        assertEquals(0, loaded.counter);
    }

    @Test
    void saveWalletOverwritesInLoop() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        for (int i = 0; i < 5; i += 1) {
            WalletFile wallet = buildWallet(i);
            assertTrue(keymaster.saveWallet(wallet, true));
            WalletFile loaded = keymaster.loadWallet();
            assertEquals(i, loaded.counter);
        }
    }

    @Test
    void saveWalletPersistsAugmentedWallet() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet = buildWallet(0);
        IDInfo info = new IDInfo();
        info.did = "did:test:QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2o7";
        info.account = 0;
        info.index = 0;
        wallet.ids.put("Bob", info);
        wallet.extras = new HashMap<>();
        wallet.extras.put("meta", "value");
        assertTrue(keymaster.saveWallet(wallet, true));

        WalletFile loaded = keymaster.loadWallet();
        assertNotNull(loaded.ids.get("Bob"));
        assertEquals("value", loaded.extras.get("meta"));
    }

    @Test
    void newWalletOverwritesExistingWhenAllowed() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        WalletFile wallet1 = keymaster.loadWallet();
        WalletFile wallet2 = keymaster.newWallet(null, true);

        assertNotEquals(wallet1.seed.mnemonicEnc.data, wallet2.seed.mnemonicEnc.data);
    }

    @Test
    void newWalletDoesNotOverwriteByDefault() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        keymaster.loadWallet();

        try {
            keymaster.newWallet(null, false);
            throw new IllegalStateException("expected exception");
        } catch (IllegalStateException e) {
            assertEquals("save wallet failed", e.getMessage());
        }
    }

    @Test
    void newWalletCreatesFromMnemonic() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        keymaster.newWallet(MNEMONIC, true);
        String decrypted = keymaster.decryptMnemonic();
        assertEquals(MNEMONIC, decrypted);
    }

    @Test
    void decryptMnemonicReturns12Words() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        String mnemonic = keymaster.decryptMnemonic();
        List<String> words = List.of(mnemonic.split(" "));
        assertEquals(12, words.size());
    }

    @Test
    void exportEncryptedWalletReturnsEncryptedPayload() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        keymaster.loadWallet();

        WalletEncFile exported = keymaster.exportEncryptedWallet();
        assertNotNull(exported);
        assertNotNull(exported.seed);
        assertNotNull(exported.seed.mnemonicEnc);
        assertNotNull(exported.enc);
    }

    @Test
    void mutateWalletCreatesWalletIfMissing() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);

        keymaster.mutateWallet(wallet -> wallet.counter = 1);

        WalletFile wallet = keymaster.loadWallet();
        assertEquals(1, wallet.counter);
    }

    @Test
    void loadWalletUpgradesLegacyV0() {
        WalletJson<WalletEncFile> store = newStore("wallet");

        WalletFile legacy = buildLegacyV0Wallet();
        WalletEncFile stored = new WalletEncFile();
        stored.version = 0;
        stored.seed = legacy.seed;
        stored.extra.put("counter", legacy.counter);
        stored.extra.put("ids", legacy.ids);
        stored.extra.put("current", legacy.current);

        store.saveWallet(stored, true);
        Keymaster keymaster = newKeymaster(store);

        WalletFile upgraded = keymaster.loadWallet();
        assertEquals(1, upgraded.version);
        assertNotNull(upgraded.seed);
        assertNotNull(upgraded.seed.mnemonicEnc);
        assertEquals(legacy.counter, upgraded.counter);
        assertEquals(legacy.ids.size(), upgraded.ids.size());
    }

    @Test
    void loadWalletUpgradesLegacyEncryptedWrapper() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        WalletFile legacy = buildLegacyV0Wallet();
        WalletEncFile wrapper = buildLegacyEncryptedWrapper(legacy);
        store.saveWallet(wrapper, true);

        Keymaster keymaster = newKeymaster(store);
        WalletFile upgraded = keymaster.loadWallet();

        assertEquals(1, upgraded.version);
        assertNotNull(upgraded.seed);
        assertNotNull(upgraded.seed.mnemonicEnc);
    }

    @Test
    void loadWalletV1EncryptedDoesNotExposeHdKey() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        keymaster.loadWallet();
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJson<WalletEncFile> store2 = newStore("wallet2");
        store2.saveWallet(exported, true);
        Keymaster keymaster2 = newKeymaster(store2);
        WalletFile loaded = keymaster2.loadWallet();

        assertNotNull(loaded.seed);
        assertNull(loaded.seed.hdkey);
    }

    @Test
    void loadWalletV1EncryptedCacheDoesNotExposeHdKey() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        keymaster.loadWallet();
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJson<WalletEncFile> store2 = newStore("wallet2");
        store2.saveWallet(exported, true);
        Keymaster keymaster2 = newKeymaster(store2);
        keymaster2.loadWallet();
        WalletFile loaded = keymaster2.loadWallet();

        assertNotNull(loaded.seed);
        assertNull(loaded.seed.hdkey);
    }

    @Test
    void saveWalletUpgradesLegacyV0() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        WalletFile legacy = buildLegacyV0Wallet();

        assertTrue(keymaster.saveWallet(legacy, true));

        WalletEncFile stored = store.loadWallet();
        assertNotNull(stored);
        assertEquals(1, stored.version);
        assertNotNull(stored.seed);
        assertNotNull(stored.seed.mnemonicEnc);
        assertNotNull(stored.enc);
    }

    @Test
    void saveWalletLegacyUpgradeDoesNotUseStaleCache() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        keymaster.newWallet(null, true);

        WalletFile legacy = buildLegacyV0Wallet();
        assertTrue(keymaster.saveWallet(legacy, true));
    }

    @Test
    void saveWalletEncryptsV1AndRemovesHdKey() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        WalletFile wallet = keymaster.newWallet(MNEMONIC, true);

        wallet.seed.hdkey = toModelHdKey(HdKeyUtil.masterFromMnemonic(MNEMONIC));

        assertTrue(keymaster.saveWallet(wallet, true));

        WalletEncFile stored = store.loadWallet();
        assertNotNull(stored.seed);
        assertNull(stored.seed.hdkey);
        assertNotNull(stored.enc);
    }

    @Test
    void saveWalletAcceptsV1EncryptedWallet() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJson<WalletEncFile> store2 = newStore("wallet2");
        Keymaster keymaster2 = newKeymaster(store2);
        assertTrue(keymaster2.saveWallet(exported, true));
    }

    @Test
    void saveWalletRejectsEncryptedWalletWithWrongPassphrase() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        Keymaster keymaster = newKeymaster(store);
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJson<WalletEncFile> store2 = newStore("wallet2");
        Keymaster wrong = new Keymaster(store2, LiveTestSupport.gatekeeperClient(), "incorrect", LiveTestSupport.DEFAULT_REGISTRY);
        try {
            wrong.saveWallet(exported, true);
            throw new IllegalStateException("expected exception");
        } catch (IllegalStateException e) {
            assertEquals("Keymaster: Incorrect passphrase.", e.getMessage());
        }
    }

    @Test
    void loadWalletThrowsOnUnsupportedVersion() {
        WalletJson<WalletEncFile> store = newStore("wallet");
        WalletEncFile stored = new WalletEncFile();
        stored.version = 1;
        stored.seed = new Seed();
        store.saveWallet(stored, true);

        Keymaster keymaster = newKeymaster(store);
        try {
            keymaster.loadWallet();
            throw new IllegalStateException("expected exception");
        } catch (IllegalStateException e) {
            assertEquals("Keymaster: Unsupported wallet version.", e.getMessage());
        }
    }

    @Test
    void updateSeedBankThrowsOnMissingDid() {
        Keymaster keymaster = newKeymaster();

        try {
            keymaster.updateSeedBank(new MdipDocument());
            throw new IllegalStateException("expected exception");
        } catch (IllegalArgumentException e) {
            assertEquals("Invalid parameter: seed bank missing DID", e.getMessage());
        }
    }

    @Test
    void resolveSeedBankIsDeterministic() {
        Keymaster keymaster = newKeymaster();

        MdipDocument bank1 = keymaster.resolveSeedBank();
        MdipDocument bank2 = keymaster.resolveSeedBank();

        assertNotNull(bank1);
        assertNotNull(bank2);
        assertNotNull(bank1.didDocument);
        assertNotNull(bank2.didDocument);
        assertEquals(bank1.didDocument.id, bank2.didDocument.id);
    }

    @Test
    void backupWalletReturnsDid() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        String did = keymaster.backupWallet();
        MdipDocument doc = keymaster.resolveDID(did);

        assertNotNull(doc);
        assertEquals(did, doc.didDocument.id);
    }

    @Test
    void backupWalletStoresDidInSeedBank() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        String did = keymaster.backupWallet();
        MdipDocument bank = keymaster.resolveSeedBank();
        assertNotNull(bank);
        assertNotNull(bank.didDocumentData);
        assertInstanceOf(Map.class, bank.didDocumentData);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) bank.didDocumentData;
        assertEquals(did, data.get("wallet"));
    }

    @Test
    void recoverWalletFromSeedBank() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        WalletFile wallet = keymaster.loadWallet();
        String mnemonic = keymaster.decryptMnemonic();
        keymaster.backupWallet();

        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet();

        assertEquals(wallet.counter, recovered.counter);
        assertEquals(wallet.version, recovered.version);
        assertNotNull(recovered.seed);
        assertNotNull(recovered.seed.mnemonicEnc);
        assertEquals(wallet.current, recovered.current);
        assertIdsMatch(wallet.ids, recovered.ids);
    }

    @Test
    void recoverOverExistingWallet() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        keymaster.loadWallet();
        keymaster.backupWallet();
        keymaster.createId("Alice");

        WalletFile recovered = keymaster.recoverWallet();

        assertEquals(1, recovered.counter);
        assertEquals("Bob", recovered.current);
        assertNotNull(recovered.seed);
        assertNotNull(recovered.seed.mnemonicEnc);
        assertNotNull(recovered.ids);
        assertTrue(recovered.ids.containsKey("Bob"));
    }

    @Test
    void recoverAugmentedWalletFromSeedBank() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        WalletFile wallet = keymaster.loadWallet();
        String mnemonic = keymaster.decryptMnemonic();

        IDInfo idInfo = wallet.ids.get("Bob");
        idInfo.extras = new HashMap<>();
        idInfo.extras.put("icon", "smiley");
        wallet.extras = new HashMap<>();
        wallet.extras.put("foo", "bar");
        keymaster.saveWallet(wallet, true);
        keymaster.backupWallet();

        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet();

        assertNotNull(recovered.extras);
        assertEquals("bar", recovered.extras.get("foo"));
        assertNotNull(recovered.ids.get("Bob").extras);
        assertEquals("smiley", recovered.ids.get("Bob").extras.get("icon"));
    }

    @Test
    void recoverV0WalletFromSeedBank() {
        Keymaster keymaster = newKeymaster();
        WalletFile legacy = buildLegacyV0Wallet();
        keymaster.saveWallet(legacy, true);
        String mnemonic = keymaster.decryptMnemonic();
        keymaster.backupWallet(LiveTestSupport.DEFAULT_REGISTRY, legacy);

        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet();
        assertNotNull(recovered);
        assertIdsMatch(legacy.ids, recovered.ids);
    }

    @Test
    void recoverWalletFromBackupDid() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        WalletFile wallet = keymaster.loadWallet();
        String mnemonic = keymaster.decryptMnemonic();
        String did = keymaster.backupWallet();

        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet(did);

        assertEquals(wallet.counter, recovered.counter);
        assertEquals(wallet.version, recovered.version);
        assertNotNull(recovered.seed);
        assertNotNull(recovered.seed.mnemonicEnc);
        assertEquals(wallet.current, recovered.current);
        assertIdsMatch(wallet.ids, recovered.ids);
    }

    @Test
    void recoverDoesNothingWhenNoBackup() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String mnemonic = keymaster.decryptMnemonic();

        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet();

        assertTrue(recovered.ids.isEmpty());
    }

    @Test
    void recoverDoesNothingWhenBackupDidInvalid() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Bob");
        String mnemonic = keymaster.decryptMnemonic();

        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet(agentDid);

        assertTrue(recovered.ids.isEmpty());
    }

    @Test
    void checkWalletEmpty() {
        Keymaster keymaster = newKeymaster();

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(0, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletSingleId() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(1, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletDetectsRevokedId() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Alice");
        keymaster.revokeDID(agentDid);

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(1, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(1, result.deleted);
    }

    @Test
    void checkWalletDetectsRemovedDids() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema();
        keymaster.addName("schema", schemaDid);
        gatekeeperClient().removeDIDs(List.of(agentDid, schemaDid));

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(3, result.checked);
        assertEquals(3, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletDetectsInvalidDids() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        keymaster.addToOwned("did:test:mock1", null);
        keymaster.addToHeld("did:test:mock2");

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(3, result.checked);
        assertEquals(2, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletDetectsRevokedCredentials() {
        Keymaster keymaster = newKeymaster();
        List<String> credentials = setupCredentials(keymaster);
        keymaster.addName("credential-0", credentials.get(0));
        keymaster.addName("credential-2", credentials.get(2));
        keymaster.revokeCredential(credentials.get(0));
        keymaster.revokeCredential(credentials.get(2));

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(16, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(4, result.deleted);
    }

    @Test
    void fixWalletEmpty() {
        Keymaster keymaster = newKeymaster();

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletSingleId() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesRevokedId() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Alice");
        keymaster.revokeDID(agentDid);

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(1, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesDeletedDids() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Alice");
        String schemaDid = keymaster.createSchema();
        keymaster.addName("schema", schemaDid);
        gatekeeperClient().removeDIDs(List.of(agentDid, schemaDid));

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(1, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(1, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesInvalidDids() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        keymaster.addToOwned("did:test:mock1", null);
        keymaster.addToHeld("did:test:mock2");

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(1, result.ownedRemoved);
        assertEquals(1, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesRevokedCredentials() {
        Keymaster keymaster = newKeymaster();
        List<String> credentials = setupCredentials(keymaster);
        keymaster.addName("credential-0", credentials.get(0));
        keymaster.addName("credential-2", credentials.get(2));
        keymaster.revokeCredential(credentials.get(0));
        keymaster.revokeCredential(credentials.get(2));

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(2, result.heldRemoved);
        assertEquals(2, result.namesRemoved);
    }

    private static WalletFile buildWallet(int counter) {
        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.counter = counter;
        wallet.ids = new HashMap<>();

        Seed seed = new Seed();
        seed.mnemonicEnc = MnemonicEncryption.encrypt(MNEMONIC, PASSPHRASE);
        wallet.seed = seed;
        return wallet;
    }

    private static WalletFile buildLegacyV0Wallet() {
        WalletFile wallet = new WalletFile();
        wallet.version = 0;
        wallet.counter = 1;
        wallet.ids = new HashMap<>();

        IDInfo info = new IDInfo();
        info.did = "did:test:QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2o7";
        info.account = 0;
        info.index = 0;
        wallet.ids.put("id_1", info);
        wallet.current = "id_1";

        var master = HdKeyUtil.masterFromMnemonic(MNEMONIC);
        HdKey hdkey = toModelHdKey(master);
        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        JwkPair keypair = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));

        Seed seed = new Seed();
        seed.hdkey = hdkey;
        seed.mnemonic = crypto.encryptMessage(keypair.publicJwk, keypair.privateJwk, MNEMONIC);
        wallet.seed = seed;
        return wallet;
    }

    private static WalletEncFile buildLegacyEncryptedWrapper(WalletFile wallet) {
        try {
            byte[] salt = new byte[16];
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(salt);
            new SecureRandom().nextBytes(iv);

            SecretKey key = deriveLegacyKey(salt);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] plaintext = WalletJsonMapper.mapper().writeValueAsString(wallet).getBytes(StandardCharsets.UTF_8);
            byte[] ciphertext = cipher.doFinal(plaintext);

            WalletEncFile stored = new WalletEncFile();
            stored.salt = Base64.getEncoder().encodeToString(salt);
            stored.iv = Base64.getEncoder().encodeToString(iv);
            stored.data = Base64.getEncoder().encodeToString(ciphertext);
            return stored;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to build legacy wrapper", e);
        }
    }

    private static SecretKey deriveLegacyKey(byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(PASSPHRASE.toCharArray(), salt, 100_000, 256);
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512");
        byte[] keyBytes = factory.generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }

    private static HdKey toModelHdKey(org.bitcoinj.crypto.DeterministicKey master) {
        org.keychain.crypto.HdKey cryptoHdKey = HdKeyUtil.toHdKey(master);
        HdKey hdkey = new HdKey();
        hdkey.xpriv = cryptoHdKey.xpriv;
        hdkey.xpub = cryptoHdKey.xpub;
        return hdkey;
    }

    private static void assertIdsMatch(Map<String, IDInfo> expected, Map<String, IDInfo> actual) {
        assertNotNull(expected);
        assertNotNull(actual);
        assertEquals(expected.keySet(), actual.keySet());
        for (Map.Entry<String, IDInfo> entry : expected.entrySet()) {
            IDInfo expectedInfo = entry.getValue();
            IDInfo actualInfo = actual.get(entry.getKey());
            assertNotNull(actualInfo);
            assertEquals(expectedInfo.did, actualInfo.did);
            assertEquals(expectedInfo.account, actualInfo.account);
            assertEquals(expectedInfo.index, actualInfo.index);
        }
    }

    private static List<String> setupCredentials(Keymaster keymaster) {
        keymaster.createId("Alice");
        keymaster.createId("Bob");
        String carol = keymaster.createId("Carol");
        keymaster.createId("Victor");

        keymaster.setCurrentId("Alice");
        String credential1 = keymaster.createSchema(TestFixtures.mockSchema());
        String credential2 = keymaster.createSchema(TestFixtures.mockSchema());

        Map<String, Object> bc1 = keymaster.bindCredential(credential1, carol);
        Map<String, Object> bc2 = keymaster.bindCredential(credential2, carol);

        String vc1 = keymaster.issueCredential(bc1);
        String vc2 = keymaster.issueCredential(bc2);

        keymaster.setCurrentId("Bob");
        String credential3 = keymaster.createSchema(TestFixtures.mockSchema());
        String credential4 = keymaster.createSchema(TestFixtures.mockSchema());

        Map<String, Object> bc3 = keymaster.bindCredential(credential3, carol);
        Map<String, Object> bc4 = keymaster.bindCredential(credential4, carol);

        String vc3 = keymaster.issueCredential(bc3);
        String vc4 = keymaster.issueCredential(bc4);

        keymaster.setCurrentId("Carol");
        keymaster.acceptCredential(vc1);
        keymaster.acceptCredential(vc2);
        keymaster.acceptCredential(vc3);
        keymaster.acceptCredential(vc4);

        return List.of(vc1, vc2, vc3, vc4);
    }
}
