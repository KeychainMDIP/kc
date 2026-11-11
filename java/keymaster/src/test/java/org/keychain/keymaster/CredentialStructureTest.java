package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Map;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.testutil.TestFixtures;

class CredentialStructureTest {
    private static final JsonNode VECTOR = vector();
    private static final Method VALIDATOR = method("isVerifiableCredential", Object.class);
    private static final Method CURRENT = method("isCredentialCurrent", Map.class, long.class);

    static Stream<Arguments> cases() {
        return StreamSupport.stream(VECTOR.get("cases").spliterator(), false)
            .map(row -> Arguments.of(row.get("name").asText(), row));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    void matchesReferenceStructureAndValidity(String name, JsonNode row) throws Exception {
        ObjectNode candidate = VECTOR.get("base").deepCopy();
        candidate.setAll((ObjectNode) row.get("changes"));
        for (JsonNode path : row.path("remove")) {
            String[] keys = path.asText().split("\\.");
            ObjectNode target = candidate;
            for (int index = 0; index < keys.length - 1; index++) target = (ObjectNode) target.get(keys[index]);
            target.remove(keys[keys.length - 1]);
        }
        Map<?, ?> value = WalletJsonMapper.mapper().convertValue(candidate, Map.class);
        boolean valid = (boolean) VALIDATOR.invoke(null, value);
        assertEquals(row.get("valid").asBoolean(), valid, name);
        assertEquals(row.get("current").asBoolean(), valid && (boolean) CURRENT.invoke(null, value, VECTOR.get("now").asLong()), name);
    }

    @Test
    void rejectsNonObjects() throws Exception {
        for (Object value : Arrays.asList(null, "credential", 7, Arrays.asList("credential"))) {
            assertFalse((boolean) VALIDATOR.invoke(null, value));
        }
    }

    private static JsonNode vector() {
        try {
            return TestFixtures.readVector("credential-validation.json");
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    private static Method method(String name, Class<?>... arguments) {
        try {
            Method method = Keymaster.class.getDeclaredMethod(name, arguments);
            method.setAccessible(true);
            return method;
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
    }
}
