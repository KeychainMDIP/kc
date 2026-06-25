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
| `KC_GATEKEEPER_DID_PREFIX` | did:test | Default prefix assigned to DIDs created |
| `KC_IPFS_ENABLE` | true | Enable IPFS storage for opids and CAS endpoints |
| `KC_GATEKEEPER_GC_INTERVAL` | 15 | The number of minutes between garbage collection cycles (0 to disable) |
| `KC_GATEKEEPER_STATUS_INTERVAL` | 5 | The number of minutes between logging status updates (0 to disable) |
| `KC_GATEKEEPER_TRUST_PROXY` | false | If true, trust upstream proxy headers when determining client IP (`req.ip`) |
| `KC_GATEKEEPER_RATE_LIMIT_ENABLED` | false | Enable API rate limiting |
| `KC_GATEKEEPER_RATE_LIMIT_WINDOW_VALUE` | 1 | Time window size for rate limiting |
| `KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT` | minute | Time unit for rate limiting window: `second`, `minute`, or `hour` |
| `KC_GATEKEEPER_RATE_LIMIT_MAX_REQUESTS` | 600 | Max requests allowed per client during one window |
| `KC_GATEKEEPER_RATE_LIMIT_WHITELIST` | (empty) | Comma-separated IP/CIDR list to bypass limits |
| `KC_GATEKEEPER_RATE_LIMIT_SKIP_PATHS` | /api/v1/ready | Comma-separated API paths excluded from limits |
| `KC_MONGODB_URL` | mongodb://localhost:27017/?replicaSet=rs0 | MongoDB connection string when `KC_GATEKEEPER_DB=mongodb` |
| `KC_LOG_LEVEL` | info | Log level: `debug`, `info`, `warn`, `error` |

## MongoDB deployment requirement

When `KC_GATEKEEPER_DB=mongodb`, Gatekeeper requires MongoDB transactions so DID/block mutations and search-index cursor records commit atomically. MongoDB transactions require a replica set or sharded cluster; a standalone `mongod` is not supported and Gatekeeper will fail during startup.

The repository `docker-compose.yml` starts MongoDB as a single-node replica set named `rs0` and uses `KC_MONGODB_URL=mongodb://mongodb:27017/?replicaSet=rs0` for containers. Its healthcheck waits until the replica set has a writable primary before starting dependent services. Existing Mongo-backed deployments should update their MongoDB service to run as a replica set with a reachable primary, or move to a managed replica-set/sharded MongoDB deployment, before upgrading to this version.

## Index export limitation

`POST /api/v1/index/export` is intended to let consumers sync DID event histories using a cursor to avoid full database reads. Snapshot export includes DID events, the checkpoint cursor used to continue with incremental changes, and an `indexEpoch` that changes when the backing index database is reset or replaced. It does not currently include Gatekeeper's blockchain table.

Consumers can rebuild DID documents and preserve accepted DID operation order from the event stream, but resolved DID metadata may omit chain timestamp proof bounds that require blockchain lookups, including block `height`, `hash`, and `time`. This keeps the explorer sync focused on DID operations for now, block snapshot hydration can be added later if full chain timestamp metadata is required.

## IPFS disabled mode

Set `KC_IPFS_ENABLE=false` to run Gatekeeper without IPFS. In this mode:
- opids are still generated, but they are not stored in IPFS
- CAS endpoints (`/api/v1/cas/*`) return `503 IPFS disabled`
