package org.keychain.gatekeeper.model;

import com.fasterxml.jackson.annotation.JsonValue;

public class BlockId {
    @JsonValue
    public Object value;

    public BlockId() {}

    public BlockId(Object value) {
        this.value = value;
    }
}
