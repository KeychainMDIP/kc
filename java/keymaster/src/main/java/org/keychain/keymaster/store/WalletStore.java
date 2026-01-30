package org.keychain.keymaster.store;

public interface WalletStore<T> {
    boolean saveWallet(T wallet, boolean overwrite);
    T loadWallet();
}
