package org.keychain.keymaster.model;

import java.util.List;
import java.util.Map;

public class IDInfo {
    public String did;
    public int account;
    public int index;
    public List<String> held;
    public List<String> owned;
    public Map<String, Object> extras;
}
