package org.keychain.keymaster.testutil;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class TestFixtures {
    private TestFixtures() {
    }

    public static Map<String, Object> mockJson() {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("key", "value");
        json.put("list", List.of(1, 2, 3));
        Map<String, Object> obj = new LinkedHashMap<>();
        obj.put("name", "some object");
        json.put("obj", obj);
        return json;
    }

    public static Map<String, Object> mockSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("$schema", "http://json-schema.org/draft-07/schema#");

        Map<String, Object> email = new LinkedHashMap<>();
        email.put("format", "email");
        email.put("type", "string");

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("email", email);

        schema.put("properties", properties);
        schema.put("required", List.of("email"));
        schema.put("type", "object");
        return schema;
    }
}
