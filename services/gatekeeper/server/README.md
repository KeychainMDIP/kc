# MDIP Gatekeeper REST API server

The Gatekeeper service is responsible for guarding the integrity of the local DID database.
Every DID has an associated sequence of operations, starting with a create operation.
The Gatekeeper ensures that only valid and verified operations are added to the DID database so that it can resolve the correct consensus JSON documents for a given DID.

Operations come from Keymaster clients such as end-user wallets and network mediators such as the Hyperswarm mediator (used to distribute operations between nodes) and Bitcoin mediator (used to impose an objective order on operations for network consensus).

## Environment variables

| variable | default | description |
| --- | --- | --- |
| `KC_GATEKEEPER_PORT` | 4224 | Service port |
| `KC_GATEKEEPER_DB` | redis | DID database adapter, must be `redis`, `json`, `mongodb`, `sqlite`, or `postgres` |
| `KC_GATEKEEPER_DID_PREFIX` | did:test | Fallback `did:<method>` prefix when a signed create operation does not specify one. Method names use only lowercase letters and digits |
| `KC_GATEKEEPER_REGISTRIES` | local,hyperswarm | Comma-separated registries accepted by this node |
| `KC_GATEKEEPER_JSON_LIMIT` | 4mb | Maximum JSON request-body size accepted by the API |
| `KC_GATEKEEPER_MAX_OP_BYTES` | 65536 | Maximum UTF-8 byte length of a JSON-stringified operation |
| `KC_GATEKEEPER_SERVE_CLIENT` | true | Serve the Gatekeeper web client from the API process |
| `KC_IPFS_URL` | http://localhost:5001/api/v0 | IPFS RPC URL |
| `KC_IPFS_ENABLE` | true | Enable IPFS-backed CAS endpoints |
| `KC_IPFS_CLUSTER_URL` | (no default) | Optional IPFS Cluster API URL |
| `KC_IPFS_CLUSTER_AUTH_HEADER` | (no default) | Optional authorization header sent to IPFS Cluster |
| `KC_GATEKEEPER_GC_INTERVAL` | 15 | Minutes between bounded indexed expiration-cleanup runs (0 to disable scheduled cleanup) |
| `KC_GATEKEEPER_TRUST_PROXY` | false | If true, trust upstream proxy headers when determining client IP (`req.ip`) |
| `KC_GATEKEEPER_RATE_LIMIT_ENABLED` | false | Enable API rate limiting |
| `KC_GATEKEEPER_RATE_LIMIT_WINDOW_VALUE` | 1 | Time window size for rate limiting |
| `KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT` | minute | Time unit for rate limiting window: `second`, `minute`, or `hour` |
| `KC_GATEKEEPER_RATE_LIMIT_MAX_REQUESTS` | 600 | Max requests allowed per client during one window |
| `KC_GATEKEEPER_RATE_LIMIT_WHITELIST` | (empty) | Comma-separated IP/CIDR list to bypass limits |
| `KC_GATEKEEPER_RATE_LIMIT_SKIP_PATHS` | /api/v1/ready | Comma-separated API paths excluded from limits |
| `KC_MONGODB_URL` | mongodb://localhost:27017/?replicaSet=rs0 | MongoDB connection string when `KC_GATEKEEPER_DB=mongodb` |
| `KC_REDIS_URL` | redis://localhost:6379 | Redis connection string when `KC_GATEKEEPER_DB=redis` |
| `KC_POSTGRES_URL` | postgresql://mdip:mdip@localhost:5432/mdip | PostgreSQL connection string when `KC_GATEKEEPER_DB=postgres` |
| `KC_POSTGRES_POOL_MAX` | 10 | Maximum number of Gatekeeper PostgreSQL pool connections |
| `KC_POSTGRES_CONNECTION_TIMEOUT_MS` | 3000 | Maximum time to establish or obtain a PostgreSQL connection |
| `KC_POSTGRES_KEEP_ALIVE` | true | Enable TCP keep-alive for PostgreSQL connections |
| `KC_POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS` | 10000 | Delay before the first PostgreSQL TCP keep-alive probe |
| `KC_POSTGRES_IDLE_TIMEOUT_MS` | 30000 | Close idle PostgreSQL pool connections after this delay. Set to 0 to disable |
| `KC_POSTGRES_MAX_LIFETIME_SECONDS` | 300 | Re-create PostgreSQL connections after this lifetime. Set to 0 to disable |
| `KC_LOG_LEVEL` | info | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` |

## MongoDB deployment requirement

When `KC_GATEKEEPER_DB=mongodb`, Gatekeeper requires MongoDB transactions so DID/block mutations and search-index cursor records commit atomically. MongoDB transactions require a replica set or sharded cluster. A standalone `mongod` is not supported and Gatekeeper will fail during startup.

The repository `docker-compose.yml` starts MongoDB as a single-node replica set named `rs0` and uses `KC_MONGODB_URL=mongodb://mongodb:27017/?replicaSet=rs0` for containers. Its healthcheck waits until the replica set has a writable primary before starting dependent services. Existing Mongo-backed deployments must use a replica set with a reachable primary, or a managed replica-set/sharded MongoDB deployment, before starting Gatekeeper with this adapter.

