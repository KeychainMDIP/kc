package org.keychain.gatekeeper.model;

public class Operation {
    public String type;
    public String created;
    public String blockid;
    public String did;
    public String previd;
    public Mdip mdip;
    public String controller;
    public Object data;
    public MdipDocument doc;
    public EcdsaJwkPublic publicJwk;
    public Signature signature;

    public Operation() {}
}
