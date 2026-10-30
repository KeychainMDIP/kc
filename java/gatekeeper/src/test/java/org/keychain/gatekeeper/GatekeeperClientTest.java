package org.keychain.gatekeeper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.gatekeeper.model.BlockId;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.GatekeeperEvent;
import org.keychain.gatekeeper.model.ImportBatchResult;
import org.keychain.gatekeeper.model.IndexExportRequest;
import org.keychain.gatekeeper.model.IndexExportResponse;
import org.keychain.gatekeeper.model.Mdip;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ProcessEventsResult;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

class GatekeeperClientTest {
    private MockWebServer server;
    private GatekeeperClient client;
    private ObjectMapper mapper;
    private final List<GatekeeperClient> clients = new ArrayList<>();

    @BeforeEach
    void setup() throws Exception {
        server = new MockWebServer();
        server.start();
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        options.baseUrl = server.url("/").toString().replaceAll("/$", "");
        client = createClient(options);
        mapper = new ObjectMapper();
    }

    @AfterEach
    void teardown() throws Exception {
        clients.forEach(GatekeeperClient::close);
        server.shutdown();
    }

    @Test
    void createDidPostsOperation() throws Exception {
        server.enqueue(new MockResponse().setBody("\"did:test:123\"").setResponseCode(200));

        Operation op = new Operation();
        op.type = "create";
        op.blockid = "blockhash";
        Mdip mdip = new Mdip();
        mdip.version = 1;
        mdip.type = "agent";
        mdip.registry = "Signet";
        op.mdip = mdip;
        String did = client.createDID(op);

        var recorded = server.takeRequest();
        assertEquals("POST", recorded.getMethod());
        assertEquals("/api/v1/did", recorded.getPath());
        assertEquals("did:test:123", did);

        JsonNode actual = mapper.readTree(recorded.getBody().readUtf8());
        JsonNode expected = mapper.readTree(
            "{\"type\":\"create\",\"blockid\":\"blockhash\",\"mdip\":{\"version\":1,\"type\":\"agent\",\"registry\":\"Signet\"}}"
        );
        assertEquals(expected, actual);
    }

    @Test
    void jsonBodiesPreserveUnicodeCodeUnitsInsteadOfReplacingSignedData() throws Exception {
        server.enqueue(new MockResponse().setBody("\"did:test:unicode\"").setResponseCode(200));
        String text = "café 😀 " + (char) 0xd800;
        Operation operation = new Operation();
        operation.type = "create";
        operation.data = java.util.Map.of("text", text, "key" + (char) 0xdfff, "value");
        client.createDID(operation);
        JsonNode body = mapper.readTree(takeRequest().getBody().readUtf8());
        assertEquals(text, body.get("data").get("text").asText());
        assertEquals("value", body.get("data").get("key" + (char) 0xdfff).asText());
    }

    @Test
    void resolveDidBuildsQueryParams() throws Exception {
        MdipDocument doc = new MdipDocument();
        server.enqueue(new MockResponse().setBody(mapper.writeValueAsString(doc)).setResponseCode(200));

        ResolveDIDOptions options = new ResolveDIDOptions();
        options.confirm = true;
        options.verify = false;
        options.versionSequence = 2;
        options.versionTime = "2024-01-01T00:00:00Z";

        MdipDocument result = client.resolveDID("did:test:abc", options);
        assertNotNull(result);

        var recorded = server.takeRequest();
        assertEquals("GET", recorded.getMethod());
        assertNotNull(recorded.getPath());
        assertTrue(recorded.getPath().startsWith("/api/v1/did/did:test:abc?"));
        assertNotNull(recorded.getRequestUrl());
        assertEquals("true", recorded.getRequestUrl().queryParameter("confirm"));
        assertEquals("false", recorded.getRequestUrl().queryParameter("verify"));
        assertEquals("2", recorded.getRequestUrl().queryParameter("versionSequence"));
        assertEquals("2024-01-01T00:00:00Z", recorded.getRequestUrl().queryParameter("versionTime"));
    }

