package org.keychain.crypto;

import java.math.BigInteger;
import java.util.Arrays;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.math.ec.ECPoint;
import org.keychain.crypto.util.Base64Url;

public final class Secp256k1Ecdh {
    private static final String CURVE = "secp256k1";
    private static final ECDomainParameters DOMAIN;

    static {
        var params = SECNamedCurves.getByName(CURVE);
        DOMAIN = new ECDomainParameters(params.getCurve(), params.getG(), params.getN(), params.getH());
    }

    private Secp256k1Ecdh() {}

    public static byte[] sharedSecretCompressed(JwkPublic pubKey, JwkPrivate privKey) {
        if (pubKey == null || privKey == null) {
            throw new IllegalArgumentException("pubKey and privKey are required");
        }

        BigInteger d = new BigInteger(1, Base64Url.decode(privKey.d));
        ECPoint q = DOMAIN.getCurve().createPoint(
            new BigInteger(1, Base64Url.decode(pubKey.x)),
            new BigInteger(1, Base64Url.decode(pubKey.y))
        );

        ECPoint shared = q.multiply(d).normalize();
        return shared.getEncoded(true);
    }

    public static byte[] deriveKey32(byte[] sharedCompressed) {
        if (sharedCompressed == null || sharedCompressed.length != 33) {
            throw new IllegalArgumentException("sharedCompressed must be 33 bytes");
        }

        return Arrays.copyOfRange(sharedCompressed, 0, 32);
    }
}
