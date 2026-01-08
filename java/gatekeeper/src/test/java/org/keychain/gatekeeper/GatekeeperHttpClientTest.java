package org.keychain.gatekeeper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

class GatekeeperHttpClientTest {
    private MockWebServer server;
    private GatekeeperHttpClient client;
    private ObjectMapper mapper;

    @BeforeEach
    void setup() throws Exception {
        server = new MockWebServer();
        server.start();
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        options.baseUrl = server.url("/").toString().replaceAll("/$", "");
        client = new GatekeeperHttpClient(options);
        mapper = new ObjectMapper();
    }

    @AfterEach
    void teardown() throws Exception {
        server.shutdown();
    }

    @Test
    void createDidPostsOperation() throws Exception {
        server.enqueue(new MockResponse().setBody("\"did:test:123\"").setResponseCode(200));

        Operation op = new Operation();
        op.type = "create";
        String did = client.createDID(op);

        var recorded = server.takeRequest();
        assertEquals("POST", recorded.getMethod());
        assertEquals("/api/v1/did", recorded.getPath());
        assertEquals("did:test:123", did);
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
        assertTrue(recorded.getPath().startsWith("/api/v1/did/did:test:abc?"));
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
        assertTrue(client.updateDID(op));

        Operation del = new Operation();
        del.type = "delete";
        assertTrue(client.deleteDID(del));

        var updateReq = server.takeRequest();
        assertEquals("POST", updateReq.getMethod());
        assertEquals("/api/v1/did", updateReq.getPath());

        var deleteReq = server.takeRequest();
        assertEquals("POST", deleteReq.getMethod());
        assertEquals("/api/v1/did", deleteReq.getPath());
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
    void errorsThrowGatekeeperClientException() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(400).setBody("{\"type\":\"Invalid\",\"message\":\"bad\"}"));

        Operation op = new Operation();
        op.type = "create";

        GatekeeperClientException error = assertThrows(GatekeeperClientException.class, () -> client.createDID(op));
        assertEquals(400, error.statusCode);
        assertNotNull(error.error);
        assertEquals("Invalid", error.error.type);
    }
}
