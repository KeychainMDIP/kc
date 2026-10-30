package org.keychain.keymaster.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class IDInfo {
    public String did;
    public int account;
    public int index;
    public List<String> held;
    public List<String> owned;
    public Map<String, Object> extras;

    @JsonAnySetter
    private final Map<String, Object> additionalProperties = new LinkedHashMap<>();

    @JsonAnyGetter
    public Map<String, Object> additionalProperties() {
        return additionalProperties;
    }

    @JsonCreator
    static IDInfo fromJson(@JsonProperty("did") JsonNode did,
                          @JsonProperty("account") JsonNode account,
                          @JsonProperty("index") JsonNode index) {
        if (did == null || !did.isTextual() || did.textValue().isEmpty()) {
            throw new IllegalArgumentException("Invalid identity DID");
        }
        IDInfo id = new IDInfo();
        id.did = did.textValue();
        id.account = WalletFile.nonNegativeInt(account, "account");
        id.index = WalletFile.nonNegativeInt(index, "index");
        return id;
    }
}
