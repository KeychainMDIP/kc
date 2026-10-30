package org.keychain.keymaster.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class WalletEncFile {
    public int version;
    public Seed seed;
    public String enc;

    @JsonSetter("version")
    void readVersion(JsonNode value) {
        version = value == null || value.isNull() ? 0 : WalletFile.nonNegativeInt(value, "version");
    }

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
