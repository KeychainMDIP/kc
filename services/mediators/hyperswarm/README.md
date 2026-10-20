# MDIP Hyperswarm mediator

The Hyperswarm mediator is responsible for distributing unconfirmed MDIP operations to the network and for organizing an IPFS peer network for file-sharing.

The mediator uses Negentropy for full-history windowed synchronization on connect, with periodic retry only until the peer reaches a completed sync. Ordered catch-up can transfer ordered pages before handing off to Negentropy.

The current wire contract requires Negentropy v2 over framed transport v1. V2
authorizes operation transfer through offers and requests, then sends one bounded
page at a time and waits for an import acknowledgement. All network nodes must
upgrade together because Negentropy v1 peers are intentionally incompatible.

Realtime propagation uses best-effort Gatekeeper queue gossip:

- mediator polls `gatekeeper.getQueue('hyperswarm')`
- relays queue operations with a `queue` message
- peers import operations, persist the shareable results, then relay them with
  fresh relay metadata

This keeps low latency for new operations while negentropy handles catch-up.
An overloaded receiver may drop a live batch and schedule targeted Negentropy
repair. The sender retains its synchronization inventory so the dropped delivery
can be recovered later.

## Transfer and resource limits

Every message must use framed transport v1, including the initial ping. Raw JSON
peers cannot connect. A compatible initial ping must advertise Negentropy v2
before any queue or synchronization traffic is accepted.

Inbound and outbound operation pages have the same limits: 300 operations and
512 KiB of serialized operation data. Offers and requests contain at most 1,000
IDs. Synchronization windows contain at most 25,000 records. A single operation
larger than the page limit fails that transfer rather than bypassing the limit.

Ordered catch-up accepts pages only against outstanding requests and checks the
exact continuation cursor. It permits one active import plus two requested pages
waiting. Negentropy v2 uses `ops_offer`, `ops_req`, `ops_push`, and `ops_ack`.
A push must contain only IDs in the receiver's current request. Each direction
has at most one operation request outstanding, and the sender waits for the
current page to be imported and acknowledged before sending another.

Live gossip admits one active and one waiting batch globally. Completed and
retry-delayed batch hashes share a 4,096-entry FIFO cache. Pending input and local
capacity failures remain retryable after the repair interval. Repeated copies
within that interval do not resubmit work or create repeated repair jobs.

All import paths share a five-page, 2.5-MiB operation-data budget. Raw framed
input and queued output have separate per-connection and global byte budgets,
including the framing header and message envelope. An incomplete frame and a
blocked outbound write each have a two-minute deadline. Local byte pressure
does not count as a protocol strike.

The mediator accepts at most 64 application connections and tracks at most 128
active plus draining connections. Optional IPFS discovery queues at most 256
candidates, resolves four concurrently, and retains at most 4,096 DID records
plus a separate 4,096-entry failure cache. Failed candidates wait five minutes
before another resolution attempt. Pings are processed at most once every ten
seconds per connection.

Kubo discovery refuses additions when the total peering configuration reaches
4,096 entries, including pre-existing entries. Startup preserves those entries
even if they already exceed the limit, and eviction removes only peers added by
this process. Automatic discovery stops when the persistent limit is full or its
configuration cannot be read. Operators must review unwanted entries to free
capacity. The mediator never deletes protected operator configuration to make
room. Kubo discovery requests have a ten-second deadline.

## Invalid input, quarantine, and recovery

Objective protocol violations, such as malformed frames, oversized pages,
unsolicited responses for a current request, or operations with mismatched
content IDs, terminate the connection. The remote public key receives a temporary
cooldown of one minute, five minutes, thirty minutes, then six hours for repeated
violations. Strikes decay after 24 hours without another violation. The
process-local policy holds at most 4,096 entries and survives in-process swarm
recreation. It does not survive a mediator restart. Incompatible framing or
Negentropy versions receive a non-punitive one-minute retry delay.

Gatekeeper rejection and local overload do not earn strikes. Operations without
a content-verified synchronization ID are neither persisted nor advertised.
Content-verified operations rejected against this node's history, including
losing forks and pre-0.5 operations without `previd`, remain portable inventory.
They are persisted before relay because another node may accept them. Startup
removes these provisional terminal records before rebuilding from Gatekeeper,
allowing reconciliation to retrieve and reconsider them.

These safeguards bound transport, gossip, discovery, and retry state. They do
not prevent cryptographically valid spam or peers rotating public keys. Portable
terminal inventory can still grow during one process lifetime. Safely bounding
that inventory requires Gatekeeper rejection reasons that distinguish globally
invalid data from alternatives valid on another history.

