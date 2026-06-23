package org.keychain.crypto;

import java.security.SecureRandom;
import java.util.Arrays;
import java.util.List;
import org.bitcoinj.crypto.MnemonicCode;
import org.bitcoinj.crypto.MnemonicException;

public final class MnemonicUtil {
    private static final SecureRandom RNG = new SecureRandom();

    private MnemonicUtil() {}

    public static String generateMnemonic() {
        byte[] entropy = new byte[16];
        RNG.nextBytes(entropy);

        try {
            List<String> words = MnemonicCode.INSTANCE.toMnemonic(entropy);
            return String.join(" ", words);
        } catch (MnemonicException e) {
            throw new IllegalStateException("Unable to generate mnemonic", e);
        }
    }

    public static boolean validateMnemonic(String mnemonic) {
        if (mnemonic == null || mnemonic.trim().isEmpty()) {
            return false;
        }

        try {
            List<String> words = Arrays.asList(mnemonic.trim().split("\\s+"));
            MnemonicCode.INSTANCE.check(words);
            return true;
        } catch (IllegalArgumentException | MnemonicException e) {
            return false;
        }
    }
}
