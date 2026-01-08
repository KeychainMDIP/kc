package org.keychain.keymaster.store;

import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;

public final class WalletStoreTypes {
    private WalletStoreTypes() {}

    public static Class<?> storageClass(Object wallet) {
        if (wallet == null) {
            return null;
        }
        if (wallet instanceof WalletEncFile) {
            return WalletEncFile.class;
        }
        if (wallet instanceof WalletFile) {
            return WalletFile.class;
        }
        return wallet.getClass();
    }
}
