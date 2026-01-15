package org.keychain.gatekeeper;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.keychain.gatekeeper.model.BlockId;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.GatekeeperError;
import org.keychain.gatekeeper.model.GatekeeperEvent;
import org.keychain.gatekeeper.model.GetDIDOptions;
import org.keychain.gatekeeper.model.GetStatusResult;
import org.keychain.gatekeeper.model.ImportBatchResult;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ProcessEventsResult;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.gatekeeper.model.VerifyDbOptions;
import org.keychain.gatekeeper.model.VerifyDbResult;

public class GatekeeperClient implements GatekeeperInterface {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final MediaType OCTET_STREAM = MediaType.get("application/octet-stream");
    private static final MediaType TEXT_PLAIN = MediaType.get("text/plain; charset=utf-8");

    private final OkHttpClient http;
    private final ObjectMapper mapper;
    private final HttpUrl baseUrl;
    private String headerName;
    private String headerValue;

    public GatekeeperClient(GatekeeperClientOptions options) {
        Objects.requireNonNull(options, "options is required");
        this.mapper = new ObjectMapper()
            .setDefaultPropertyInclusion(
                JsonInclude.Value.construct(JsonInclude.Include.NON_NULL, JsonInclude.Include.ALWAYS)
            );
        String base = options.url != null ? options.url : options.baseUrl;
        if (base.endsWith("/api/v1")) {
            base = base.substring(0, base.length() - "/api/v1".length());
        } else if (base.endsWith("/api/v1/")) {
            base = base.substring(0, base.length() - "/api/v1/".length());
        }
        this.baseUrl = HttpUrl.parse(base + "/api/v1");
        if (this.baseUrl == null) {
            throw new IllegalArgumentException("Invalid baseUrl");
        }

        Duration connectTimeout = options.connectTimeout != null ? options.connectTimeout : Duration.ofSeconds(10);
        Duration readTimeout = options.readTimeout != null ? options.readTimeout : Duration.ofSeconds(30);

        this.http = new OkHttpClient.Builder()
            .connectTimeout(connectTimeout)
            .readTimeout(readTimeout)
            .build();

        this.headerName = options.headerName;
        this.headerValue = options.headerValue;

        if (Boolean.TRUE.equals(options.waitUntilReady)) {
            waitUntilReady(options);
        }
    }

    public void addCustomHeader(String header, String value) {
        this.headerName = header;
        this.headerValue = value;
    }