    @Test
    void updateAndDeleteUsePostDid() throws Exception {
        server.enqueue(new MockResponse().setBody("true").setResponseCode(200));
        server.enqueue(new MockResponse().setBody("true").setResponseCode(200));

        Operation op = new Operation();
        op.type = "update";
        op.did = "did:test:abc";
        op.previd = "prev1";
        assertTrue(client.updateDID(op));

        Operation del = new Operation();
        del.type = "delete";
        del.did = "did:test:abc";
        assertTrue(client.deleteDID(del));

        var updateReq = server.takeRequest();
        assertEquals("POST", updateReq.getMethod());
        assertEquals("/api/v1/did", updateReq.getPath());
        JsonNode updateBody = mapper.readTree(updateReq.getBody().readUtf8());
        JsonNode expectedUpdate = mapper.readTree(
            "{\"type\":\"update\",\"did\":\"did:test:abc\",\"previd\":\"prev1\"}"
        );
        assertEquals(expectedUpdate, updateBody);

        var deleteReq = server.takeRequest();
        assertEquals("POST", deleteReq.getMethod());
        assertEquals("/api/v1/did", deleteReq.getPath());
        JsonNode deleteBody = mapper.readTree(deleteReq.getBody().readUtf8());
        JsonNode expectedDelete = mapper.readTree("{\"type\":\"delete\",\"did\":\"did:test:abc\"}");
        assertEquals(expectedDelete, deleteBody);
    }

    @Test
    void getBlockUsesRegistryPath() throws Exception {
        BlockInfo block = new BlockInfo();
        block.hash = "hash";
        server.enqueue(new MockResponse().setBody(mapper.writeValueAsString(block)).setResponseCode(200));

        BlockInfo result = client.getBlock("local");
        assertEquals("hash", result.hash);

        var recorded = server.takeRequest();
        assertEquals("GET", recorded.getMethod());
        assertEquals("/api/v1/block/local/latest", recorded.getPath());
    }

    @Test
    void baseUrlStripsApiSuffix() throws Exception {
        server.enqueue(new MockResponse().setBody("{}").setResponseCode(200));

        GatekeeperClientOptions options = new GatekeeperClientOptions();
        options.baseUrl = server.url("/api/v1/").toString();
        GatekeeperClient localClient = createClient(options);

        localClient.getBlock("local");
        var recorded = server.takeRequest();
        assertEquals("/api/v1/block/local/latest", recorded.getPath());
    }

