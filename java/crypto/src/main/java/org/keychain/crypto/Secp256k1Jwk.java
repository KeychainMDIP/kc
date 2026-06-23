package org.keychain.crypto;

import java.math.BigInteger;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.math.ec.ECPoint;
import org.keychain.crypto.util.Base64Url;

public final class Secp256k1Jwk {
    private static final String KTY = "EC";
    private static final String CRV = "secp256k1";

    private Secp256k1Jwk() {}

    public static JwkPair fromPrivateKey(byte[] privateKeyBytes) {
        if (privateKeyBytes == null || privateKeyBytes.length != 32) {
            throw new IllegalArgumentException("privateKeyBytes must be 32 bytes");
        }

        BigInteger d = new BigInteger(1, privateKeyBytes);
        ECPoint q = SECNamedCurves.getByName(CRV).getG().multiply(d).normalize();
        byte[] uncompressed = q.getEncoded(false);

        byte[] x = new byte[32];
        byte[] y = new byte[32];
        System.arraycopy(uncompressed, 1, x, 0, 32);
        System.arraycopy(uncompressed, 33, y, 0, 32);

        String xB64 = Base64Url.encode(x);
        String yB64 = Base64Url.encode(y);
        String dB64 = Base64Url.encode(privateKeyBytes);

        JwkPublic pub = new JwkPublic(KTY, CRV, xB64, yB64);
        JwkPrivate priv = new JwkPrivate(KTY, CRV, xB64, yB64, dB64);
        return new JwkPair(pub, priv);
    }

    public static byte[] toCompressed(JwkPublic jwk) {
        if (jwk == null) {
            throw new IllegalArgumentException("jwk must not be null");
        }

        byte[] x = Base64Url.decode(jwk.x);
        byte[] y = Base64Url.decode(jwk.y);
        if (x.length != 32 || y.length != 32) {
            throw new IllegalArgumentException("x and y must be 32 bytes");
        }

        byte prefix = (byte) ((y[y.length - 1] & 1) == 0 ? 0x02 : 0x03);
        byte[] out = new byte[33];
        out[0] = prefix;
        System.arraycopy(x, 0, out, 1, 32);
        return out;
    }
}
