package org.keychain.keymaster.store;

import java.util.concurrent.Callable;

public interface WalletStore<T> {
    boolean saveWallet(T wallet, boolean overwrite);
    T loadWallet();
    void updateWallet(Callable<Void> mutator);
}
