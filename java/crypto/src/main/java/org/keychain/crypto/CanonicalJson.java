package org.keychain.crypto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.json.JsonWriteFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.erdtman.jcs.JsonCanonicalizer;

public final class CanonicalJson {
    private static final ObjectMapper MAPPER = new ObjectMapper()
        .configure(JsonWriteFeature.WRITE_NAN_AS_STRINGS.mappedFeature(), false)
        .setDefaultPropertyInclusion(
            JsonInclude.Value.construct(JsonInclude.Include.NON_NULL, JsonInclude.Include.ALWAYS)
        );

    private CanonicalJson() {}

    public static String canonicalize(Object obj) {
        try {
            String json = MAPPER.writeValueAsString(obj);
            if ("null".equals(json)) return "null";
            String encoded = new JsonCanonicalizer(json).getEncodedString();
            // Match JSON.stringify's lone-surrogate escapes without changing JCS key order.
            StringBuilder result = new StringBuilder(encoded.length());
            for (int i = 0; i < encoded.length(); i++) {
                char ch = encoded.charAt(i);
                if (Character.isHighSurrogate(ch) && i + 1 < encoded.length() && Character.isLowSurrogate(encoded.charAt(i + 1))) {
                    result.append(ch).append(encoded.charAt(++i));
                } else if (Character.isSurrogate(ch)) {
                    result.append("\\u").append(Integer.toHexString(ch));
                } else {
                    result.append(ch);
                }
            }
            return result.toString();
        } catch (Exception e) {
            throw new IllegalArgumentException("Unable to canonicalize JSON", e);
        }
    }
}
