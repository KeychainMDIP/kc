# MDIP Hyperswarm mediator

The Hyperswarm mediator is responsible for distributing unconfirmed MDIP operations to the network and for organizing an IPFS peer network for file-sharing.

The mediator uses Negentropy for full-history windowed synchronization on connect, with periodic retry only until the peer reaches a completed sync. Ordered catch-up can transfer ordered pages before handing off to Negentropy.

When catching up, the mediator prefers the largest eligible ordered history among
connected peers. If a ready ordered source becomes available during fallback
Negentropy synchronization, it closes those sessions and drains admitted imports
before switching to ordered catch-up. Negentropy still reconciles any differences
after the ordered transfer.

The current framed JSON wire contract has one exact compatibility version:
`ping.version = 2`. It authorizes operation transfer through offers and requests,
then sends one bounded page at a time and waits for an import acknowledgement.
All network nodes must upgrade together because older message shapes are
intentionally incompatible.

The external message shapes and ordered catch-up terminal rules are documented
in [the Hyperswarm synchronization protocol](../../../doc/01-protocol/hyperswarm.md).

Realtime propagation uses best-effort Gatekeeper queue gossip:

- mediator polls one bounded `gatekeeper.getQueue('hyperswarm')` head page per
  existing flush
- relays queue operations with a `queue` message whose operation array is named
  `operations`
- peers import operations, persist the shareable results, then relay them while
  excluding the immediate source locally

Each receiver admits at most two gossip batches and bounds recent outcomes.
Overload, incomplete imports and outbound delivery failures schedule targeted
Negentropy repair without penalizing the source peer. Persisted pages are relayed
as they drain, so older accepted operations do not wait for a complete batch.
Queue shape and byte limits are validated once at transport ingress. Saturated
gossip is dropped before content-ID hashing and schedules the same bounded
repair. Admitted outcomes are keyed by sorted verified operation IDs, so changing
wire order does not bypass duplicate suppression.

This keeps low latency for new operations while Negentropy handles catch-up and
recovers best-effort delivery failures.

## Native Negentropy engine

The mediator vendors the official JavaScript Negentropy v1 engine as
`src/negentropy/Negentropy.cjs`; the `.cjs` extension only selects Node's module
format. Its reproducible source is:

- repository: `https://github.com/hoytech/negentropy`
- commit: `fc53c6c12db03c0d27abfd1e956ba75c37152821`
- source path: `js/Negentropy.js`
- SHA-256: `0ccda2fb5343f97a0679442aec55e258cab09ddc775a3f8af87ada7b3c02cb50`
- native protocol byte: `0x61` (Negentropy protocol v1)
- specification: [Negentropy Protocol V1](https://github.com/hoytech/negentropy/blob/fc53c6c12db03c0d27abfd1e956ba75c37152821/docs/negentropy-protocol-v1.md)

The native protocol version is separate from MDIP's Negentropy v2 session and
operation-transfer protocol. Deterministic native frames and fingerprints are
kept in `tests/hyperswarm/fixtures/negentropy-v1-conformance.json`.
Native frames are emitted as bytes and carried in JSON as canonical padded
base64. Their decoded protocol maximum is fixed at 128 KiB.

## Transfer and resource limits

Every message uses four-byte-length-prefixed JSON, including the initial ping.
Raw JSON peers cannot connect. A compatible initial ping must advertise wire
version 2 before any queue or synchronization traffic is accepted. The ping may
also advertise a display name, discovery DIDs, the latest signed timestamp and
ordered catch-up state. An admitted connection has 15 seconds to provide that
compatible ping. Missing the deadline closes the connection and applies the
existing bounded protocol cooldown; the separate stale-connection timeout still
covers established peers that later stop communicating.

Inbound and outbound operation pages have the same limits: 300 operations and
512 KiB for the exact UTF-8 bytes of the serialized operation array, including
its brackets and commas. Offers and requests contain at most 1,000
IDs. Synchronization windows contain at most 25,000 records. A single operation
larger than the page limit fails that transfer rather than bypassing the limit.
Local publication pages remain in Gatekeeper until imported and cleared; the
next existing flush drains the next head page without adding another queue or
worker.

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

Inbound operation pages share a five-page, 2.5-MiB operation-data budget. Raw
framed input and queued output have separate per-connection and global byte budgets,
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
room. A complete Kubo peer-addition attempt, including all advertised addresses
and its internal configuration I/O, shares one ten-second deadline.

## Invalid input, quarantine, and recovery

Objective protocol violations, such as malformed frames, oversized pages,
unsolicited responses for a current request, or operations with mismatched
content IDs, terminate the connection. The remote public key receives a temporary
cooldown of one minute, five minutes, thirty minutes, then six hours for repeated
violations. Strikes decay after 24 hours without another violation. The
process-local policy holds at most 4,096 entries and survives in-process swarm
recreation. It does not survive a mediator restart. Incompatible MDIP wire
versions receive a non-punitive one-minute retry delay.

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

Upgrade all Hyperswarm mediators together. MDIP wire version 2 has no fallback,
and older peers are refused before application traffic. No database reset is needed.
Gatekeeper and every mediator must also support the bounded pending-event and
paged-processing contract. Deploy the companion Gatekeeper ingress changes
before claiming end-to-end memory protection.

## Observability

The mediator emits periodic structured sync metrics in `connectionLoop` including:

- Negentropy session counts
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
  refusals, and wire-version incompatibility closures
- Gatekeeper capacity outcomes, retry-delay evictions, terminal records persisted,
  and terminal rows removed at startup
- current transport bytes, operation-page bytes, gossip admission and deduplication
  counts, pending repairs, retry-delayed IDs, and quarantine counts/evictions
- peer-directory admission drops, cache hits/evictions, Kubo capacity refusals,
  and current discovery work

These counters are cumulative for the mediator process. Resource counts describe
the current snapshot. Protocol-strike categories are fixed and never use remote
peer IDs or arbitrary message text as metric keys. The periodic
`hyperswarm sync stats` info record includes these metrics; no additional
endpoint is created.
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
the operation. Active delays survive an ordinary mediator restart, expire at
the normal repair deadline, and are cleared as soon as the operation becomes
known. Gatekeeper and mediator versions containing this contract must be
deployed together.

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

Incremental Gatekeeper mirroring requests `includeOperations: true` and
`includeDIDHistories: false` to avoid loading complete DID histories. Operations,
removals and cursors still reach the sync store atomically. Snapshot bootstrapping
continues to use full histories. Older Gatekeepers that support operation exports
may return extra histories, which the mediator ignores. No database reset is
needed for this change.

The mediator includes these sync-store implementations in `src/db/`:

- `SqliteOperationSyncStore` for persistent ordered storage
- `PostgresOperationSyncStore` for persistent ordered storage
- `InMemoryOperationSyncStore` for tests

SQLite uses a fixed data path under `data/hyperswarm` (relative to the mediator working directory), with indexes on `(signed_ts, id)` and `(sync_order, id)` for ordered range queries.

Postgres uses `hyperswarm_sync_operations` with a B-tree index on `(signed_ts, id)` to preserve deterministic keyset ordering. Negentropy rebuilds read only those key columns; full operations are fetched only when peers differ.
