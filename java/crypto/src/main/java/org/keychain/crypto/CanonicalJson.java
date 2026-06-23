package org.keychain.crypto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.erdtman.jcs.JsonCanonicalizer;

public final class CanonicalJson {
    private static final ObjectMapper MAPPER = new ObjectMapper()
        .setDefaultPropertyInclusion(
            JsonInclude.Value.construct(JsonInclude.Include.NON_NULL, JsonInclude.Include.ALWAYS)
        );

    private CanonicalJson() {}

    public static String canonicalize(Object obj) {
        if (obj == null) {
            throw new IllegalArgumentException("obj must not be null");
        }

        try {
            String json = MAPPER.writeValueAsString(obj);
            return new JsonCanonicalizer(json).getEncodedString();
        } catch (Exception e) {
            throw new IllegalArgumentException("Unable to canonicalize JSON", e);
        }
    }
}