## Deployment compatibility

Upgrade all Hyperswarm mediators together. Negentropy v1 has no fallback, and
older peers are refused before application traffic. No database reset is needed.
Gatekeeper and every mediator must also support the bounded pending-event and
paged-processing contract. Deploy the companion Gatekeeper ingress changes
before claiming end-to-end memory protection.

## Sync mode behavior

| peer mode | connect-time behavior | periodic behavior | queue gossip |
| --- | --- | --- | --- |
| `negentropy` | optional ordered catch-up, then full-history windowed reconciliation | periodic retry until sync completes, then stop | enabled |

## Observability

The mediator emits periodic structured sync metrics in `connectionLoop` including:

- negentropy mode selection and incompatibility counts
- negentropy rounds and have/need totals
- ops requested/pushed sent and received
- gatekeeper apply/reject totals
- bytes sent/received
- session duration aggregates
- queue delay aggregates (from operation `signature.signed` to relay/import time)
- fixed-category protocol strike counts, oversized operation/ID messages,
  unsolicited ordered responses, and unauthorized Negentropy transfers
- gossip overload drops, scheduled/started repairs, retry suppression, and
  shareable operations relayed after persistence
- byte-budget refusals, frame timeouts, skipped pings, connection-capacity
  refusals, and incompatibility closures
- Gatekeeper capacity outcomes, retry-delay evictions, terminal records persisted,
  and terminal rows removed at startup
- current transport bytes, operation-page bytes, gossip admission and deduplication
  counts, pending repairs, retry-delayed IDs, and quarantine counts/evictions
- peer-directory admission drops, cache hits/evictions, Kubo capacity refusals,
  and current discovery work

These counters are cumulative for the mediator process. Resource counts describe
the current snapshot. Protocol-strike categories are fixed and never use remote
peer IDs or arbitrary message text as metric keys. Enable `KC_LOG_LEVEL=debug`
to see the periodic `hyperswarm sync stats` record. No additional endpoint is
created for these metrics.
The relayed gossip operation count includes each successful peer write, so one
operation sent to three peers counts three times. It does not prove remote
Gatekeeper acceptance.

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
| `KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT` | 0                            | Negentropy frame-size limit in KB (0 or >= 4) |
| `KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW` | 25000                        | Maximum operations loaded into a single window adapter, with a hard maximum of 25,000. It is also the non-empty-node gap threshold for ordered catch-up |
| `KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION` | 64                           | Maximum negentropy rounds per window session |
| `KC_HYPR_NEGENTROPY_INTERVAL` | 300                          | Seconds between retry attempts for peers not yet fully synced |
| `KC_LOG_LEVEL`            | info                         | Log level: `debug`, `info`, `warn`, `error` |

Negentropy session concurrency is currently fixed at one active session per node.
Ordered catch-up uses the same operation push chunking as negentropy: up to 300 operations or 512 KiB per push.

Gatekeeper imports are also consumed in bounded pages. If Gatekeeper retains an
operation while waiting for a dependency or refuses it because the pending queue
is full, the mediator does not advertise or relay that pending operation. It
may relay other accepted or portable-terminal operations from the same batch
after persistence. It delays another local submission until the normal
Negentropy repair interval, while later synchronization remains able to retry
the operation. Gatekeeper and mediator versions containing this contract must
be deployed together.

Gatekeeper separately caps retained pending events at 10,000 events and 64 MiB,
with a reserved transient lane for a new page that may supply a missing
dependency. Its processing responses are paged at 300 events and 512 KiB of
normalized event envelopes. The mediator drains those responses before treating
the work as complete. These limits complement the mediator's memory budgets.

## IPFS disabled mode

Set `KC_IPFS_ENABLE=false` to run the mediator without IPFS or Keymaster integration. In this mode:
- operations still sync and relay over Hyperswarm (queue gossip, ordered catch-up, and negentropy)
- IPFS peering is disabled and node IPFS info is not published
- `KC_NODE_ID` is not required because Keymaster is not used

## Sync store

The mediator includes these sync-store implementations in `src/db/`:

- `SqliteOperationSyncStore` for persistent ordered storage
- `PostgresOperationSyncStore` for persistent ordered storage
- `InMemoryOperationSyncStore` for tests

SQLite uses a fixed data path under `data/hyperswarm` (relative to the mediator working directory), with indexes on `(signed_ts, id)` and `(sync_order, id)` for ordered range queries.

Postgres uses `hyperswarm_sync_operations` with a B-tree index on `(signed_ts, id)` to preserve deterministic keyset ordering. Negentropy rebuilds read only those key columns; full operations are fetched only when peers differ.
