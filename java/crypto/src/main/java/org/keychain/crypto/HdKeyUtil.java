package org.keychain.crypto;

import java.util.Arrays;
import java.text.Normalizer;
import org.bouncycastle.crypto.digests.SHA512Digest;
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator;
import org.bouncycastle.crypto.params.KeyParameter;
import org.keychain.crypto.util.Bytes;
import org.bitcoinj.crypto.ChildNumber;
import org.bitcoinj.crypto.DeterministicKey;
import org.bitcoinj.crypto.HDKeyDerivation;
import org.bitcoinj.params.MainNetParams;

public final class HdKeyUtil {
    private HdKeyUtil() {}

    public static DeterministicKey masterFromMnemonic(String mnemonic) {
        String normalized = Normalizer.normalize(mnemonic, Normalizer.Form.NFKD);
        PKCS5S2ParametersGenerator generator = new PKCS5S2ParametersGenerator(new SHA512Digest());
        generator.init(Bytes.utf8(normalized), Bytes.utf8("mnemonic"), 2048);
        byte[] seed = ((KeyParameter) generator.generateDerivedParameters(512)).getKey();
        return HDKeyDerivation.createMasterPrivateKey(seed);
    }

    public static DeterministicKey fromXpriv(String xpriv) {
        if (xpriv == null || xpriv.isBlank()) {
            throw new IllegalArgumentException("xpriv is required");
        }
        DeterministicKey key = DeterministicKey.deserializeB58(xpriv, MainNetParams.get());
        if (key.hasPrivKey()) Secp256k1Jwk.privateScalar(privateKeyBytes(key));
        return key;
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
        String xpriv = master.hasPrivKey() ? master.serializePrivB58(MainNetParams.get()) : null;
        String xpub = master.serializePubB58(MainNetParams.get());
        return new HdKey(xpriv, xpub);
    }
}
