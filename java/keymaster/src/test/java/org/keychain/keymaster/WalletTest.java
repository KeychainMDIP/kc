package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.model.HdKey;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.KeymasterTestSupport;

class WalletTest {
    private static final String PASSPHRASE = KeymasterTestSupport.DEFAULT_PASSPHRASE;
    private static final String MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    @Test
    void loadWalletCreatesWalletOnFirstLoad() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

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
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        WalletFile wallet1 = keymaster.loadWallet();
        WalletFile wallet2 = keymaster.loadWallet();

        assertSame(wallet1, wallet2);
    }

    @Test
    void loadWalletThrowsOnIncorrectPassphrase() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        try {
            Keymaster wrong = new Keymaster(store, "incorrect");
            wrong.loadWallet();
            throw new IllegalStateException("expected exception");
        } catch (IllegalStateException e) {
            assertEquals("Mnemonic decryption failed", e.getMessage());
        }
    }

    @Test
    void saveWalletStoresAndLoads() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

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
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        WalletFile wallet = buildWallet(0);
        assertTrue(keymaster.saveWallet(wallet, false));
        WalletFile loaded = keymaster.loadWallet();
        assertEquals(wallet.counter, loaded.counter);
    }

    @Test
    void saveWalletOverwritesExistingWallet() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        WalletFile wallet = buildWallet(0);
        assertTrue(keymaster.saveWallet(wallet, true));

        WalletFile updated = buildWallet(1);
        assertTrue(keymaster.saveWallet(updated, true));

        WalletFile loaded = keymaster.loadWallet();
        assertEquals(1, loaded.counter);
    }

    @Test
    void saveWalletDoesNotOverwriteWhenFlagFalse() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        WalletFile wallet = buildWallet(0);
        assertTrue(keymaster.saveWallet(wallet, true));

        WalletFile updated = buildWallet(2);
        assertEquals(false, keymaster.saveWallet(updated, false));

        WalletFile loaded = keymaster.loadWallet();
        assertEquals(0, loaded.counter);
    }

    @Test
    void saveWalletOverwritesInLoop() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        for (int i = 0; i < 5; i += 1) {
            WalletFile wallet = buildWallet(i);
            assertTrue(keymaster.saveWallet(wallet, true));
            WalletFile loaded = keymaster.loadWallet();
            assertEquals(i, loaded.counter);
        }
    }

    @Test
    void saveWalletPersistsAugmentedWallet() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

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
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        WalletFile wallet1 = keymaster.loadWallet();
        WalletFile wallet2 = keymaster.newWallet(null, true);

        assertNotEquals(wallet1.seed.mnemonicEnc.data, wallet2.seed.mnemonicEnc.data);
    }

    @Test
    void newWalletDoesNotOverwriteByDefault() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
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
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        keymaster.newWallet(MNEMONIC, true);
        String decrypted = keymaster.decryptMnemonic();
        assertEquals(MNEMONIC, decrypted);
    }

    @Test
    void decryptMnemonicReturns12Words() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        String mnemonic = keymaster.decryptMnemonic();
        List<String> words = List.of(mnemonic.split(" "));
        assertEquals(12, words.size());
    }

    @Test
    void exportEncryptedWalletReturnsEncryptedPayload() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        keymaster.loadWallet();

        WalletEncFile exported = keymaster.exportEncryptedWallet();
        assertNotNull(exported);
        assertNotNull(exported.seed);
        assertNotNull(exported.seed.mnemonicEnc);
        assertNotNull(exported.enc);
    }

    @Test
    void mutateWalletCreatesWalletIfMissing() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        keymaster.mutateWallet(wallet -> wallet.counter = 1);

        WalletFile wallet = keymaster.loadWallet();
        assertEquals(1, wallet.counter);
    }

    @Test
    void loadWalletUpgradesLegacyV0() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();

        WalletFile legacy = buildLegacyV0Wallet();
        WalletEncFile stored = new WalletEncFile();
        stored.version = 0;
        stored.seed = legacy.seed;
        stored.extra.put("counter", legacy.counter);
        stored.extra.put("ids", legacy.ids);
        stored.extra.put("current", legacy.current);

        store.saveWallet(stored, true);
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);

        WalletFile upgraded = keymaster.loadWallet();
        assertEquals(1, upgraded.version);
        assertNotNull(upgraded.seed);
        assertNotNull(upgraded.seed.mnemonicEnc);
        assertEquals(legacy.counter, upgraded.counter);
        assertEquals(legacy.ids.size(), upgraded.ids.size());
    }

    @Test
    void loadWalletUpgradesLegacyEncryptedWrapper() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        WalletFile legacy = buildLegacyV0Wallet();
        WalletEncFile wrapper = buildLegacyEncryptedWrapper(legacy, PASSPHRASE);
        store.saveWallet(wrapper, true);

        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        WalletFile upgraded = keymaster.loadWallet();

        assertEquals(1, upgraded.version);
        assertNotNull(upgraded.seed);
        assertNotNull(upgraded.seed.mnemonicEnc);
    }

    @Test
    void loadWalletV1EncryptedDoesNotExposeHdKey() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        keymaster.loadWallet();
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJsonMemory<WalletEncFile> store2 = KeymasterTestSupport.memoryStore();
        store2.saveWallet(exported, true);
        Keymaster keymaster2 = new Keymaster(store2, PASSPHRASE);
        WalletFile loaded = keymaster2.loadWallet();

        assertNotNull(loaded.seed);
        assertEquals(null, loaded.seed.hdkey);
    }

    @Test
    void loadWalletV1EncryptedCacheDoesNotExposeHdKey() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        keymaster.loadWallet();
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJsonMemory<WalletEncFile> store2 = KeymasterTestSupport.memoryStore();
        store2.saveWallet(exported, true);
        Keymaster keymaster2 = new Keymaster(store2, PASSPHRASE);
        keymaster2.loadWallet();
        WalletFile loaded = keymaster2.loadWallet();

        assertNotNull(loaded.seed);
        assertEquals(null, loaded.seed.hdkey);
    }

    @Test
    void saveWalletUpgradesLegacyV0() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
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
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        keymaster.newWallet(null, true);

        WalletFile legacy = buildLegacyV0Wallet();
        assertTrue(keymaster.saveWallet(legacy, true));
    }

    @Test
    void saveWalletEncryptsV1AndRemovesHdKey() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        WalletFile wallet = keymaster.newWallet(MNEMONIC, true);

        HdKey hdkey = toModelHdKey(HdKeyUtil.masterFromMnemonic(MNEMONIC));
        wallet.seed.hdkey = hdkey;

        assertTrue(keymaster.saveWallet(wallet, true));

        WalletEncFile stored = store.loadWallet();
        assertNotNull(stored.seed);
        assertEquals(null, stored.seed.hdkey);
        assertNotNull(stored.enc);
    }

    @Test
    void saveWalletAcceptsV1EncryptedWallet() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJsonMemory<WalletEncFile> store2 = KeymasterTestSupport.memoryStore();
        Keymaster keymaster2 = new Keymaster(store2, PASSPHRASE);
        assertTrue(keymaster2.saveWallet(exported, true));
    }

    @Test
    void saveWalletRejectsEncryptedWalletWithWrongPassphrase() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        WalletEncFile exported = keymaster.exportEncryptedWallet();

        WalletJsonMemory<WalletEncFile> store2 = KeymasterTestSupport.memoryStore();
        Keymaster wrong = new Keymaster(store2, "incorrect");
        try {
            wrong.saveWallet(exported, true);
            throw new IllegalStateException("expected exception");
        } catch (IllegalStateException e) {
            assertEquals("Keymaster: Incorrect passphrase.", e.getMessage());
        }
    }

    @Test
    void loadWalletThrowsOnUnsupportedVersion() {
        WalletJsonMemory<WalletEncFile> store = KeymasterTestSupport.memoryStore();
        WalletEncFile stored = new WalletEncFile();
        stored.version = 1;
        stored.seed = new Seed();
        store.saveWallet(stored, true);

        Keymaster keymaster = new Keymaster(store, PASSPHRASE);
        try {
            keymaster.loadWallet();
            throw new IllegalStateException("expected exception");
        } catch (IllegalStateException e) {
            assertEquals("Keymaster: Unsupported wallet version.", e.getMessage());
        }
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

    private static WalletEncFile buildLegacyEncryptedWrapper(WalletFile wallet, String passphrase) {
        try {
            byte[] salt = new byte[16];
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(salt);
            new SecureRandom().nextBytes(iv);

            SecretKey key = deriveLegacyKey(passphrase, salt);
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

    private static SecretKey deriveLegacyKey(String passphrase, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(passphrase.toCharArray(), salt, 100_000, 256);
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
}
