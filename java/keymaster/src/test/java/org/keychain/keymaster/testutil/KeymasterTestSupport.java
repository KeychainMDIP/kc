package org.keychain.keymaster.testutil;

import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.keymaster.Keymaster;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMemory;

public final class KeymasterTestSupport {
    public static final String DEFAULT_PASSPHRASE = "passphrase";

    private KeymasterTestSupport() {
    }

    public static WalletJsonMemory<WalletEncFile> memoryStore() {
        return new WalletJsonMemory<>(WalletEncFile.class);
    }

    public static Keymaster keymaster() {
        return new Keymaster(memoryStore(), DEFAULT_PASSPHRASE);
    }

    public static Keymaster keymaster(GatekeeperClient gatekeeper) {
        return new Keymaster(memoryStore(), gatekeeper, DEFAULT_PASSPHRASE);
    }

    public static Keymaster keymaster(GatekeeperClient gatekeeper, KeymasterCrypto crypto) {
        return new Keymaster(memoryStore(), gatekeeper, crypto, DEFAULT_PASSPHRASE);
    }

    public static Keymaster keymaster(WalletJsonMemory<WalletEncFile> store) {
        return new Keymaster(store, DEFAULT_PASSPHRASE);
    }

    public static Keymaster keymaster(WalletJsonMemory<WalletEncFile> store, GatekeeperClient gatekeeper) {
        return new Keymaster(store, gatekeeper, DEFAULT_PASSPHRASE);
    }

    public static Keymaster keymaster(WalletJsonMemory<WalletEncFile> store, GatekeeperClient gatekeeper, KeymasterCrypto crypto) {
        return new Keymaster(store, gatekeeper, crypto, DEFAULT_PASSPHRASE);
    }

    public static KeymasterCrypto crypto() {
        return new KeymasterCryptoImpl();
    }
}
