package org.keychain.keymaster.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletFile;

class WalletJsonTest {
    @TempDir
    Path tempDir;

    @Test
    void saveLoadRoundTrip() {
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.counter = 0;
        wallet.seed = new Seed();
        wallet.ids = new HashMap<>();

        assertTrue(store.saveWallet(wallet, false));
        WalletFile loaded = store.loadWallet();
        assertNotNull(loaded);
        assertEquals(1, loaded.version);
        assertEquals(0, loaded.counter);
    }

    @Test
    void overwriteIsRespected() {
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        WalletFile wallet1 = new WalletFile();
        wallet1.version = 1;
        wallet1.counter = 0;
        wallet1.seed = new Seed();
        wallet1.ids = new HashMap<>();

        WalletFile wallet2 = new WalletFile();
        wallet2.version = 1;
        wallet2.counter = 2;
        wallet2.seed = new Seed();
        wallet2.ids = new HashMap<>();

        assertTrue(store.saveWallet(wallet1, false));
        assertFalse(store.saveWallet(wallet2, false));
        assertTrue(store.saveWallet(wallet2, true));

        WalletFile loaded = store.loadWallet();
        assertNotNull(loaded);
        assertEquals(2, loaded.counter);
    }

    @Test
    void loadReturnsNullIfMissing() {
        WalletJson<WalletFile> store = new WalletJson<>(WalletFile.class, tempDir, "wallet.json");
        assertNull(store.loadWallet());
        assertFalse(Files.exists(tempDir.resolve("wallet.json")));
    }
}
