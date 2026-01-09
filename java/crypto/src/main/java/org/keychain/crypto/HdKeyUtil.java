package org.keychain.crypto;

import java.util.Arrays;
import java.util.List;
import org.bitcoinj.crypto.ChildNumber;
import org.bitcoinj.crypto.DeterministicKey;
import org.bitcoinj.crypto.HDKeyDerivation;
import org.bitcoinj.crypto.MnemonicCode;
import org.bitcoinj.params.MainNetParams;

public final class HdKeyUtil {
    private HdKeyUtil() {}

    public static DeterministicKey masterFromMnemonic(String mnemonic) {
        List<String> words = Arrays.asList(mnemonic.trim().split("\\s+"));
        byte[] seed = MnemonicCode.toSeed(words, "");
        return HDKeyDerivation.createMasterPrivateKey(seed);
    }

    public static DeterministicKey fromXpriv(String xpriv) {
        if (xpriv == null || xpriv.isBlank()) {
            throw new IllegalArgumentException("xpriv is required");
        }
        return DeterministicKey.deserializeB58(xpriv, MainNetParams.get());
    }

    public static DeterministicKey derivePath(DeterministicKey master, int account, int index) {
        if (account < 0 || index < 0) {
            throw new IllegalArgumentException("account and index must be >= 0");
        }

        DeterministicKey key = master;
        key = HDKeyDerivation.deriveChildKey(key, new ChildNumber(44, true));
        key = HDKeyDerivation.deriveChildKey(key, new ChildNumber(0, true));
        key = HDKeyDerivation.deriveChildKey(key, new ChildNumber(account, true));
        key = HDKeyDerivation.deriveChildKey(key, ChildNumber.ZERO);
        key = HDKeyDerivation.deriveChildKey(key, new ChildNumber(index, false));
        return key;
    }

    public static byte[] privateKeyBytes(DeterministicKey key) {
        byte[] keyBytes = key.getPrivKeyBytes();
        if (keyBytes.length == 32) {
            return keyBytes;
        }
        if (keyBytes.length > 32) {
            return Arrays.copyOfRange(keyBytes, keyBytes.length - 32, keyBytes.length);
        }
        byte[] padded = new byte[32];
        System.arraycopy(keyBytes, 0, padded, 32 - keyBytes.length, keyBytes.length);
        return padded;
    }

    public static HdKey toHdKey(DeterministicKey master) {
        String xpriv = master.serializePrivB58(MainNetParams.get());
        String xpub = master.serializePubB58(MainNetParams.get());
        return new HdKey(xpriv, xpub);
    }
}
