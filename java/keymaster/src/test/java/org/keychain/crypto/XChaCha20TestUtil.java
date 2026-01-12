package org.keychain.crypto;

import java.util.function.Supplier;

public final class XChaCha20TestUtil {
    private XChaCha20TestUtil() {
    }

    public static void setNonceSupplier(Supplier<byte[]> supplier) {
        XChaCha20Util.setNonceSupplier(supplier);
    }

    public static void resetNonceSupplier() {
        XChaCha20Util.resetNonceSupplier();
    }
}
