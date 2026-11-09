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

### Expiration cleanup and integrity audits

Gatekeeper maintains a derived index of expiration times and current controller
relationships alongside accepted histories. Adapter startup backfills existing
databases before they are ready. No database reset is needed. Stop older
Gatekeeper writers before upgrading and run one Gatekeeper writer per database
namespace. Backups must include a consistent snapshot of histories and derived
metadata. An incomplete or mismatched index cannot authorize deletion.

`collectExpiredDIDs()` performs bounded expiration cleanup on the concrete
Gatekeeper library. Its result contains `examined`, `expired`, `deferred`,
`hasMore`, and a `continuation` when another page remains. Pass that continuation
to the next call. Reset invalidates old continuations. There is no HTTP endpoint
for this internal maintenance operation.

Cleanup uses the latest accepted state, including unconfirmed updates. It
revalidates due DIDs before physically removing them and emits the existing
index removal records. An expired agent's directly controlled assets are
cleaned in bounded batches before the agent is removed. Partial cascades survive
restart. Renewal stops further cleanup, but already completed removals are not
rolled back. Unavailable or uncertain histories are retained for another
attempt. This does not change whether peers can subsequently re-import expired
histories.

`verifyDb()` is a separate, expensive cryptographic audit. It does not trust a
previous successful audit as proof that stored data is still intact. It may
repair histories with conclusively invalid signatures and perform expiration
cleanup. Missing dependencies, unsupported legacy formats and storage failures
produce an incomplete-audit error rather than a successful verification count
or deletion of uncertain data. Earlier completed repairs are not rolled back if
a later audit step fails. Successful results keep the existing `total`,
`verified`, `expired`, and `invalid` fields. Legacy updates without `previd`
remain supported.

Expiration repair within an audit also has a finite work budget. A large
expiration backlog may remain afterward. Such retained DIDs can be counted as
cryptographically verified even though a later cleanup cycle will remove them.

### Import performance

Imports reuse the target history already read and cache the CIDs of stored
operations by their exact contents. Each Gatekeeper instance retains at most
10,000 cache entries and 64 MiB of accounted string data. Cache structures and
temporary allocations require additional memory. Least recently used entries
are evicted, and a successful database reset clears the cache.

Incoming operation CIDs and signatures are still verified. Explicit database
audits recompute historical CIDs independently of the import cache.

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
