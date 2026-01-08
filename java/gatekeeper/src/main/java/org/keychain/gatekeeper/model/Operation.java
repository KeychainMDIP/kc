package org.keychain.gatekeeper.model;

import java.util.Map;

public class Operation {
    public String type;
    public String created;
    public String blockid;
    public String did;
    public String previd;
    public Mdip mdip;
    public String controller;
    public Map<String, Object> data;
    public Map<String, Object> doc;
    public Map<String, Object> publicJwk;
    public Signature signature;

    public Operation() {}
}