## Expiration cleanup and database verification

Scheduled garbage collection queries Gatekeeper's lifecycle index for expired
DIDs and their direct dependents. It does not enumerate all DID histories,
calculate statistics, or run a signature audit. Each run handles at most 50
pages of 100 candidate examinations, yielding between pages and preserving
unfinished work for the next cycle. A large history can still make an individual
candidate expensive. The work budget is not a hard time deadline.

The lifecycle index is maintained atomically with history changes on every
supported adapter. Existing databases receive a one-time backfill during
startup. Allow that initialization to finish before readiness. No database
reset is required. Setting `KC_GATEKEEPER_GC_INTERVAL=0` disables scheduled
cleanup while retaining normal metadata maintenance. Use one Gatekeeper writer
per authoritative database namespace and stop older writers before upgrading.

`GET /api/v1/db/verify` and `admin verify-db` explicitly run the expensive
integrity audit. `verified` means successfully audited retained DIDs. An
incomplete audit returns an error when dependencies, legacy formats or storage
errors prevent a conclusion. It preserves those uncertain histories, although
earlier completed repairs are not rolled back. Full audits are never scheduled
by garbage collection.

## Database resets

The existing reset endpoint retains its namespace scope and response. PostgreSQL
can clear Gatekeeper's bulk-data tables with `TRUNCATE` when they contain no other
namespace and exclusive access is immediately available. Otherwise it uses
scoped deletes. Row security, user triggers or unavailable truncate privileges
also retain the scoped path. The reset strategy is logged after commit.

Pause ingestion and other table users before a planned reset to allow the bulk
path reliably. It briefly locks those tables. Reset still regenerates the index
epoch and initializes empty lifecycle state, causing consumers to rebuild through
their existing epoch checks. Other namespaces and unrelated metadata are retained.

Bulk reset reduces deletion WAL. Reimporting operations and rebuilding downstream
stores still generate WAL, so the PostgreSQL archive pipeline must keep up.

## Lightweight status and DID statistics

`GET /api/v1/status` reports Gatekeeper uptime, process memory, and live queue
counts.

```json
{
  "uptimeSeconds": 120,
  "eventsQueue": { "staged": 2, "pending": 3, "processing": 1, "total": 6, "active": true },
  "memoryUsage": { "rss": 100000000, "heapTotal": 80000000, "heapUsed": 60000000, "external": 10000000, "arrayBuffers": 5000000 }
}
```

Queue categories are disjoint. `staged` means queued work not last classified
as deferred, `pending` means queued work waiting after a deferred import, and
`processing` means work remaining in active import passes. `total` is their
sum. Raw operation bodies are not included. Memory counters are byte counts.

## Index export limitation

`POST /api/v1/index/export` is intended to let consumers sync DID event histories using a cursor to avoid full database reads. Snapshot export includes DID events, the checkpoint cursor used to continue with incremental changes, and an `indexEpoch` that changes when the backing index database is reset or replaced. It does not currently include Gatekeeper's blockchain table.

Consumers can rebuild DID documents and preserve accepted DID operation order from the event stream, but resolved DID metadata may omit chain timestamp proof bounds that require blockchain lookups, including block `height`, `hash`, and `time`.

## IPFS disabled mode

Set `KC_IPFS_ENABLE=false` to run Gatekeeper without IPFS. In this mode:

- DID generation, event storage, and resolution continue without IPFS
- CAS endpoints (`/api/v1/cas/*`) return `503 IPFS disabled`
