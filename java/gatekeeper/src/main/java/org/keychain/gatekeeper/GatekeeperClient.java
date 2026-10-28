package org.keychain.gatekeeper;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.EOFException;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.ProtocolException;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.CancellationException;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLException;
import okhttp3.Call;
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
import org.keychain.gatekeeper.model.IndexExportRequest;
import org.keychain.gatekeeper.model.IndexExportResponse;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ProcessEventsResult;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.gatekeeper.model.VerifyDbOptions;
import org.keychain.gatekeeper.model.VerifyDbResult;

public class GatekeeperClient implements GatekeeperInterface, AutoCloseable {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final MediaType OCTET_STREAM = MediaType.get("application/octet-stream");
    private static final MediaType TEXT_PLAIN = MediaType.get("text/plain; charset=utf-8");
    private static final Set<Integer> RETRYABLE_STATUSES = Set.of(408, 425, 429, 500, 502, 503, 504);

    private final OkHttpClient http;
    private final ObjectMapper mapper;
    private final HttpUrl baseUrl;
    private final Map<String, String> customHeaders = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    private final Object lifecycleLock = new Object();
    private final Set<Call> activeCalls = new HashSet<>();
    private boolean closed;
    private Runnable removeCancellationListener = () -> {};

    public GatekeeperClient(GatekeeperClientOptions options) {
        Objects.requireNonNull(options, "options is required");
        this.mapper = new ObjectMapper()
            .setDefaultPropertyInclusion(
                JsonInclude.Value.construct(JsonInclude.Include.NON_NULL, JsonInclude.Include.ALWAYS)
            );
        String base = options.url != null ? options.url : options.baseUrl;
        if (base == null) {
            throw new IllegalArgumentException("baseUrl is required");
        }
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
        Duration callTimeout = options.callTimeout != null ? options.callTimeout : Duration.ofSeconds(60);
        long callTimeoutMillis;
        try {
            callTimeoutMillis = callTimeout.toMillis();
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException("callTimeout is too large", e);
        }
        if (callTimeoutMillis <= 0 || callTimeoutMillis > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("callTimeout must be between 1 and 2147483647 milliseconds");
        }

        this.http = new OkHttpClient.Builder()
            .connectTimeout(connectTimeout)
            .readTimeout(readTimeout)
            .callTimeout(callTimeoutMillis, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .addNetworkInterceptor(chain -> {
                Response response = chain.proceed(chain.request());
                // Keep 503 retries in the readiness loop without bypassing normal response decoding.
                return response.code() == 503
                    ? response.newBuilder().header("Retry-After", "1").build() : response;
            })
            .build();

        if (options.headerName != null && options.headerValue != null) {
            customHeaders.put(options.headerName, options.headerValue);
        }

        try {
            if (options.cancellation != null) {
                synchronized (lifecycleLock) {
                    removeCancellationListener = options.cancellation.onCancel(this::close);
                }
            }
            checkOpen();
            if (Boolean.TRUE.equals(options.waitUntilReady)) {
                waitUntilReady(options);
            }
            checkOpen();
        } catch (RuntimeException | Error e) {
            close();
            throw e;
        }
    }

    public synchronized void addCustomHeader(String header, String value) {
        customHeaders.put(header, value);
    }

    public synchronized void removeCustomHeader(String header) {
        if (header != null) {
            customHeaders.remove(header);
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
        try {
            return probeReadiness();
        } catch (RuntimeException e) {
            if (isRetryableFailure(e)) {
                return false;
            }
            throw e;
        }
    }

    private boolean probeReadiness() {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("ready")
            .build();
        JsonNode ready = executeRequest(new Request.Builder().url(url).get().build(), response ->
            mapper.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .readValue(response.body() != null ? response.body().string() : ""));
        if (ready == null || !ready.isBoolean()) {
            throw new IllegalStateException("Gatekeeper readiness response must be a boolean");
        }
        return ready.booleanValue();
    }

    public void waitUntilReady(GatekeeperClientOptions options) {
        Objects.requireNonNull(options, "options is required");
        Runnable removeListener = options.cancellation != null
            ? options.cancellation.onCancel(this::close) : () -> {};
        try {
            waitForReadiness(options);
        } finally {
            removeListener.run();
        }
    }

    private void waitForReadiness(GatekeeperClientOptions options) {
        int intervalSeconds = options.intervalSeconds != null ? options.intervalSeconds : 5;
        boolean chatty = Boolean.TRUE.equals(options.chatty);
        int becomeChattyAfter = options.becomeChattyAfter != null ? options.becomeChattyAfter : 0;
        int maxRetries = options.maxRetries != null ? options.maxRetries : 0;
        long attempts = 0;

        if (chatty) {
            System.out.println("Connecting to gatekeeper at " + baseUrl);
        }

        while (true) {
            checkOpen();
            attempts += 1;
            RuntimeException lastFailure = null;
            boolean ready;
            try {
                ready = probeReadiness();
            } catch (RuntimeException e) {
                if (!isRetryableFailure(e)) {
                    throw e;
                }
                lastFailure = e;
                ready = false;
            }
            if (ready) {
                checkOpen();
                if (chatty) {
                    System.out.println("Gatekeeper service is ready!");
                }
                return;
            }

            if (chatty) {
                System.out.println("Waiting for Gatekeeper to be ready...");
            }

            if (maxRetries > 0 && attempts > maxRetries) {
                throw new IllegalStateException("Gatekeeper did not become ready after " + attempts + " attempts", lastFailure);
            }
            if (!chatty && becomeChattyAfter > 0 && attempts > becomeChattyAfter) {
                System.out.println("Connecting to gatekeeper at " + baseUrl);
                chatty = true;
            }

            waitForRetry(Math.max(0, intervalSeconds) * 1000L);
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
    public IndexExportResponse exportIndex(IndexExportRequest request) {
        return postJson("/index/export", Objects.requireNonNull(request, "request is required"), IndexExportResponse.class);
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
    public boolean clearQueue(String registry, java.util.List<?> eventsOrHashes) {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("queue")
            .addPathSegment(registry)
            .addPathSegment("clear")
            .build();
        return postJson(url, eventsOrHashes, Boolean.class);
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
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("block")
            .addPathSegment(registry)
            .build();
        return postJson(url, blockInfo, Boolean.class);
    }

    @Override
    public String generateDID(Operation operation) {
        return postJson("/did/generate", operation, String.class);
    }

    private <T> T postJson(String path, Object body, Class<T> responseType) {
        HttpUrl url = baseUrl.newBuilder().addPathSegments(trimLeadingSlash(path)).build();
        return postJson(url, body, responseType);
    }

    private <T> T postJson(HttpUrl url, Object body, Class<T> responseType) {
        Request request = buildPostRequest(url, body);
        return execute(request, responseType);
    }

    private <T> T postJsonType(String path, Object body, TypeReference<T> typeRef) {
        HttpUrl url = baseUrl.newBuilder().addPathSegments(trimLeadingSlash(path)).build();
        Request request = buildPostRequest(url, body);
        return execute(request, typeRef);
    }

    private Request buildPostRequest(HttpUrl url, Object body) {
        try {
            String json = mapper.writeValueAsString(body);
            RequestBody requestBody = RequestBody.create(json, JSON);
            return new Request.Builder()
                    .url(url)
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
        return executeRequest(request, response -> {
            String body = response.body() != null ? response.body().string() : "";

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
        });
    }

    private <T> T execute(Request request, TypeReference<T> typeRef) {
        return executeRequest(request, response -> {
            String body = response.body() != null ? response.body().string() : "";
            if (body.isEmpty()) {
                return null;
            }
            return mapper.readValue(body, typeRef);
        });
    }

    private byte[] getBytes(HttpUrl url) {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();
        return executeRequest(request, response -> {
            ResponseBody responseBody = response.body();
            byte[] bytes = responseBody != null ? responseBody.bytes() : new byte[0];
            return bytes;
        });
    }

    @FunctionalInterface
    private interface ResponseReader<T> {
        T read(Response response) throws IOException;
    }

    private <T> T executeRequest(Request request, ResponseReader<T> reader) {
        Request prepared = withCustomHeaders(request);
        Call call;
        synchronized (lifecycleLock) {
            checkOpen();
            call = http.newCall(prepared);
            activeCalls.add(call);
        }
        try (Response response = call.execute()) {
            checkOpen();
            if (!response.isSuccessful()) {
                throw httpFailure(response);
            }
            T result = reader.read(response);
            checkOpen();
            return result;
        } catch (RuntimeException e) {
            checkOpen();
            throw e;
        } catch (IOException e) {
            synchronized (lifecycleLock) {
                if (closed || Thread.currentThread().isInterrupted()) {
                    CancellationException cancelled = new CancellationException("Gatekeeper request cancelled");
                    cancelled.initCause(e);
                    throw cancelled;
                }
            }
            throw new IllegalStateException("Gatekeeper request failed", e);
        } finally {
            synchronized (lifecycleLock) {
                activeCalls.remove(call);
            }
        }
    }

    private static GatekeeperClientException httpFailure(Response response) {
        try {
            String body = response.body() != null ? response.body().string() : "";
            GatekeeperError error = GatekeeperErrorParser.parse(body);
            return new GatekeeperClientException("Gatekeeper request failed", response.code(), error);
        } catch (IOException e) {
            GatekeeperClientException failure = new GatekeeperClientException("Gatekeeper request failed", response.code(), null);
            failure.initCause(e);
            return failure;
        }
    }

    private void checkOpen() {
        synchronized (lifecycleLock) {
            if (closed || Thread.currentThread().isInterrupted()) {
                throw new CancellationException("Gatekeeper client is closed or the thread was interrupted");
            }
        }
    }

    private void waitForRetry(long millis) {
        synchronized (lifecycleLock) {
            checkOpen();
            long duration = TimeUnit.MILLISECONDS.toNanos(millis);
            long started = System.nanoTime();
            long remaining = duration;
            while (remaining > 0) {
                try {
                    TimeUnit.NANOSECONDS.timedWait(lifecycleLock, remaining);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while waiting for Gatekeeper readiness", e);
                }
                checkOpen();
                remaining = duration - (System.nanoTime() - started);
            }
        }
    }

    private static boolean isRetryableFailure(RuntimeException error) {
        if (error instanceof GatekeeperClientException) {
            return RETRYABLE_STATUSES.contains(((GatekeeperClientException) error).statusCode);
        }
        if (error instanceof CancellationException) {
            return false;
        }
        boolean retryable = false;
        for (Throwable cause = error.getCause(); cause != null; cause = cause.getCause()) {
            // shortcut: DNS failures stay permanent until a resolver exposes temporary failure codes.
            if (cause instanceof JsonProcessingException || cause instanceof SSLException
                || cause instanceof ProtocolException || cause instanceof UnknownHostException) {
                return false;
            }
            if (cause instanceof SocketException || cause instanceof InterruptedIOException || cause instanceof EOFException) {
                retryable = true;
            }
        }
        return retryable;
    }

    @Override
    public final void close() {
        List<Call> calls;
        Runnable removeListener;
        synchronized (lifecycleLock) {
            if (closed) {
                return;
            }
            closed = true;
            calls = new ArrayList<>(activeCalls);
            removeListener = removeCancellationListener;
            removeCancellationListener = () -> {};
            lifecycleLock.notifyAll();
        }
        calls.forEach(Call::cancel);
        removeListener.run();
        http.connectionPool().evictAll();
        http.dispatcher().executorService().shutdown();
    }

    private String getText(HttpUrl url) {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();
        return execute(request, String.class);
    }

    private synchronized Request withCustomHeaders(Request request) {
        Request.Builder builder = request.newBuilder();
        customHeaders.forEach(builder::header);
        return builder.build();
    }

    private static String trimLeadingSlash(String path) {
        if (path == null) {
            return "";
        }
        return path.startsWith("/") ? path.substring(1) : path;
    }
}
