package org.keychain.gatekeeper.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import java.util.LinkedHashMap;
import java.util.Map;

public abstract class ExtensibleModel {
    @JsonAnySetter
    private final Map<String, Object> additionalProperties = new LinkedHashMap<>();

    @JsonAnyGetter
    public Map<String, Object> additionalProperties() {
        return additionalProperties;
    }
}
