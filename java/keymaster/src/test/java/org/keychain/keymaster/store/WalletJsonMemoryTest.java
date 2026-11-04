package org.keychain.keymaster.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.Keymaster;
import org.keychain.keymaster.model.HdKey;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.testutil.TestFixtures;

@Timeout(20)
class WalletJsonMemoryTest {
    private static final String PASSPHRASE = "passphrase";
    private static final String FIRST = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    private static final String SECOND = "legal winner thank year wave sausage worth useful legal winner thank yellow";
    @Test
    void saveLoadRoundTrip() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        WalletEncFile wallet = new WalletEncFile();
        wallet.version = 1;
        wallet.seed = new Seed();
        wallet.enc = "cipher";

        assertTrue(store.saveWallet(wallet, false));
        WalletEncFile loaded = store.loadWallet();
        assertNotNull(loaded);
        assertEquals(1, loaded.version);
        assertEquals("cipher", loaded.enc);
    }

    @Test
    void overwriteIsRespected() {
        WalletJsonMemory<WalletFile> store = new WalletJsonMemory<>(WalletFile.class);
        WalletFile wallet1 = new WalletFile();
        wallet1.version = 1;
        wallet1.counter = 0;
        wallet1.seed = new Seed();
        wallet1.ids = new HashMap<>();

        WalletFile wallet2 = new WalletFile();
        wallet2.version = 1;
        wallet2.counter = 1;
        wallet2.seed = new Seed();
        wallet2.ids = new HashMap<>();

        assertTrue(store.saveWallet(wallet1, false));
        assertFalse(store.saveWallet(wallet2, false));
        assertTrue(store.saveWallet(wallet2, true));

        WalletFile loaded = store.loadWallet();
        assertNotNull(loaded);
        assertEquals(1, loaded.counter);
    }

    @Test
    void loadReturnsNullIfEmpty() {
        WalletJsonMemory<WalletFile> store = new WalletJsonMemory<>(WalletFile.class);
        assertNull(store.loadWallet());
    }

    @Test
    void replacementWaitsForAnEarlierMutationToFinish() throws Exception {
        AtomicBoolean pause = new AtomicBoolean();
        CountDownLatch saving = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class) {
            @Override
            public boolean saveWallet(WalletEncFile wallet, boolean overwrite) {
                if (pause.compareAndSet(true, false)) {
                    saving.countDown();
                    await(release);
                }
                return super.saveWallet(wallet, overwrite);
            }
        };
        Keymaster keymaster = keymaster(store);
        keymaster.newWallet(FIRST, false);
        WalletFile replacement = WalletJsonMapper.mapper().convertValue(keymaster.loadWallet(), WalletFile.class);
        replacement.counter = 9;
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            pause.set(true);
            Future<Boolean> mutation = workers.submit(() -> keymaster.mutateWallet(wallet -> wallet.counter = 1));
            assertTrue(saving.await(5, TimeUnit.SECONDS));
            CountDownLatch replacing = new CountDownLatch(1);
            Future<Boolean> replace = workers.submit(() -> {
                replacing.countDown();
                return keymaster.saveWallet(replacement, true);
            });
            assertTrue(replacing.await(5, TimeUnit.SECONDS));
            assertThrows(TimeoutException.class, () -> replace.get(200, TimeUnit.MILLISECONDS));
            release.countDown();

            assertTrue(mutation.get(5, TimeUnit.SECONDS));
            assertTrue(replace.get(5, TimeUnit.SECONDS));
            assertEquals(9, keymaster.loadWallet().counter);
            assertEquals(9, keymaster(store).loadWallet().counter);
        } finally {
            release.countDown();
            workers.shutdownNow();
            assertTrue(workers.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    @Test
    void concurrentFirstLoadsCreateOneWallet() throws Exception {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        Keymaster keymaster = keymaster(store);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            Future<WalletFile> first = workers.submit(() -> { await(start); return keymaster.loadWallet(); });
            Future<WalletFile> second = workers.submit(() -> { await(start); return keymaster.loadWallet(); });
            start.countDown();

            assertSame(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS));
            assertEquals(keymaster.decryptMnemonic(), keymaster(store).decryptMnemonic());
        } finally {
            start.countDown();
            workers.shutdownNow();
            assertTrue(workers.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    @Test
    void nestedReplacementCannotBeOverwrittenByTheOuterMutation() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        Keymaster keymaster = keymaster(store);
        keymaster.newWallet(FIRST, false);

        assertThrows(IllegalStateException.class, () -> keymaster.mutateWallet(wallet -> {
            keymaster.newWallet(SECOND, true);
            wallet.counter++;
        }));

        assertEquals(SECOND, keymaster.decryptMnemonic());
        assertEquals(0, keymaster.loadWallet().counter);
        assertEquals(SECOND, keymaster(store).decryptMnemonic());
        assertTrue(keymaster.mutateWallet(wallet -> {
            assertEquals(SECOND, keymaster.decryptMnemonic());
            wallet.counter++;
        }));
        assertEquals(1, keymaster(store).loadWallet().counter);
        assertEquals(SECOND, keymaster(store).decryptMnemonic());
    }

    @ParameterizedTest
    @CsvSource({"plain,success", "plain,refuse", "plain,throw", "encrypted,success", "encrypted,refuse",
        "encrypted,throw", "legacy,success", "legacy,refuse", "legacy,throw"})
    void replacementPublishesWalletAndKeyOnlyAfterPersistence(String format, String outcome) {
        FailingStore store = new FailingStore();
        Keymaster keymaster = keymaster(store);
        WalletFile active = keymaster.newWallet(FIRST, false);
        String originalKey = keymaster.hdKeyPair().publicJwk.x;
        JsonNode originalStored = WalletJsonMapper.mapper().valueToTree(store.loadWallet());
        Keymaster other = keymaster(new WalletJsonMemory<>(WalletEncFile.class));
        WalletFile replacement = other.newWallet(SECOND, false);
        replacement.counter = 7;
        String replacementKey = other.hdKeyPair().publicJwk.x;
        WalletEncFile encrypted = new org.keychain.keymaster.WalletCrypto(new KeymasterCryptoImpl(), PASSPHRASE)
            .encryptForStorage(replacement);
        WalletFile candidate = "legacy".equals(format) ? legacyWallet(SECOND, 7) : replacement;
        store.outcome.set(outcome);

        java.util.function.Supplier<Boolean> save = () -> "encrypted".equals(format)
            ? keymaster.saveWallet(encrypted, true) : keymaster.saveWallet(candidate, true);
        if ("throw".equals(outcome)) {
            assertThrows(IllegalStateException.class, save::get);
        } else {
            assertEquals("success".equals(outcome), save.get());
        }

        if ("success".equals(outcome)) {
            assertEquals(7, keymaster.loadWallet().counter);
            assertEquals(SECOND, keymaster.decryptMnemonic());
            assertEquals(replacementKey, keymaster.hdKeyPair().publicJwk.x);
        } else {
            assertSame(active, keymaster.loadWallet());
            assertEquals(originalKey, keymaster.hdKeyPair().publicJwk.x);
            assertEquals(originalStored, WalletJsonMapper.mapper().valueToTree(store.loadWallet()));
        }
        Keymaster restarted = keymaster(store);
        assertEquals(keymaster.decryptMnemonic(), restarted.decryptMnemonic());
        assertEquals(keymaster.hdKeyPair().publicJwk.x, restarted.hdKeyPair().publicJwk.x);
    }

    @Test
    void mutationsIncludeSeedAndVersionAndPropagateRefusedWrites() {
        FailingStore store = new FailingStore();
        Keymaster keymaster = keymaster(store);
        WalletFile original = keymaster.newWallet(FIRST, false);
        assertFalse(keymaster.mutateWallet(wallet -> {}));
        store.outcome.set("refuse");
        assertThrows(IllegalStateException.class, () -> keymaster.mutateWallet(wallet -> wallet.counter++));
        assertSame(original, keymaster.loadWallet());
        assertEquals(0, keymaster(store).loadWallet().counter);

        Seed seed = new Seed();
        seed.mnemonicEnc = MnemonicEncryption.encrypt(SECOND, PASSPHRASE);
        assertTrue(keymaster.mutateWallet(wallet -> wallet.seed = seed));
        assertEquals(SECOND, keymaster.decryptMnemonic());
        assertEquals(SECOND, keymaster(store).decryptMnemonic());
        assertThrows(IllegalStateException.class, () -> keymaster.mutateWallet(wallet -> wallet.version = 2));
        assertEquals(1, keymaster.loadWallet().version);
        assertEquals(SECOND, keymaster(store).decryptMnemonic());
    }

    @ParameterizedTest
    @ValueSource(strings = {"refuse", "throw"})
    void failedNewWalletPreservesTheActiveWallet(String outcome) {
        FailingStore store = new FailingStore();
        Keymaster keymaster = keymaster(store);
        WalletFile active = keymaster.newWallet(FIRST, false);
        String key = keymaster.hdKeyPair().publicJwk.x;
        store.outcome.set(outcome);

        assertThrows(IllegalStateException.class, () -> keymaster.newWallet(SECOND, true));

        assertSame(active, keymaster.loadWallet());
        assertEquals(key, keymaster.hdKeyPair().publicJwk.x);
        assertEquals(FIRST, keymaster(store).decryptMnemonic());
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "malformed", "refuse", "throw"})
    void failedRecoveryPropagatesAndPreservesTheActiveWallet(String failure) throws Exception {
        FailingStore store = new FailingStore();
        AtomicReference<Object> asset = new AtomicReference<>();
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), PASSPHRASE) {
            @Override
            public Object resolveAsset(String did) { return asset.get(); }
        };
        WalletFile active = keymaster.newWallet(FIRST, false);
        String oldKey = keymaster.hdKeyPair().publicJwk.x;
        JsonNode before = WalletJsonMapper.mapper().valueToTree(store.loadWallet());
        String json = "malformed".equals(failure) ? "invalid JSON"
            : WalletJsonMapper.mapper().writeValueAsString(legacyWallet(FIRST, 4));
        var keys = keymaster.hdKeyPair();
        String backup = new KeymasterCryptoImpl().encryptMessage(keys.publicJwk, keys.privateJwk, json);
        asset.set("missing".equals(failure) ? Map.of() : Map.of("backup", backup));
        store.outcome.set(failure);

        assertThrows(RuntimeException.class, () -> keymaster.recoverWallet("did:test:backup"));

        assertSame(active, keymaster.loadWallet());
        assertEquals(oldKey, keymaster.hdKeyPair().publicJwk.x);
        assertEquals(before, WalletJsonMapper.mapper().valueToTree(store.loadWallet()));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void recoveryMakesOneDurableReplacement(boolean legacy) throws Exception {
        FailingStore store = new FailingStore();
        AtomicReference<Object> asset = new AtomicReference<>();
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), PASSPHRASE) {
            @Override
            public Object resolveAsset(String did) { return asset.get(); }
        };
        WalletFile active = keymaster.newWallet(FIRST, false);
        WalletFile restored = legacy ? legacyWallet(FIRST, 4)
            : WalletJsonMapper.mapper().convertValue(active, WalletFile.class);
        restored.counter = 4;
        if (!legacy) {
            restored.seed.mnemonicEnc = MnemonicEncryption.encrypt(FIRST, "previous passphrase");
        }
        restored.additionalProperties().put("recovered", true);
        String json = WalletJsonMapper.mapper().writeValueAsString(restored);
        var keys = keymaster.hdKeyPair();
        asset.set(Map.of("backup", new KeymasterCryptoImpl().encryptMessage(keys.publicJwk, keys.privateJwk, json)));
        int before = store.writes.get();

        WalletFile result = keymaster.recoverWallet("did:test:backup");

        assertEquals(4, result.counter);
        assertEquals(true, result.additionalProperties().get("recovered"));
        assertEquals(FIRST, keymaster.decryptMnemonic());
        assertEquals(4, keymaster(store).loadWallet().counter);
        assertEquals(keys.publicJwk.x, keymaster(store).hdKeyPair().publicJwk.x);
        assertEquals(before + 1, store.writes.get());
    }

    private static Keymaster keymaster(WalletJsonMemory<WalletEncFile> store) {
        return new Keymaster(store, TestFixtures.offlineGatekeeper(), PASSPHRASE);
    }

    private static WalletFile legacyWallet(String mnemonic, int counter) {
        WalletFile wallet = new WalletFile();
        wallet.version = 0;
        wallet.counter = counter;
        wallet.ids = new HashMap<>();
        wallet.seed = new Seed();
        var master = HdKeyUtil.masterFromMnemonic(mnemonic);
        var hd = HdKeyUtil.toHdKey(master);
        wallet.seed.hdkey = new HdKey();
        wallet.seed.hdkey.xpriv = hd.xpriv;
        wallet.seed.hdkey.xpub = hd.xpub;
        var keys = new KeymasterCryptoImpl().generateJwk(HdKeyUtil.privateKeyBytes(master));
        wallet.seed.mnemonic = new KeymasterCryptoImpl().encryptMessage(keys.publicJwk, keys.privateJwk, mnemonic);
        return wallet;
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Test latch timed out");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Test interrupted", e);
        }
    }

    private static class FailingStore extends WalletJsonMemory<WalletEncFile> {
        final AtomicReference<String> outcome = new AtomicReference<>();
        final AtomicInteger writes = new AtomicInteger();

        FailingStore() { super(WalletEncFile.class); }

        @Override
        public boolean saveWallet(WalletEncFile wallet, boolean overwrite) {
            String failure = outcome.getAndSet(null);
            if ("throw".equals(failure)) {
                throw new IllegalStateException("storage failed");
            }
            if ("refuse".equals(failure)) {
                return false;
            }
            boolean ok = super.saveWallet(wallet, overwrite);
            if (ok) {
                writes.incrementAndGet();
            }
            return ok;
        }
    }
}
