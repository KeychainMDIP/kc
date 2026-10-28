# Gatekeeper Client (Java)

HTTP client for the Gatekeeper REST API.

## Usage

```java
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.model.IndexExportRequest;
import org.keychain.gatekeeper.model.IndexExportResponse;
import org.keychain.gatekeeper.model.MdipDocument;

GatekeeperClientOptions options = new GatekeeperClientOptions();
options.baseUrl = "http://localhost:4224";

GatekeeperClient gatekeeper = new GatekeeperClient(options);
MdipDocument doc = gatekeeper.resolveDID("did:test:example", null);
```

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

Event ordinal entries are now `Long` values so millisecond timestamps fit.
Code that constructs ordinals should use long values, such as `List.of(0L)`.
Index operation sequence values also use 64-bit integers.

## Queues and custom headers

`clearQueue()` accepts either a list of operations or a list of their signature
hash strings. Existing operation-list calls continue to work. Registry values
are encoded as individual path segments.

Multiple custom headers can be added with `addCustomHeader()`. Header names
are matched without regard to case when replacing or removing them. Removing
one header preserves the others, and headers are specific to each client.
