package org.keychain.keymaster.testutil;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.keychain.gatekeeper.GatekeeperInterface;

public final class TestFixtures {
    private TestFixtures() {
    }

    public static JsonNode readVector(String name) throws IOException {
        try (InputStream input = TestFixtures.class.getResourceAsStream("/vectors/" + name)) {
            if (input == null) {
                throw new AssertionError("Missing test vector: " + name);
            }
            return new ObjectMapper().readTree(input);
        }
    }

    public static GatekeeperInterface offlineGatekeeper() {
        return (GatekeeperInterface) Proxy.newProxyInstance(
            GatekeeperInterface.class.getClassLoader(),
            new Class<?>[] { GatekeeperInterface.class },
            (proxy, method, args) -> {
                throw new AssertionError("Unexpected Gatekeeper call: " + method.getName());
            }
        );
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
