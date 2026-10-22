# MDIP Gatekeeper

Gatekeeper is a node library for the MDIP.
It manages a local database of DIDs on the MDIP network.
Gatekeeper functions are used to Create, Read, Update, and Delete DIDs (CRUD).

## Installation

```bash
npm install @mdip/gatekeeper
```

## Usage

### Library

Construct the library with one of the supported database adapters:

- JSON - @mdip/gatekeeper/db/json
- JSON with memory cache - @mdip/gatekeeper/db/json-cache
- SQLite - @mdip/gatekeeper/db/sqlite
- MongoDB - @mdip/gatekeeper/db/mongo
- Redis - @mdip/gatekeeper/db/redis
- PostgreSQL - @mdip/gatekeeper/db/postgres

The file-backed JSON adapters reject unreadable or malformed existing databases at startup and atomically persist every successful mutation. The cached adapter retains parsed data in memory for reads but writes through to disk before reporting success.

The MongoDB adapter requires a replica set or sharded cluster because DID/block writes and index cursor writes are committed in MongoDB transactions. For local Docker Compose usage, the repository starts MongoDB as a single-node replica set named `rs0`. Standalone MongoDB deployments must be updated before using the adapter.

```js
import Gatekeeper from '@mdip/gatekeeper';
import DbRedis from '@mdip/gatekeeper/db/redis';

const db_redis = new DbRedis('mdip-test');
await db_redis.start();

const gatekeeper = new Gatekeeper({ db: db_redis, ipfsEnabled: false });
const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
console.log(JSON.stringify(docs, null, 4));
```

### Bounded event imports

Imported events use a bounded transient page and a bounded retained-pending
queue. `importBatch()` reports retryable admission backpressure through
`capacityDeferredIndices` and identifies events already held by Gatekeeper
through `processedIndices`. Callers must retry capacity-deferred inputs later.

`processEvents()` returns one bounded page. Call it again while `hasMore` is
true, handling each result before requesting the next page. A false `hasMore`
with a non-zero `pending` count means the retained events are waiting for a
missing controller or predecessor and should not be retried immediately.
Retained events are retried when their target or a traversed controller changes,
including local submissions and DID-prefix aliases. Unidentified or unusually
large dependency sets are conservatively retried after any DID mutation.
Unrelated arrivals do not repeatedly revalidate known, unchanged dependencies.

### Client

The GatekeeperClient is used to communicate with a Gatekeeper REST API service.

```js
import GatekeeperClient from '@mdip/gatekeeper/client';

// Try connecting to the gatekeeper service every second,
// and start reporting (chatty) if not connected after 5 attempts
const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 1,
    chatty: false,
    becomeChattyAfter: 5
});

const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
console.log(JSON.stringify(docs, null, 4));
```

Client requests time out after 60 seconds by default. Set `timeoutMs` to use a
different positive, finite deadline. Long-running services can pass an `AbortSignal` as
`signal`. Aborting it cancels active requests and readiness waits.
