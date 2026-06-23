package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.testutil.LiveTestSupport;
import org.keychain.keymaster.testutil.TestFixtures;

@Tag("live")
class LiveSchemaTest {
    @TempDir
    private Path tempDir;

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    @Test
    void createSchemaFromTemplate() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        String did = keymaster.createSchema(TestFixtures.mockSchema());
        MdipDocument doc = keymaster.resolveDID(did);

        @SuppressWarnings("unchecked")
        Map<String, Object> docData = (Map<String, Object>) doc.didDocumentData;
        @SuppressWarnings("unchecked")
        Map<String, Object> schema = (Map<String, Object>) docData.get("schema");

        assertEquals(did, doc.didDocument.id);
        assertEquals(TestFixtures.mockSchema(), schema);
    }

    @Test
    void createDefaultSchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        String did = keymaster.createSchema();
        MdipDocument doc = keymaster.resolveDID(did);

        @SuppressWarnings("unchecked")
        Map<String, Object> docData = (Map<String, Object>) doc.didDocumentData;
        @SuppressWarnings("unchecked")
        Map<String, Object> schema = (Map<String, Object>) docData.get("schema");

        Map<String, Object> expectedSchema = Map.of(
            "$schema", "http://json-schema.org/draft-07/schema#",
            "type", "object",
            "properties", Map.of(
                "propertyName", Map.of("type", "string")
            ),
            "required", List.of("propertyName")
        );

        assertEquals(expectedSchema, schema);
    }

    @Test
    void createSchemaRejectsInvalidSchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.createSchema(Map.of("mock", "not a schema"))
        );
        assertEquals("Invalid parameter: schema", error.getMessage());
    }

    @Test
    void createSchemaRejectsMissingProperties() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.createSchema(Map.of("$schema", "http://json-schema.org/draft-07/schema#"))
        );
        assertEquals("Invalid parameter: schema", error.getMessage());
    }

    @Test
    void listSchemasReturnsOnlySchemas() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        String schema1 = keymaster.createSchema();
        String schema2 = keymaster.createSchema();
        String schema3 = keymaster.createSchema();
        String other = keymaster.createAsset(Map.of("name", "notSchema"));

        List<String> schemas = keymaster.listSchemas();
        assertTrue(schemas.contains(schema1));
        assertTrue(schemas.contains(schema2));
        assertTrue(schemas.contains(schema3));
        assertFalse(schemas.contains(other));
    }

    @Test
    void getSchemaReturnsSchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createSchema(TestFixtures.mockSchema());

        Object schema = keymaster.getSchema(did);
        assertEquals(TestFixtures.mockSchema(), schema);
    }

    @Test
    void getSchemaInvalidIdReturnsNull() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");

        Object schema = keymaster.getSchema(did);
        assertNull(schema);
    }

    @Test
    void getSchemaReturnsLegacySchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createAsset(TestFixtures.mockSchema());

        Object schema = keymaster.getSchema(did);
        assertEquals(TestFixtures.mockSchema(), schema);
    }

    @Test
    void getSchemaInvalidDidThrows() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.getSchema("bogus")
        );
        assertEquals("unknown id", error.getMessage());
    }

    @Test
    void setSchemaUpdatesSchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createSchema();

        boolean ok = keymaster.setSchema(did, TestFixtures.mockSchema());
        Object schema = keymaster.getSchema(did);

        assertTrue(ok);
        assertEquals(TestFixtures.mockSchema(), schema);
    }

    @Test
    void setSchemaRejectsInvalidSchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createSchema();

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.setSchema(did, Map.of("mock", "not a schema"))
        );
        assertEquals("Invalid parameter: schema", error.getMessage());
    }

    @Test
    void testSchemaReturnsTrueForSchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createSchema();
        keymaster.setSchema(did, TestFixtures.mockSchema());

        boolean isSchema = keymaster.testSchema(did);
        assertTrue(isSchema);
    }

    @Test
    void testSchemaReturnsFalseForNonSchema() {
        Keymaster keymaster = newKeymaster();
        String agentDid = keymaster.createId("Bob");

        assertFalse(keymaster.testSchema(agentDid));
    }

    @Test
    void testSchemaReturnsFalseForInvalidDid() {
        Keymaster keymaster = newKeymaster();
        assertFalse(keymaster.testSchema("mock7"));
    }

    @Test
    void createTemplateFromSchema() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createSchema();
        keymaster.setSchema(did, TestFixtures.mockSchema());

        Map<String, Object> template = keymaster.createTemplate(did);
        Map<String, Object> expected = Map.of(
            "$schema", did,
            "email", "TBD"
        );
        assertEquals(expected, template);
    }

    @Test
    void createTemplateMissingDidThrows() {
        Keymaster keymaster = newKeymaster();

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.createTemplate("bogus")
        );
        assertEquals("Invalid parameter: schemaId", error.getMessage());
    }
}