    @Test
    void errorsThrowGatekeeperClientException() {
        server.enqueue(new MockResponse().setResponseCode(400).setBody("{\"type\":\"Invalid\",\"message\":\"bad\"}"));

        Operation op = new Operation();
        op.type = "create";

        GatekeeperClientException error = assertThrows(GatekeeperClientException.class, () -> client.createDID(op));
        assertEquals(400, error.statusCode);
        assertNotNull(error.error);
        assertEquals("Invalid", error.error.type);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void importResultsPreserveRejectedIndicesAndEventOrdinals(boolean grouped) throws Exception {
        server.enqueue(new MockResponse().setBody(fixture("importBatch").toString()));
        GatekeeperEvent event = mapper.treeToValue(fixture("processEvents").get("acceptedEvents").get(0), GatekeeperEvent.class);

        ImportBatchResult result = grouped
            ? client.importDIDs(List.of(List.of(event)))
            : client.importBatch(List.of(event));

        assertEquals(1, result.queued);
        assertEquals(0, result.processed);
        assertEquals(1, result.rejected);
        assertEquals(2, result.total);
        assertEquals(List.of(1), result.rejectedIndices);
        RecordedRequest request = takeRequest();
        assertEquals(grouped ? "/api/v1/dids/import" : "/api/v1/batch/import", request.getPath());
        JsonNode body = mapper.readTree(request.getBody().readUtf8());
        JsonNode sentEvent = grouped ? body.get(0).get(0) : body.get(0);
        assertEquals(1793178000000L, sentEvent.get("ordinal").get(0).asLong());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void processingResultsSupportAcceptedEventsAndBusyResponses(boolean busy) throws Exception {
        server.enqueue(new MockResponse().setBody(busy ? "{\"busy\":true}" : fixture("processEvents").toString()));

        ProcessEventsResult result = client.processEvents();

        if (busy) {
            assertTrue(result.busy);
            assertNull(result.added);
            assertNull(result.acceptedHashes);
            assertNull(result.acceptedEvents);
            assertNull(result.rejectedOperations);
        } else {
            assertNull(result.busy);
            assertEquals(1, result.added);
            assertEquals(0, result.merged);
            assertEquals(1, result.rejected);
            assertEquals(0, result.pending);
            assertEquals(List.of("accepted-hash"), result.acceptedHashes);
            assertEquals(List.of(1793178000000L, 0L), result.acceptedEvents.get(0).ordinal);
            assertEquals("rejected-hash", result.rejectedOperations.get(0).signature.hash);
        }
        assertEquals("/api/v1/events/process", takeRequest().getPath());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void legacyExportsRetainFiltersAndLongOrdinals(boolean grouped) throws Exception {
        JsonNode event = fixture("processEvents").get("acceptedEvents").get(0);
        var events = mapper.createArrayNode().add(event);
        server.enqueue(new MockResponse().setBody((grouped ? mapper.createArrayNode().add(events) : events).toString()));

        GatekeeperEvent received = grouped
            ? client.exportDIDs(List.of("did:test:example")).get(0).get(0)
            : client.exportBatch(List.of("did:test:example")).get(0);

        assertEquals(List.of(1793178000000L, 0L), received.ordinal);
        RecordedRequest request = takeRequest();
        assertEquals(grouped ? "/api/v1/dids/export" : "/api/v1/batch/export", request.getPath());
        assertEquals(mapper.readTree("{\"dids\":[\"did:test:example\"]}"), mapper.readTree(request.getBody().readUtf8()));
    }

    @Test
    void snapshotExportsForwardOpaqueCursorsAndCheckpoints() throws Exception {
        server.enqueue(new MockResponse().setBody(fixture("snapshot").toString()));
        IndexExportRequest first = new IndexExportRequest();
        first.mode = "snapshot";
        first.limit = 50;

        IndexExportResponse page = client.exportIndex(first);

        assertEquals("snapshot", page.mode);
        assertEquals("epoch-one", page.indexEpoch);
        assertTrue(page.hasMore);
        assertEquals("did:test:example", page.dids.get(0).did);
        assertFalse(page.dids.get(0).removed);
        assertEquals(0, page.blocks.get(0).block.height);
        assertNull(page.blocks.get(0).removed);
        assertNull(page.operations);
        assertNull(page.removedOperations);
        RecordedRequest initial = takeRequest();
        assertEquals("POST", initial.getMethod());
        assertEquals("/api/v1/index/export", initial.getPath());
        assertEquals(mapper.readTree("{\"mode\":\"snapshot\",\"limit\":50}"), mapper.readTree(initial.getBody().readUtf8()));

        server.enqueue(new MockResponse().setBody(fixture("snapshot").toString()));
        first.cursor = page.cursor;
        first.checkpointCursor = page.checkpointCursor;
        client.exportIndex(first);
        JsonNode next = mapper.readTree(takeRequest().getBody().readUtf8());
        assertEquals("opaque snapshot / ?#%+ cursor", next.get("cursor").asText());
        assertEquals("opaque checkpoint / ?#%+ cursor", next.get("checkpointCursor").asText());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void changeExportsPreserveOptionalOperationsAndRemovals(boolean includeOperations) throws Exception {
        ObjectNode response = (ObjectNode) fixture("changes");
        if (!includeOperations) {
            response.remove(List.of("operations", "removedOperations"));
        }
        server.enqueue(new MockResponse().setBody(response.toString()));
        IndexExportRequest request = new IndexExportRequest();
        request.mode = "changes";
        request.cursor = "opaque previous / ?#%+ cursor";
        request.limit = 50;
        request.includeOperations = includeOperations;

        IndexExportResponse page = client.exportIndex(request);

        assertEquals("changes", page.mode);
        assertEquals("epoch-two", page.indexEpoch);
        assertNull(page.cursor);
        assertNull(page.checkpointCursor);
        assertFalse(page.hasMore);
        assertTrue(page.dids.get(0).removed);
        assertTrue(page.blocks.get(0).removed);
        if (includeOperations) {
            assertEquals(4294967296L, page.operations.get(0).seq);
            assertEquals("accepted-hash", page.operations.get(0).operationHash);
            assertEquals(List.of(1793178000000L, 0L), page.operations.get(0).event.ordinal);
            assertTrue(mapper.valueToTree(page.operations.get(0).event.operation.data).get("optional").isNull());
            assertEquals(4294967297L, page.removedOperations.get(0).seq);
            assertEquals("removed-hash", page.removedOperations.get(0).operationHash);
        } else {
            assertNull(page.operations);
            assertNull(page.removedOperations);
        }
        JsonNode body = mapper.readTree(takeRequest().getBody().readUtf8());
        assertEquals("changes", body.get("mode").asText());
        assertEquals(request.cursor, body.get("cursor").asText());
        assertEquals(includeOperations, body.get("includeOperations").asBoolean());
        assertFalse(body.has("checkpointCursor"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void queueClearingSupportsOperationsAndHashes(boolean hashes) throws Exception {
        server.enqueue(new MockResponse().setBody("true"));
        Operation operation = new Operation();
        operation.type = "delete";
        operation.did = "did:test:example";
        List<?> entries = hashes ? List.of("hash-one", "hash-two") : List.of(operation);

        assertTrue(client.clearQueue("hyperswarm", entries));

        RecordedRequest request = takeRequest();
        assertEquals("/api/v1/queue/hyperswarm/clear", request.getPath());
        JsonNode body = mapper.readTree(request.getBody().readUtf8());
        if (hashes) {
            assertEquals(mapper.readTree("[\"hash-one\",\"hash-two\"]"), body);
        } else {
            assertEquals(mapper.readTree("[{\"type\":\"delete\",\"did\":\"did:test:example\"}]"), body);
        }
    }

    @Test
    void registryPostPathsEncodeEachSegment() throws Exception {
        server.enqueue(new MockResponse().setBody("true"));
        server.enqueue(new MockResponse().setBody("true"));

        assertTrue(client.clearQueue("reg/#?% test", List.of("hash")));
        assertEquals("/api/v1/queue/reg%2F%23%3F%25%20test/clear", takeRequest().getPath());
        assertTrue(client.addBlock("reg/#?% test", new BlockInfo()));
        assertEquals("/api/v1/block/reg%2F%23%3F%25%20test", takeRequest().getPath());
    }

    @Test
    void blockHeightZeroUsesTheGenesisRoute() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"height\":0,\"hash\":\"genesis\",\"time\":0}"));

        assertEquals(0, client.getBlock("local", new BlockId(0)).height);

        assertEquals("/api/v1/block/local/0", takeRequest().getPath());
    }

    @ParameterizedTest
    @ValueSource(strings = {"data", "json", "text"})
    void casNotFoundStillReturnsNull(String kind) throws Exception {
        server.enqueue(new MockResponse().setResponseCode(404));

        Object value = kind.equals("data") ? client.getData("missing")
            : kind.equals("json") ? client.getJSON("missing") : client.getText("missing");

        assertNull(value);
        assertEquals("/api/v1/cas/" + kind + "/missing", takeRequest().getPath());
    }

    @Test
    void customHeadersApplyAcrossRequestHelpersAndRemainClientScoped() throws Exception {
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        options.baseUrl = server.url("/").toString();
        options.headerName = "Authorization";
        options.headerValue = "Bearer original";
        GatekeeperClient authenticated = createClient(options);
        authenticated.addCustomHeader("X-Tenant", "tenant");
        authenticated.addCustomHeader("authorization", "Bearer replacement");
        server.enqueue(new MockResponse().setBody("[]"));
        server.enqueue(new MockResponse().setBody("bytes"));
        server.enqueue(new MockResponse().setBody("\"text\""));
        server.enqueue(new MockResponse().setBody(fixture("snapshot").toString()));
        server.enqueue(new MockResponse().setBody("\"cid\""));
        authenticated.getQueue("local");
        authenticated.getData("cid");
        authenticated.getText("cid");
        IndexExportRequest export = new IndexExportRequest();
        export.mode = "snapshot";
        authenticated.exportIndex(export);
        authenticated.addText("text");
        for (int i = 0; i < 5; i++) {
            RecordedRequest request = takeRequest();
            assertEquals(List.of("Bearer replacement"), request.getHeaders().values("Authorization"));
            assertEquals("tenant", request.getHeader("X-Tenant"));
        }

        server.enqueue(new MockResponse().setBody("{}"));
        client.getJSON("cid");
        RecordedRequest other = takeRequest();
        assertNull(other.getHeader("Authorization"));
        assertNull(other.getHeader("X-Tenant"));

        authenticated.removeCustomHeader("x-tenant");
        server.enqueue(new MockResponse().setBody("{}"));
        authenticated.getJSON("cid");
        RecordedRequest removed = takeRequest();
        assertNull(removed.getHeader("X-Tenant"));
        assertEquals("Bearer replacement", removed.getHeader("Authorization"));
    }

    @Test
    void currentStatusResponseStillDecodes() throws Exception {
        server.enqueue(new MockResponse().setBody(fixture("status").toString()));

        var status = client.getStatus();

        assertEquals(12, status.uptimeSeconds);
        assertEquals(1, status.dids.total);
        assertEquals(0, status.dids.byType.assets);
        assertEquals(4294967296L, status.memoryUsage.rss);
        assertEquals("/api/v1/status", takeRequest().getPath());
    }

    private JsonNode fixture(String name) throws Exception {
        try (InputStream input = getClass().getResourceAsStream("/gatekeeper-responses.json")) {
            assertNotNull(input);
            return mapper.readTree(input).get(name);
        }
    }

    private GatekeeperClient createClient(GatekeeperClientOptions options) {
        GatekeeperClient created = new GatekeeperClient(options);
        clients.add(created);
        return created;
    }

    private RecordedRequest takeRequest() throws InterruptedException {
        RecordedRequest request = server.takeRequest(5, TimeUnit.SECONDS);
        assertNotNull(request, "Expected a Gatekeeper HTTP request");
        return request;
    }
}