    public void removeCustomHeader(String header) {
        if (header != null && header.equals(this.headerName)) {
            this.headerName = null;
            this.headerValue = null;
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public java.util.List<String> listRegistries() {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("registries")
            .build();
        return getJson(url, java.util.List.class);
    }

    public boolean isReady() {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("ready")
            .build();
        try {
            Boolean ok = getJson(url, Boolean.class);
            return Boolean.TRUE.equals(ok);
        } catch (Exception e) {
            return false;
        }
    }

    public void waitUntilReady(GatekeeperClientOptions options) {
        int intervalSeconds = options.intervalSeconds != null ? options.intervalSeconds : 5;
        boolean chatty = Boolean.TRUE.equals(options.chatty);
        int becomeChattyAfter = options.becomeChattyAfter != null ? options.becomeChattyAfter : 0;
        int maxRetries = options.maxRetries != null ? options.maxRetries : 0;
        int retries = 0;

        if (chatty) {
            System.out.println("Connecting to gatekeeper at " + baseUrl);
        }

        while (true) {
            if (isReady()) {
                if (chatty) {
                    System.out.println("Gatekeeper service is ready!");
                }
                return;
            }

            if (chatty) {
                System.out.println("Waiting for Gatekeeper to be ready...");
            }

            retries += 1;
            if (maxRetries > 0 && retries > maxRetries) {
                return;
            }
            if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
                System.out.println("Connecting to gatekeeper at " + baseUrl);
                chatty = true;
            }

            try {
                //noinspection BusyWait
                Thread.sleep(Math.max(1, intervalSeconds) * 1000L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    @Override
    public boolean resetDb() {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("db")
            .addPathSegment("reset")
            .build();
        return getJson(url, Boolean.class);
    }

    @Override
    public VerifyDbResult verifyDb(VerifyDbOptions options) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("db")
            .addPathSegment("verify")
            .build();
        return getJson(url, VerifyDbResult.class);
    }

    public int getVersion() {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("version")
            .build();
        Integer version = getJson(url, Integer.class);
        return version != null ? version : 0;
    }

    public GetStatusResult getStatus() {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("status")
            .build();
        return getJson(url, GetStatusResult.class);
    }

    @Override
    public String createDID(Operation operation) {
        return postJson("/did", operation, String.class);
    }

    @Override
    public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
        HttpUrl.Builder url = baseUrl.newBuilder().addPathSegment("did").addPathSegment(did);
        if (options != null) {
            if (options.versionTime != null) {
                url.addQueryParameter("versionTime", options.versionTime);
            }
            if (options.versionSequence != null) {
                url.addQueryParameter("versionSequence", options.versionSequence.toString());
            }
            if (options.confirm != null) {
                url.addQueryParameter("confirm", options.confirm.toString());
            }
            if (options.verify != null) {
                url.addQueryParameter("verify", options.verify.toString());
            }
        }
        return getJson(url.build(), MdipDocument.class);
    }

    @Override
    public boolean updateDID(Operation operation) {
        return postJson("/did", operation, Boolean.class);
    }

    @Override
    public boolean deleteDID(Operation operation) {
        return postJson("/did", operation, Boolean.class);
    }

    @Override
    public Object getDIDs(GetDIDOptions options) {
        Object body = options != null ? options : new HashMap<String, Object>();
        return postJson("/dids", body, Object.class);
    }

    @Override
    public java.util.List<java.util.List<GatekeeperEvent>> exportDIDs(java.util.List<String> dids) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("dids", dids);
        return postJsonType("/dids/export", payload, new TypeReference<>() {});
    }

    @Override
    public ImportBatchResult importDIDs(java.util.List<java.util.List<GatekeeperEvent>> dids) {
        return postJson("/dids/import", dids, ImportBatchResult.class);
    }

    @Override
    public boolean removeDIDs(java.util.List<String> dids) {
        return postJson("/dids/remove", dids, Boolean.class);
    }

    @Override
    public java.util.List<GatekeeperEvent> exportBatch(java.util.List<String> dids) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("dids", dids);
        return postJsonType("/batch/export", payload, new TypeReference<>() {});
    }

    @Override
    public ImportBatchResult importBatch(java.util.List<GatekeeperEvent> batch) {
        return postJson("/batch/import", batch, ImportBatchResult.class);
    }

    @Override
    public ProcessEventsResult processEvents() {
        Map<String, Object> payload = new HashMap<>();
        return postJson("/events/process", payload, ProcessEventsResult.class);
    }

    @Override
    public java.util.List<Operation> getQueue(String registry) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("queue")
            .addPathSegment(registry)
            .build();
        return getJsonType(url, new TypeReference<>() {});
    }

    @Override
    public boolean clearQueue(String registry, java.util.List<Operation> events) {
        String path = "/queue/" + registry + "/clear";
        return postJson(path, events, Boolean.class);
    }

    @Override
    public String addData(byte[] data) {
        return postBytes("/cas/data", data, OCTET_STREAM);
    }

