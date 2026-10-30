# Gatekeeper Client (Java)

HTTP client for the Gatekeeper REST API.

## Usage

```java
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientCancellation;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.model.IndexExportRequest;
import org.keychain.gatekeeper.model.IndexExportResponse;
import org.keychain.gatekeeper.model.MdipDocument;

GatekeeperClientOptions options = new GatekeeperClientOptions();
options.baseUrl = "http://localhost:4224";

GatekeeperClient gatekeeper = new GatekeeperClient(options);
MdipDocument doc = gatekeeper.resolveDID("did:test:example", null);
```

## Readiness and lifecycle

Set `waitUntilReady` to wait during construction. `maxRetries` counts retries
after the initial attempt, and zero means unlimited retries. Exhaustion throws
instead of returning an unready client. `intervalSeconds` defaults to five and
can be zero for immediate retries.

Readiness retries connection failures, timeouts and HTTP 408, 425, 429, 500,
502, 503 and 504. Other HTTP errors, malformed readiness responses and TLS
failures propagate. DNS lookup failures also propagate because Java does not
reliably distinguish temporary lookup failures from an unknown hostname.
Application-level retries are limited to readiness. The client follows HTTP
redirects. The HTTP client can try another connection route before
sending a request. It does not automatically replay requests after a transmission
failure or an HTTP 408/503 response.

`callTimeout` defaults to 60 seconds and bounds a complete HTTP call, including
reading the response body. It must be at least one millisecond and no more than
2,147,483,647 milliseconds. The `connectTimeout` and `readTimeout`
controls default to 10 and 30 seconds. A call deadline does not limit the total
readiness wait across retries.

Use `close()` or try-with-resources to cancel active calls, wake readiness waits
and release the client's HTTP resources. Closing a client is permanent.
For cancellation before the constructor returns, supply a handle in the options:

```java
GatekeeperClientCancellation cancellation = new GatekeeperClientCancellation();
options.cancellation = cancellation;
options.waitUntilReady = true;
try (GatekeeperClient client = new GatekeeperClient(options)) {
    // Use the client here.
}
```

Another thread can call `cancellation.cancel()` during startup or shutdown.
Cancellation throws `CancellationException` and affects all clients using that
handle. Closing one client does not cancel other clients sharing the handle.
Interrupting a readiness delay fails the wait and preserves interrupt status.
Cancelling or timing out does not undo an operation the server may have accepted.

## Index export

`exportIndex()` supports paginated snapshots and incremental changes through
`POST /api/v1/index/export`. Requests and responses use the models in
`org.keychain.gatekeeper.model`.

```java
IndexExportRequest request = new IndexExportRequest();
request.mode = "snapshot";
request.limit = 50;
IndexExportResponse page = gatekeeper.exportIndex(request);
```

For snapshot continuation, copy both `page.cursor` and `page.checkpointCursor`
into the next snapshot request. Once the snapshot is complete, use its
`checkpointCursor` as the first changes request's `cursor`, with
`mode = "changes"`. Subsequent changes requests use the returned `cursor`.
Set `includeOperations` to request operation and removal records with changes.
Leave `checkpointCursor` unset on changes requests.

Cursors are opaque strings and must be passed back unchanged. Check
`indexEpoch` for a database reset or replacement and start a fresh snapshot
when it changes. The client returns one page per call and does not manage a
synchronization loop. A null cursor stays null in the response.

Event ordinal entries use `Long` values so millisecond timestamps fit.
Code that constructs ordinals should use long values, such as `List.of(0L)`.
Index operation sequence values also use 64-bit integers.

## Queues and custom headers

`clearQueue()` accepts either a list of operations or a list of their signature
hash strings. Registry values are encoded as individual path segments.

Multiple custom headers can be added with `addCustomHeader()`. Header names
are matched without regard to case when replacing or removing them. Removing
one header preserves the others, and headers are specific to each client.
