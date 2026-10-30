package org.keychain.gatekeeper.model;

public class EcdsaJwkPublic extends ExtensibleModel {
    public String kty;
    public String crv;
    public String x;
    public String y;

    public EcdsaJwkPublic() {}
}
