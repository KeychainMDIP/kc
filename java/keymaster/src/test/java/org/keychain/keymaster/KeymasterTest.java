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

class KeymasterTest {
    @Test
    void loadWalletUsesManagerCache() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        CountingCrypto crypto = new CountingCrypto();
        Keymaster keymaster = new Keymaster(store, crypto, "passphrase");

        WalletFile first = keymaster.loadWallet();
        WalletFile second = keymaster.loadWallet();

        assertSame(first, second);
        assertEquals(1, crypto.decryptCount);
    }

    @Test
    void newWalletPersistsAndDecryptsMnemonic() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        Keymaster keymaster = new Keymaster(store, "passphrase");

        WalletFile wallet = keymaster.newWallet(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            true
        );

        assertNotNull(wallet);
        assertNotNull(keymaster.loadWallet());
        assertEquals(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            keymaster.decryptMnemonic()
        );
    }

    private static WalletEncFile buildStoredWallet() {
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

        WalletCrypto walletCrypto = new WalletCrypto("passphrase");
        return walletCrypto.encryptForStorage(wallet);
    }

    private static class CountingCrypto extends KeymasterCryptoImpl {
        int decryptCount = 0;

        @Override
        public String decryptMessage(org.keychain.crypto.JwkPublic pubKey, org.keychain.crypto.JwkPrivate privKey, String ciphertextB64Url) {
            decryptCount += 1;
            return super.decryptMessage(pubKey, privKey, ciphertextB64Url);
        }
    }
}
