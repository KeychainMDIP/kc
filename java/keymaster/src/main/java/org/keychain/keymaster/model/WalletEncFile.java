package org.keychain.keymaster.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.HashMap;
import java.util.Map;

public class WalletEncFile {
    public int version;
    public Seed seed;
    public String enc;
    public String salt;
    public String iv;
    public String data;

    @JsonIgnore
    public Map<String, Object> extra = new HashMap<>();

    @JsonAnySetter
    public void addExtra(String key, Object value) {
        extra.put(key, value);
    }

    @JsonAnyGetter
    public Map<String, Object> getExtra() {
        return extra;
    }
}
