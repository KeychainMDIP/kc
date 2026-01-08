package org.keychain.keymaster.store;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

public final class WalletJsonMapper {
    private static final ObjectMapper MAPPER = new ObjectMapper()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private WalletJsonMapper() {}

    public static ObjectMapper mapper() {
        return MAPPER;
    }
}
