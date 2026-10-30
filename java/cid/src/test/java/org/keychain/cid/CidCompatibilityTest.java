package org.keychain.cid;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class CidCompatibilityTest {
    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    void matchesTheReferenceParser(String name, boolean valid, String input) {
        assertEquals(valid, Cid.isValid(input), name);
    }

    private static Stream<Arguments> cases() throws Exception {
        try (InputStream input = CidCompatibilityTest.class.getResourceAsStream("/vectors/cid-validation.tsv")) {
            assertNotNull(input);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8).lines()
                .filter(line -> !line.startsWith("#")).map(line -> {
                    String[] columns = line.split("\\t", -1);
                    return Arguments.of(columns[0], Boolean.parseBoolean(columns[1]), columns[2].equals("<null>") ? null : columns[2]);
                });
        }
    }
}
