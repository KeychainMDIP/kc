package org.keychain.keymaster;

import java.util.HashMap;
import java.util.function.Consumer;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletStore;

public class Keymaster {
    private final KeymasterWalletManager walletManager;
    private final KeymasterCrypto crypto;
    private final String passphrase;

    public Keymaster(WalletStore<WalletEncFile> store, KeymasterCrypto crypto, String passphrase) {
        if (store == null) {
            throw new IllegalArgumentException("store is required");
        }
        if (crypto == null) {
            throw new IllegalArgumentException("crypto is required");
        }
        if (passphrase == null || passphrase.isEmpty()) {
            throw new IllegalArgumentException("passphrase is required");
        }

        this.crypto = crypto;
        this.passphrase = passphrase;
        this.walletManager = new KeymasterWalletManager(store, crypto, passphrase);
    }

    public Keymaster(WalletStore<WalletEncFile> store, String passphrase) {
        this(store, new KeymasterCryptoImpl(), passphrase);
    }

    public WalletFile loadWallet() {
        return walletManager.loadWallet();
    }

    public boolean saveWallet(WalletFile wallet, boolean overwrite) {
        return walletManager.saveWallet(wallet, overwrite);
    }

    public boolean mutateWallet(Consumer<WalletFile> mutator) {
        return walletManager.mutateWallet(mutator);
    }

    public WalletFile newWallet(String mnemonic, boolean overwrite) {
        String phrase = mnemonic != null ? mnemonic : crypto.generateMnemonic();

        Seed seed = new Seed();
        seed.mnemonicEnc = MnemonicEncryption.encrypt(phrase, passphrase);

        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.seed = seed;
        wallet.counter = 0;
        wallet.ids = new HashMap<>();

        boolean ok = saveWallet(wallet, overwrite);
        if (!ok) {
            throw new IllegalStateException("save wallet failed");
        }

        return wallet;
    }

    public String decryptMnemonic() {
        WalletFile wallet = loadWallet();
        if (wallet == null || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalStateException("wallet mnemonic not available");
        }
        return MnemonicEncryption.decrypt(wallet.seed.mnemonicEnc, passphrase);
    }
}
