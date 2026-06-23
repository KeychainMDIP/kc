package org.keychain.crypto;

public class JwkPair {
    public final JwkPublic publicJwk;
    public final JwkPrivate privateJwk;

    public JwkPair(JwkPublic publicJwk, JwkPrivate privateJwk) {
        this.publicJwk = publicJwk;
        this.privateJwk = privateJwk;
    }
}
