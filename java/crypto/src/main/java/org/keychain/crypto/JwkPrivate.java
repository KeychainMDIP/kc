package org.keychain.crypto;

public class JwkPrivate extends JwkPublic {
    public final String d;

    public JwkPrivate(String kty, String crv, String x, String y, String d) {
        super(kty, crv, x, y);
        this.d = d;
    }
}
