package org.keychain.keymaster.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;

public class WalletFile {
    public Integer version;
    public Seed seed;
    public int counter;
    public Map<String, IDInfo> ids;
    public String current;
    public Map<String, String> names;
    public Map<String, Object> extras;

    @JsonAnySetter
    private final Map<String, Object> additionalProperties = new LinkedHashMap<>();

    @JsonAnyGetter
    public Map<String, Object> additionalProperties() {
        return additionalProperties;
    }

    @JsonCreator
    static WalletFile fromJson(@JsonProperty("counter") JsonNode counter,
                               @JsonProperty("ids") Map<String, IDInfo> ids) {
        if (ids == null || ids.containsValue(null)) {
            throw new IllegalArgumentException("Invalid wallet ids");
        }
        WalletFile wallet = new WalletFile();
        wallet.counter = nonNegativeInt(counter, "counter");
        wallet.ids = ids;
        return wallet;
    }

    @JsonSetter("version")
    void readVersion(JsonNode value) {
        version = value == null || value.isNull() ? null : nonNegativeInt(value, "version");
    }

    static int nonNegativeInt(JsonNode value, String field) {
        if (value == null || !value.isNumber() || !value.canConvertToExactIntegral()
            || !value.canConvertToInt() || value.decimalValue().signum() < 0) {
            throw new IllegalArgumentException(field + " must be an integer between 0 and 2147483647");
        }
        return value.intValue();
    }
}
