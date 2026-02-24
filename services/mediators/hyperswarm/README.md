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

`shareDb` is intentionally retained for backward compatibility and can be disabled once compatibility validation is complete.

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
| `KC_NODE_ID       `       | (no default)                 | Keymaster node agent name     |
| `KC_NODE_NAME`            | anon                         | Human-readable name for the node |
| `KC_MDIP_PROTOCOL`        | /MDIP/v1.0-public            | MDIP network topic to join    |
| `KC_HYPR_EXPORT_INTERVAL` | 2                            | Seconds between export cycles |
| `KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT` | 0                            | Negentropy frame-size limit in KB (0 or >= 4) |
| `KC_HYPR_NEGENTROPY_WINDOW_DAYS` | 30                           | Reconciliation window size in days for full-sync chunking |
| `KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW` | 25000                        | Maximum operations loaded into a single window adapter |
| `KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION` | 64                           | Maximum negentropy rounds per window session |
| `KC_HYPR_NEGENTROPY_INTERVAL` | 300                          | Seconds between retry attempts for peers not yet fully synced |
| `KC_HYPR_LEGACY_SYNC_ENABLE` | true                         | Allow legacy `sync`/`shareDb` compatibility path |
| `KC_LOG_LEVEL`            | info                         | Log level: `debug`, `info`, `warn`, `error` |

Negentropy session concurrency is currently fixed at one active session per node.

## IPFS disabled mode

Set `KC_IPFS_ENABLE=false` to run the mediator without IPFS or Keymaster integration. In this mode:
- operations still sync and relay over Hyperswarm (queue + negentropy; legacy sync if enabled)
- IPFS peering is disabled and node IPFS info is not published
- `KC_NODE_ID` is not required because Keymaster is not used

## Sync Store Scaffolding

The mediator now includes a sync-store abstraction in `src/db/` with:
- `SqliteOperationSyncStore` for persistent ordered storage
- `InMemoryOperationSyncStore` for tests

The SQLite implementation uses a fixed data path under `data/hyperswarm` (relative to the mediator working directory), with an index on `(ts, id)` to use SQLite's native B-tree ordering for range queries.
