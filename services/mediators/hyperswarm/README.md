# MDIP Hyperswarm mediator

The Hyperswarm mediator is responsible for distributing unconfirmed MDIP operations to the network and for organizing an IPFS peer network for file-sharing.

The mediator supports two synchronization modes:

- `negentropy` mode (preferred): full-history windowed sync on connect, with periodic retry only until the peer reaches a completed sync, using `neg_open`/`neg_msg`/`ops_req`/`ops_push`/`neg_close`.
- `legacy` mode (compatibility): classic `sync` -> full-history `batch` transfer (`shareDb`).

Realtime propagation is always handled by the Gatekeeper queue gossip path:

- mediator polls `gatekeeper.getQueue('hyperswarm')`
- relays queue operations with a `queue` message
- peers import and further relay `queue` messages

This keeps low latency for new operations while negentropy handles catch-up.

## Sync mode behavior

| peer mode | connect-time behavior | periodic behavior | queue gossip |
| --- | --- | --- | --- |
| `negentropy` | negotiate + run full-history windowed session | periodic retry until sync completes, then stop | enabled |
| `legacy` | `sync` + `shareDb` full-history export | n/a | enabled |

`shareDb` is retained for backward compatibility and is controlled by `KC_HYPR_LEGACY_SYNC_ENABLE`.

## Observability

The mediator emits periodic structured sync metrics in `connectionLoop` including:

- session mode selection counts (`legacy` vs `negentropy`) and fallback rate
- negentropy rounds and have/need totals
- ops requested/pushed sent and received
- gatekeeper apply/reject totals
- bytes sent/received
- session duration aggregates
- queue delay aggregates (from operation `signature.signed` to relay/import time)

## Environment variables

| variable                  | default                      | description                   |
| ------------------------- |------------------------------| ----------------------------- |
| `KC_GATEKEEPER_URL`       | http://localhost:4224        | MDIP gatekeeper service URL   |
| `KC_KEYMASTER_URL`        | http://localhost:4226        | MDIP keymaster service URL    |
| `KC_IPFS_URL`             | http://localhost:5001/api/v0 | IPFS RPC URL           |
| `KC_IPFS_ENABLE`          | true                         | Enable IPFS + Keymaster peering integration |
| `KC_NODE_ID`              | (no default)                 | Keymaster node agent name, required when IPFS is enabled |
| `KC_NODE_NAME`            | anon                         | Human-readable name for the node |
| `KC_MDIP_PROTOCOL`        | /MDIP/v1.0-public            | MDIP network topic to join    |
| `KC_HYPR_DB`              | required (`sqlite` in Compose) | Sync-store backend (`sqlite` or `postgres`) |
| `KC_HYPR_POSTGRES_URL`    | `KC_POSTGRES_URL`, then built-in DSN | Postgres DSN used when `KC_HYPR_DB=postgres` |
| `KC_POSTGRES_URL`         | (no default)                 | Shared fallback for `KC_HYPR_POSTGRES_URL` |
| `KC_HYPR_EXPORT_INTERVAL` | 2                            | Seconds between export cycles |
| `KC_HYPR_NEGENTROPY_ENABLE` | true                       | Enable negentropy synchronization |
| `KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT` | 0                            | Negentropy frame-size limit in KB (0 or >= 4) |
| `KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW` | 25000                        | Maximum operations loaded into a single window adapter. It is also the non-empty-node gap threshold for ordered catch-up |
| `KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION` | 64                           | Maximum negentropy rounds per window session |
| `KC_HYPR_NEGENTROPY_INTERVAL` | 300                          | Seconds between retry attempts for peers not yet fully synced |
| `KC_HYPR_ORDERED_CATCHUP_ENABLE` | true                         | Pull ordered operation pages before negentropy when this node is clean or far behind |
| `KC_HYPR_LEGACY_SYNC_ENABLE` | true                         | Allow legacy `sync`/`shareDb` compatibility path |
| `KC_LOG_LEVEL`            | info                         | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` |

Negentropy session concurrency is currently fixed at one active session per node.
Ordered catch-up uses the same operation push chunking as negentropy: up to 300 operations or 512 KiB per push.

## IPFS disabled mode

Set `KC_IPFS_ENABLE=false` to run the mediator without IPFS or Keymaster integration. In this mode:

- operations still sync and relay over Hyperswarm (queue and negentropy, with legacy sync if enabled)
- IPFS peering is disabled and node IPFS info is not published
- `KC_NODE_ID` is not required because Keymaster is not used

## Sync store

The mediator includes these sync-store implementations in `src/db/`:

- `SqliteOperationSyncStore` for persistent ordered storage
- `PostgresOperationSyncStore` for persistent ordered storage
- `InMemoryOperationSyncStore` for tests

SQLite uses a fixed data path under `data/hyperswarm` (relative to the mediator working directory), with indexes on `(signed_ts, id)` and `(sync_order, id)` for ordered range queries.

Postgres uses `hyperswarm_sync_operations` with B-tree indexes on `(signed_ts, id)` and `(sync_order, id)` for the same deterministic ordering.
