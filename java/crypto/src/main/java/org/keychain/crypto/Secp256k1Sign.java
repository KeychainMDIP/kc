package org.keychain.crypto;

import java.math.BigInteger;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.crypto.digests.SHA256Digest;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPrivateKeyParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.crypto.signers.HMacDSAKCalculator;
import org.bouncycastle.math.ec.ECPoint;
import org.keychain.crypto.util.Base64Url;
import org.keychain.crypto.util.Hex;

public final class Secp256k1Sign {
    private static final String CURVE = "secp256k1";
    private static final ECDomainParameters DOMAIN;

    static {
        var params = SECNamedCurves.getByName(CURVE);
        DOMAIN = new ECDomainParameters(params.getCurve(), params.getG(), params.getN(), params.getH());
    }

    private Secp256k1Sign() {}

    public static String signHash(String msgHashHex, JwkPrivate privateJwk) {
        if (msgHashHex == null || privateJwk == null) {
            throw new IllegalArgumentException("msgHashHex and privateJwk are required");
        }

        byte[] msg = Hex.decode(msgHashHex);
        byte[] privBytes = Base64Url.decode(privateJwk.d);
        BigInteger d = new BigInteger(1, privBytes);

        ECDSASigner signer = new ECDSASigner(new HMacDSAKCalculator(new SHA256Digest()));
        signer.init(true, new ECPrivateKeyParameters(d, DOMAIN));
        BigInteger[] rs = signer.generateSignature(msg);

        BigInteger r = rs[0];
        BigInteger s = rs[1];
        BigInteger n = DOMAIN.getN();
        BigInteger halfN = n.shiftRight(1);
        if (s.compareTo(halfN) > 0) {
            s = n.subtract(s);
        }

        byte[] rBytes = toFixedLength(r);
        byte[] sBytes = toFixedLength(s);
        byte[] sig = new byte[64];
        System.arraycopy(rBytes, 0, sig, 0, 32);
        System.arraycopy(sBytes, 0, sig, 32, 32);
        return Hex.encode(sig);
    }

    public static boolean verifySig(String msgHashHex, String sigCompactHex, JwkPublic publicJwk) {
        if (msgHashHex == null || sigCompactHex == null || publicJwk == null) {
            return false;
        }

        byte[] msg = Hex.decode(msgHashHex);
        byte[] sig = Hex.decode(sigCompactHex);
        if (sig.length != 64) {
            return false;
        }

        byte[] rBytes = new byte[32];
        byte[] sBytes = new byte[32];
        System.arraycopy(sig, 0, rBytes, 0, 32);
        System.arraycopy(sig, 32, sBytes, 0, 32);

        BigInteger r = new BigInteger(1, rBytes);
        BigInteger s = new BigInteger(1, sBytes);

        ECPoint q = DOMAIN.getCurve().createPoint(
            new BigInteger(1, Base64Url.decode(publicJwk.x)),
            new BigInteger(1, Base64Url.decode(publicJwk.y))
        );

        ECDSASigner verifier = new ECDSASigner();
        verifier.init(false, new ECPublicKeyParameters(q, DOMAIN));
        return verifier.verifySignature(msg, r, s);
    }

    private static byte[] toFixedLength(BigInteger value) {
        int length = 32;
        byte[] raw = value.toByteArray();
        if (raw.length == length) {
            return raw;
        }
        byte[] out = new byte[length];
        if (raw.length > length) {
            System.arraycopy(raw, raw.length - length, out, 0, length);
            return out;
        }
        System.arraycopy(raw, 0, out, length - raw.length, raw.length);
        return out;
    }
}
