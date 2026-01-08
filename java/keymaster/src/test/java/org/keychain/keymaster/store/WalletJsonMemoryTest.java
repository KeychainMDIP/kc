package org.keychain.keymaster.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import org.junit.jupiter.api.Test;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;

class WalletJsonMemoryTest {
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
}
