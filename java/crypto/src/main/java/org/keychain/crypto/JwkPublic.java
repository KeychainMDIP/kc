package org.keychain.crypto;

public class JwkPublic {
    public final String kty;
    public final String crv;
    public final String x;
    public final String y;

    public JwkPublic(String kty, String crv, String x, String y) {
        this.kty = kty;
        this.crv = crv;
        this.x = x;
        this.y = y;
    }
}
