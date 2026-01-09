package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.util.HashMap;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMemory;

class KeymasterWalletManagerTest {
    @Test
    void loadWalletUsesCache() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        CountingCrypto crypto = new CountingCrypto();
        KeymasterWalletManager manager = new KeymasterWalletManager(store, crypto, "passphrase");

        WalletFile first = manager.loadWallet();
        WalletFile second = manager.loadWallet();

        assertSame(first, second);
        assertEquals(1, crypto.decryptCount);
        assertNotNull(manager.getHdkeyCache());
    }

    @Test
    void mutateWalletDoesNotReDecrypt() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        CountingCrypto crypto = new CountingCrypto();
        KeymasterWalletManager manager = new KeymasterWalletManager(store, crypto, "passphrase");

        manager.loadWallet();
        int decrypts = crypto.decryptCount;

        manager.mutateWallet(wallet -> wallet.counter += 1);

        assertEquals(decrypts, crypto.decryptCount);
        assertEquals(1, crypto.encryptCount);
    }

    @Test
    void saveWalletUpdatesCache() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        CountingCrypto crypto = new CountingCrypto();
        KeymasterWalletManager manager = new KeymasterWalletManager(store, crypto, "passphrase");

        WalletFile wallet = buildWallet();
        manager.saveWallet(wallet, true);

        WalletFile loaded = manager.loadWallet();
        assertSame(wallet, loaded);
        assertEquals(0, crypto.decryptCount);
    }

    private static WalletEncFile buildStoredWallet() {
        WalletFile wallet = buildWallet();
        WalletCrypto walletCrypto = new WalletCrypto("passphrase");
        return walletCrypto.encryptForStorage(wallet);
    }

    private static WalletFile buildWallet() {
        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.counter = 0;
        wallet.ids = new HashMap<>();
        wallet.names = new HashMap<>();
        wallet.current = "Alice";

        IDInfo id = new IDInfo();
        id.did = "did:test:alice";
        id.account = 0;
        id.index = 0;
        wallet.ids.put("Alice", id);

        Seed seed = new Seed();
        seed.mnemonicEnc = MnemonicEncryption.encrypt(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            "passphrase"
        );
        wallet.seed = seed;
        return wallet;
    }

    private static class CountingCrypto extends KeymasterCryptoImpl {
        int encryptCount = 0;
        int decryptCount = 0;

        @Override
        public String encryptMessage(org.keychain.crypto.JwkPublic pubKey, org.keychain.crypto.JwkPrivate privKey, String message) {
            encryptCount += 1;
            return super.encryptMessage(pubKey, privKey, message);
        }

        @Override
        public String decryptMessage(org.keychain.crypto.JwkPublic pubKey, org.keychain.crypto.JwkPrivate privKey, String ciphertextB64Url) {
            decryptCount += 1;
            return super.decryptMessage(pubKey, privKey, ciphertextB64Url);
        }
    }
}
