package org.keychain.gatekeeper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.ServerSocket;
import java.net.SocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;
import java.util.stream.Stream;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.SocketPolicy;
import okio.Buffer;
import okio.GzipSink;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.gatekeeper.model.Operation;

@Timeout(15)
class GatekeeperClientLifecycleTest {
    private MockWebServer server;
    private final List<GatekeeperClient> clients = new ArrayList<>();
    private final AtomicReference<Thread> workerThread = new AtomicReference<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "gatekeeper-lifecycle-test");
        workerThread.set(thread);
        return thread;
    });

    @BeforeEach
    void setup() throws Exception {
        server = new MockWebServer();
        server.start(InetAddress.getByName("127.0.0.1"), 0);
    }

    @AfterEach
    void teardown() throws Exception {
        try {
            clients.forEach(GatekeeperClient::close);
        } finally {
            worker.shutdownNow();
            try {
                server.shutdown();
            } finally {
                assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS));
            }
        }
    }

    @Test
    void readinessWaitSucceedsAfterFalse() {
        server.enqueue(new MockResponse().setBody("false"));
        server.enqueue(new MockResponse().setBody("true"));
        try (GatekeeperClient client = new GatekeeperClient(waitOptions())) {
            assertEquals(2, server.getRequestCount());
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {408, 425, 429, 500, 502, 503, 504})
    void readinessRetriesTransientStatuses(int status) {
        server.enqueue(new MockResponse().setResponseCode(status));
        server.enqueue(new MockResponse().setBody("true"));
        try (GatekeeperClient client = new GatekeeperClient(waitOptions())) {
            assertEquals(2, server.getRequestCount());
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 405, 501, 505})
    void readinessRejectsPermanentStatusesImmediately(int status) {
        server.enqueue(new MockResponse().setResponseCode(status).setBody("configuration error"));

        GatekeeperClientException failure = assertThrows(GatekeeperClientException.class,
            () -> new GatekeeperClient(waitOptions()));

        assertEquals(status, failure.statusCode);
        assertEquals("configuration error", failure.error.message);
        assertEquals(1, server.getRequestCount());
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "\"true\"", "not json", "", "true false"})
    void readinessRejectsInvalidResponsesRatherThanRetrying(String body) {
        server.enqueue(new MockResponse().setBody(body));

        assertThrows(IllegalStateException.class, () -> new GatekeeperClient(waitOptions()));

        assertEquals(1, server.getRequestCount());
    }

    @Test
    void compressedHttpErrorsPreserveTheirStructuredDetails() throws Exception {
        Buffer compressed = new Buffer();
        try (GzipSink gzip = new GzipSink(compressed)) {
            Buffer json = new Buffer().writeUtf8("{\"type\":\"Invalid\",\"message\":\"configuration error\"}");
            gzip.write(json, json.size());
        }
        server.enqueue(new MockResponse().setResponseCode(400)
            .setHeader("Content-Encoding", "gzip").setBody(compressed));
        GatekeeperClient client = client(options());

        GatekeeperClientException failure = assertThrows(GatekeeperClientException.class, client::isReady);

        assertEquals(400, failure.statusCode);
        assertEquals("Invalid", failure.error.type);
        assertEquals("configuration error", failure.error.message);
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void readinessExhaustionThrowsAfterInitialAttemptAndConfiguredRetries() {
        server.enqueue(new MockResponse().setBody("false"));
        server.enqueue(new MockResponse().setBody("false"));

        IllegalStateException failure = assertThrows(IllegalStateException.class,
            () -> new GatekeeperClient(waitOptions()));

        assertTrue(failure.getMessage().contains("2 attempts"));
        assertEquals(2, server.getRequestCount());
    }

    @Test
    void readinessExhaustionRetainsTheLastTransportFailure() {
        server.enqueue(new MockResponse().setResponseCode(503));
        server.enqueue(new MockResponse().setResponseCode(503));

        IllegalStateException failure = assertThrows(IllegalStateException.class,
            () -> new GatekeeperClient(waitOptions()));

        GatekeeperClientException cause = assertInstanceOf(GatekeeperClientException.class, failure.getCause());
        assertEquals(503, cause.statusCode);
        assertEquals(2, server.getRequestCount());
    }

    @ParameterizedTest
    @MethodSource("invalidDeadlines")
    void invalidDeadlinesFailBeforeRequests(Duration deadline) {
        GatekeeperClientOptions options = waitOptions();
        options.callTimeout = deadline;

        assertThrows(IllegalArgumentException.class, () -> new GatekeeperClient(options));

        assertEquals(0, server.getRequestCount());
    }

    private static Stream<Duration> invalidDeadlines() {
        return Stream.of(Duration.ZERO, Duration.ofNanos(1), Duration.ofMillis(-1),
            Duration.ofMillis((long) Integer.MAX_VALUE + 1), Duration.ofSeconds(Long.MAX_VALUE));
    }

    @Test
    void malformedUrlFailsBeforeRequests() {
        GatekeeperClientOptions options = waitOptions();
        options.url = "invalid";

        assertThrows(IllegalArgumentException.class, () -> new GatekeeperClient(options));

        assertEquals(0, server.getRequestCount());
    }

    @Test
    void connectionRefusalIsRetryable() throws Exception {
        GatekeeperClientOptions options = options();
        try (ServerSocket closedEndpoint = new ServerSocket(0)) {
            options.baseUrl = "http://127.0.0.1:" + closedEndpoint.getLocalPort();
        }
        GatekeeperClient client = client(options);

        assertFalse(client.isReady());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void fallsBackToAnotherRouteBeforeSending(boolean write) throws Exception {
        withUnavailableProxy(true, () -> {
            server.enqueue(new MockResponse().setBody(write ? "\"did:test:fallback\"" : "true"));
            GatekeeperClient client = client(options());
            if (write) {
                Operation operation = new Operation();
                operation.type = "create";
                assertEquals("did:test:fallback", client.createDID(operation));
            } else {
                assertTrue(client.isReady());
            }
            assertEquals(1, server.getRequestCount());
        });
    }

    @Test
    void tlsHandshakeFailuresArePermanent() throws Exception {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(new KeyManager[0], null, null);
        server.useHttps(context.getSocketFactory(), false);
        GatekeeperClientOptions options = waitOptions();
        // Use one route to assert the TLS error as the immediate cause.
        options.baseUrl = server.url("/").newBuilder().host("127.0.0.1").build().toString();

        IllegalStateException failure = assertThrows(IllegalStateException.class,
            () -> new GatekeeperClient(options));

        assertInstanceOf(SSLException.class, failure.getCause());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void tlsFailuresRemainPermanentAcrossConnectionFallback(boolean unavailableFirst) throws Exception {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(new KeyManager[0], null, null);
        server.useHttps(context.getSocketFactory(), false);
        withUnavailableProxy(unavailableFirst, () -> {
            GatekeeperClient client = client(options());

            assertThrows(IllegalStateException.class, client::isReady);
        });
    }

    @Test
    void completeCallDeadlineBoundsStalledResponseBodies() {
        server.enqueue(new MockResponse().setBody("t").setHeader("Content-Length", 4));
        GatekeeperClientOptions options = options();
        options.callTimeout = Duration.ofMillis(500);
        options.readTimeout = Duration.ofSeconds(5);
        GatekeeperClient client = client(options);

        assertTimeoutPreemptively(Duration.ofSeconds(3), () -> assertFalse(client.isReady()));
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void readinessRetriesATimedOutProbe() {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
        server.enqueue(new MockResponse().setBody("true"));
        GatekeeperClientOptions options = waitOptions();
        options.callTimeout = Duration.ofMillis(500);
        try (GatekeeperClient client = new GatekeeperClient(options)) {
            assertEquals(2, server.getRequestCount());
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {408, 503})
    void failedWritesAreNotAutomaticallyRetried(int status) {
        server.enqueue(new MockResponse().setResponseCode(status).setHeader("Retry-After", "0"));
        server.enqueue(new MockResponse().setBody("\"did:test:unexpected-retry\""));
        GatekeeperClient client = client(options());
        Operation operation = new Operation();
        operation.type = "create";

        GatekeeperClientException failure = assertThrows(GatekeeperClientException.class,
            () -> client.createDID(operation));

        assertEquals(status, failure.statusCode);
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void disconnectedWriteAcknowledgementsAreNotAutomaticallyRetried() {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST));
        server.enqueue(new MockResponse().setBody("\"did:test:unexpected-retry\""));
        GatekeeperClient client = client(options());
        Operation operation = new Operation();
        operation.type = "create";

        assertThrows(IllegalStateException.class, () -> client.createDID(operation));

        assertEquals(1, server.getRequestCount());
    }

    @Test
    void existingWriteRedirectHandlingIsPreserved() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(307)
            .setHeader("Location", server.url("/api/v1/redirected")));
        server.enqueue(new MockResponse().setBody("\"did:test:redirected\""));
        GatekeeperClient client = client(options());
        Operation operation = new Operation();
        operation.type = "create";

        assertEquals("did:test:redirected", client.createDID(operation));

        var first = server.takeRequest(5, TimeUnit.SECONDS);
        var redirected = server.takeRequest(5, TimeUnit.SECONDS);
        assertNotNull(first);
        assertNotNull(redirected);
        assertEquals("POST", redirected.getMethod());
        assertEquals("/api/v1/redirected", redirected.getPath());
        assertEquals(first.getBody().readUtf8(), redirected.getBody().readUtf8());
    }

    @Test
    void alreadyCancelledConstructionCannotSendRequests() {
        GatekeeperClientOptions options = waitOptions();
        options.cancellation = new GatekeeperClientCancellation();
        options.cancellation.cancel();

        assertThrows(CancellationException.class, () -> new GatekeeperClient(options));

        assertEquals(0, server.getRequestCount());
    }

    @Test
    void cancellationStopsAStalledConstructorRequest() throws Exception {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
        GatekeeperClientOptions options = waitOptions();
        options.cancellation = new GatekeeperClientCancellation();
        Future<?> result = worker.submit(() -> {
            try (GatekeeperClient client = new GatekeeperClient(options)) {
                throw new AssertionError("Cancelled construction succeeded");
            }
        });
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));

        options.cancellation.cancel();

        assertInstanceOf(CancellationException.class, failure(result));
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void fixtureCleanupReleasesAnUnreturnedConstructor() throws Exception {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
        GatekeeperClientOptions options = waitOptions();
        options.callTimeout = Duration.ofSeconds(8);
        Future<?> result = worker.submit(() -> {
            try (GatekeeperClient client = new GatekeeperClient(options)) {
                throw new AssertionError("Stalled construction succeeded");
            }
        });

        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
        assertFalse(result.isDone());
        // Teardown must release socket I/O even though no client has been returned.
    }

    @Test
    void cancellationWakesTheConstructorReadinessDelay() throws Exception {
        server.enqueue(new MockResponse().setBody("false"));
        GatekeeperClientOptions options = waitOptions();
        options.maxRetries = 0;
        options.intervalSeconds = 60;
        options.cancellation = new GatekeeperClientCancellation();
        Future<?> result = worker.submit(() -> {
            try (GatekeeperClient client = new GatekeeperClient(options)) {
                throw new AssertionError("Cancelled construction succeeded");
            }
        });
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
        awaitWorkerState(Thread.State.TIMED_WAITING);

        options.cancellation.cancel();

        assertInstanceOf(CancellationException.class, failure(result));
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void interruptionOfAReadinessDelayFailsAndRestoresInterruptStatus() throws Exception {
        server.enqueue(new MockResponse().setBody("false"));
        GatekeeperClient client = client(options());
        GatekeeperClientOptions wait = waitOptions();
        wait.intervalSeconds = 60;
        Future<?> result = worker.submit(() -> {
            try {
                client.waitUntilReady(wait);
                throw new AssertionError("Interrupted wait succeeded");
            } catch (IllegalStateException e) {
                assertTrue(Thread.currentThread().isInterrupted());
                throw e;
            }
        });
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
        awaitWorkerState(Thread.State.TIMED_WAITING);

        workerThread.get().interrupt();

        assertInstanceOf(InterruptedException.class, failure(result).getCause());
    }

    @Test
    void closeCancelsQueuedRequestAdmission() throws Exception {
        GatekeeperClient client = client(options());
        Future<?> result;
        synchronized (client) {
            result = worker.submit(client::listRegistries);
            awaitWorkerState(Thread.State.BLOCKED);
            client.close();
        }

        assertInstanceOf(CancellationException.class, failure(result));
        assertEquals(0, server.getRequestCount());
    }

    @Test
    void closingOneClientDoesNotCancelOtherClientsSharingAHandle() {
        GatekeeperClientOptions options = options();
        options.cancellation = new GatekeeperClientCancellation();
        GatekeeperClient first = client(options);
        GatekeeperClient second = client(options);
        first.close();
        server.enqueue(new MockResponse().setBody("true"));
        assertTrue(second.isReady());

        options.cancellation.cancel();
        options.cancellation.cancel();

        assertThrows(CancellationException.class, second::isReady);
        assertEquals(1, server.getRequestCount());
    }

    private GatekeeperClientOptions options() {
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        options.baseUrl = server.url("/").toString();
        return options;
    }

    private void withUnavailableProxy(boolean unavailableFirst, Runnable action) throws Exception {
        ProxySelector previous = ProxySelector.getDefault();
        InetSocketAddress unavailable;
        try (ServerSocket closedEndpoint = new ServerSocket(0)) {
            unavailable = new InetSocketAddress("127.0.0.1", closedEndpoint.getLocalPort());
        }
        ProxySelector.setDefault(new ProxySelector() {
            @Override
            public List<Proxy> select(URI uri) {
                Proxy proxy = new Proxy(Proxy.Type.HTTP, unavailable);
                return unavailableFirst ? List.of(proxy, Proxy.NO_PROXY) : List.of(Proxy.NO_PROXY, proxy);
            }

            @Override
            public void connectFailed(URI uri, SocketAddress address, IOException error) {}
        });
        try {
            action.run();
        } finally {
            ProxySelector.setDefault(previous);
        }
    }

    private GatekeeperClientOptions waitOptions() {
        GatekeeperClientOptions options = options();
        options.waitUntilReady = true;
        options.intervalSeconds = 0;
        options.maxRetries = 1;
        return options;
    }

    private GatekeeperClient client(GatekeeperClientOptions options) {
        GatekeeperClient client = new GatekeeperClient(options);
        clients.add(client);
        return client;
    }

    private Throwable failure(Future<?> result) {
        return assertThrows(ExecutionException.class, () -> result.get(3, TimeUnit.SECONDS)).getCause();
    }

    private void awaitWorkerState(Thread.State state) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            Thread thread = workerThread.get();
            if (thread != null && thread.getState() == state) {
                return;
            }
            LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(1));
        }
        throw new AssertionError("Worker never reached " + state);
    }
}
