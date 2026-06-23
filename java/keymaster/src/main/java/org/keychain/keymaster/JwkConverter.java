package org.keychain.keymaster;

import org.keychain.crypto.JwkPublic;
import org.keychain.gatekeeper.model.EcdsaJwkPublic;

public final class JwkConverter {
    private JwkConverter() {}

    public static EcdsaJwkPublic toEcdsaJwkPublic(JwkPublic jwk) {
        if (jwk == null) {
            return null;
        }
        EcdsaJwkPublic out = new EcdsaJwkPublic();
        out.kty = jwk.kty;
        out.crv = jwk.crv;
        out.x = jwk.x;
        out.y = jwk.y;
        return out;
    }
}