    @Override
    public byte[] getData(String cid) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("cas")
            .addPathSegment("data")
            .addPathSegment(cid)
            .build();
        try {
            return getBytes(url);
        } catch (GatekeeperClientException e) {
            if (e.statusCode == 404) {
                return null;
            }
            throw e;
        }
    }

    @Override
    public String addJSON(Object json) {
        return postJson("/cas/json", json, String.class);
    }

    @Override
    public Object getJSON(String cid) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("cas")
            .addPathSegment("json")
            .addPathSegment(cid)
            .build();
        try {
            return getJson(url, Object.class);
        } catch (GatekeeperClientException e) {
            if (e.statusCode == 404) {
                return null;
            }
            throw e;
        }
    }

    @Override
    public String addText(String text) {
        return postBytes("/cas/text", text != null ? text.getBytes(StandardCharsets.UTF_8) : new byte[0], TEXT_PLAIN);
    }

    @Override
    public String getText(String cid) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("cas")
            .addPathSegment("text")
            .addPathSegment(cid)
            .build();
        try {
            return getText(url);
        } catch (GatekeeperClientException e) {
            if (e.statusCode == 404) {
                return null;
            }
            throw e;
        }
    }

    @Override
    public BlockInfo getBlock(String registry) {
        return getBlock(registry, null);
    }

    @Override
    public BlockInfo getBlock(String registry, BlockId blockId) {
        HttpUrl.Builder builder = baseUrl.newBuilder()
            .addPathSegment("block")
            .addPathSegment(registry);
        if (blockId != null && blockId.value != null) {
            builder.addPathSegment(blockId.value.toString());
        } else {
            builder.addPathSegment("latest");
        }
        try {
            return getJson(builder.build(), BlockInfo.class);
        } catch (GatekeeperClientException e) {
            if (e.statusCode == 404) {
                return null;
            }
            throw e;
        }
    }

    @Override
    public boolean addBlock(String registry, BlockInfo blockInfo) {
        String path = "/block/" + registry;
        return postJson(path, blockInfo, Boolean.class);
    }

    @Override
    public String generateDID(Operation operation) {
        return postJson("/did/generate", operation, String.class);
    }

    private <T> T postJson(String path, Object body, Class<T> responseType) {
        Request request = buildPostRequest(path, body);
        return execute(request, responseType);
    }

    private <T> T postJsonType(String path, Object body, TypeReference<T> typeRef) {
        Request request = buildPostRequest(path, body);
        return execute(request, typeRef);
    }

    private Request buildPostRequest(String path, Object body) {
        try {
            String json = mapper.writeValueAsString(body);
            RequestBody requestBody = RequestBody.create(json, JSON);
            return new Request.Builder()
                    .url(baseUrl.newBuilder().addPathSegments(trimLeadingSlash(path)).build())
                    .post(requestBody)
                    .build();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to serialize request", e);
        }
    }

    private String postBytes(String path, byte[] body, MediaType contentType) {
        RequestBody requestBody = RequestBody.create(body != null ? body : new byte[0], contentType);
        Request request = new Request.Builder()
            .url(baseUrl.newBuilder().addPathSegments(trimLeadingSlash(path)).build())
            .post(requestBody)
            .build();
        return execute(request, String.class);
    }

    private <T> T getJson(HttpUrl url, Class<T> responseType) {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();
        return execute(request, responseType);
    }

    private <T> T getJsonType(HttpUrl url, TypeReference<T> typeRef) {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();
        return execute(request, typeRef);
    }

    private <T> T execute(Request request, Class<T> responseType) {
        Request.Builder builder = request.newBuilder();
        if (headerName != null && headerValue != null) {
            builder.addHeader(headerName, headerValue);
        }

        try (Response response = http.newCall(builder.build()).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                GatekeeperError error = GatekeeperErrorParser.parse(body);
                throw new GatekeeperClientException("Gatekeeper request failed", response.code(), error);
            }

            if (responseType == String.class) {
                try {
                    return responseType.cast(mapper.readValue(body, String.class));
                } catch (Exception e) {
                    return responseType.cast(body);
                }
            }

            if (body.isEmpty()) {
                return null;
            }

            return mapper.readValue(body, responseType);
        } catch (IOException e) {
            throw new IllegalStateException("Gatekeeper request failed", e);
        }
    }

    private <T> T execute(Request request, TypeReference<T> typeRef) {
        Request.Builder builder = request.newBuilder();
        if (headerName != null && headerValue != null) {
            builder.addHeader(headerName, headerValue);
        }

        try (Response response = http.newCall(builder.build()).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                GatekeeperError error = GatekeeperErrorParser.parse(body);
                throw new GatekeeperClientException("Gatekeeper request failed", response.code(), error);
            }
            if (body.isEmpty()) {
                return null;
            }
            return mapper.readValue(body, typeRef);
        } catch (IOException e) {
            throw new IllegalStateException("Gatekeeper request failed", e);
        }
    }

    private byte[] getBytes(HttpUrl url) {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();
        Request.Builder builder = request.newBuilder();
        if (headerName != null && headerValue != null) {
            builder.addHeader(headerName, headerValue);
        }

        try (Response response = http.newCall(builder.build()).execute()) {
            ResponseBody responseBody = response.body();
            byte[] bytes = responseBody != null ? responseBody.bytes() : new byte[0];
            if (!response.isSuccessful()) {
                String body = new String(bytes, StandardCharsets.UTF_8);
                GatekeeperError error = GatekeeperErrorParser.parse(body);
                throw new GatekeeperClientException("Gatekeeper request failed", response.code(), error);
            }
            return bytes;
        } catch (IOException e) {
            throw new IllegalStateException("Gatekeeper request failed", e);
        }
    }

    private String getText(HttpUrl url) {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();
        return execute(request, String.class);
    }

    private static String trimLeadingSlash(String path) {
        if (path == null) {
            return "";
        }
        return path.startsWith("/") ? path.substring(1) : path;
    }
}
