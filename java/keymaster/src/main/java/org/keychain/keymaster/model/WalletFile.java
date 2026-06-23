package org.keychain.keymaster.model;

import java.util.Map;

public class WalletFile {
    public Integer version;
    public Seed seed;
    public int counter;
    public Map<String, IDInfo> ids;
    public String current;
    public Map<String, String> names;
    public Map<String, Object> extras;
}
