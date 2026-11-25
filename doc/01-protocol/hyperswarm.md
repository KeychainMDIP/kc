# MDIP Hyperswarm wire protocol v2

MDIP Hyperswarm peers exchange Gatekeeper operations over one intentionally
incompatible wire version. Gatekeeper remains authoritative for operation
validity; this protocol reconciles operation identities, authorizes bounded
transfers and optionally accelerates catch-up.

The machine-readable message contract is
[`hyperswarm-v2.schema.json`](hyperswarm-v2.schema.json). Deterministic identity,
frame and transcript vectors are in
[`hyperswarm-v2-conformance.json`](../../tests/hyperswarm/fixtures/hyperswarm-v2-conformance.json).

## Transport and admission

The Hyperswarm topic is the 32-byte SHA-256 digest of the UTF-8
`KC_MDIP_PROTOCOL` value. Hyperswarm provides its normal Noise-encrypted stream;
this protocol adds no second encryption layer.

Every application message, including the first ping, is UTF-8 JSON framed as:

~~~text
4-byte unsigned big-endian JSON byte length | JSON bytes
~~~

The length must be non-zero and no greater than 16 MiB. Raw unframed JSON is
not accepted. Wire messages and protocol-owned nested objects use the exact
properties below; unknown properties are protocol violations. Operation
objects remain Gatekeeper-owned and may contain its supported fields.

The first application message must arrive within 15 seconds and must be:

~~~json
{
  "type": "ping",
  "version": 2,
  "name": "optional display name",
  "peerDids": ["optional discovery DIDs"],
  "latestTs": 1782892800,
  "ordered": { "count": 100, "sourceReady": true }
}
~~~

Only `type` and `version` are required. `sourceReady: true` requires a non-zero
`count`. A different or missing version is refused before queue or
synchronization traffic and is not a protocol strike. There is no fallback or
legacy message negotiation.

## Common values and limits

- Every integer is a non-negative JavaScript-safe integer unless a tighter
  range is stated.
- A session ID is 1–256 printable ASCII bytes.
- An operation ID is exactly 64 lowercase hexadecimal characters.
- A cursor is `{ "ts": integer, "id": operationId }` for reconciliation or
  `{ "syncOrder": integer, "id": operationId }` for ordered catch-up.
- An operation page contains at most 300 operations and its exact serialized
  JSON array is at most 512 KiB, including brackets and commas.
- An offer or request contains at most 1,000 unique operation IDs.
- A reconciliation window contains at most 25,000 records. Its `until` is no
  earlier than `1704067200` (2024-01-01T00:00:00Z).
- A native reconciliation frame is canonical padded base64 and decodes to at
  most 128 KiB.
- A ping name is at most 256 UTF-8 bytes. A ping advertises at most 256 peer
  DIDs, each a valid DID of at most 512 UTF-8 bytes.

JSON Schema cannot express exact decoded or UTF-8 byte lengths, DID semantics,
operation content-ID verification, cursor progression or session
authorization. The production validator and state machine enforce those rules.

## Operation identity

The reconciliation identity is `operation.signature.hash`. Implementations
reproduce it as follows:

1. Remove the entire top-level `signature` property from the operation.
2. Canonicalize the remaining JSON using RFC 8785.
3. SHA-256 the canonical UTF-8 bytes.
4. Encode the digest as 64 lowercase hexadecimal characters.

The claimed hash is checked before an operation is imported. The reconciliation
timestamp is `floor(Date.parse(operation.signature.signed) / 1000)` using the
same accepted timestamp semantics as Gatekeeper. Values below `1704067200` are
clamped to that epoch. This mapping does not replace Gatekeeper's operation or
signature validation.

## Message shapes

The following twelve message types form the complete v2 contract.

| Type | Required fields | Optional fields |
| --- | --- | --- |
| `ping` | `version: 2` | `name`, `peerDids`, `latestTs`, `ordered` |
| `queue` | `operations` | none |
| `ordered_catchup_req` | `sessionId` | `after` |
| `ordered_catchup_push` | `sessionId`, `cursor`, `hasMore`, non-empty `operations` | none |
| `ordered_catchup_done` | `sessionId` | none |
| `neg_open` | `sessionId`, `windowSeq`, `window`, `round`, `frame` | `previousContinuation` |
| `neg_msg` | `sessionId`, `windowSeq`, `round`, `frame`, `continuation` | none |
| `ops_offer` | `sessionId`, `transferId`, non-empty `ids` | none |
| `ops_req` | `sessionId`, `transferId`, `ids` | `incomplete: true` |
| `ops_push` | `sessionId`, `transferId`, `page`, `hasMore`, `operations` | none |
| `ops_ack` | `sessionId`, `transferId`, `page` | `incomplete: true` |
| `neg_close` | `sessionId`, `windowSeq`, `round`, `outcome` | `continuation` as described below |

`window` is `{ "until": integer, "limit": 1..25000, "after"?: cursor }`.
`frame` is a native frame encoded as canonical padded base64. A continuation is
either a reconciliation cursor or `null`.

`neg_close.outcome` is one of `complete`, `busy`, `round_limit`, or
`incomplete`. `complete` and `round_limit` require `continuation`, which may be
`null`; `busy` and `incomplete` may omit it when no usable snapshot exists.

`ops_req.ids` may be empty only as an all-known response to the matching active
offer. A direct empty request is rejected by session state. `ops_push.operations`
may be empty only on a final page (`hasMore: false`); a non-final page is always
non-empty. `incomplete`, when present on a request or acknowledgement, is the
literal value `true` and reports work deferred by local retry or capacity.

## Reconciliation

The native reconciliation engine identifies differing operation IDs. The MDIP
session authorizes the corresponding operation transfer:

~~~text
idle
  -> neg_open(window 0, round 0)
  <-> neg_msg(next round, exact continuation)
  <-> ops_offer -> ops_req -> ops_push(page n) -> ops_ack(page n)
  -> next neg_open(exact continuation), while the snapshot is record-capped
  -> neg_close(outcome, continuation) -> idle
~~~

Only the session initiator allocates transfers. `transferId` increases across
all windows and rounds. An offer response may request only IDs in that active
offer. A direct request uses the next transfer ID. A push may contain only the
exact IDs authorized by the active request.

Pages are zero-based and stop-and-wait. The sender cannot send page `n + 1`
until page `n` is acknowledged. `hasMore: true` requires another authorized ID
to remain; `hasMore: false` completes that authorized set. Each transfer is
retired after its final acknowledgement or when the session closes, is
replaced, times out, disconnects, resets or shuts down. Unsolicited IDs,
repeated IDs, stale or replaced requests, duplicate pages and budget overruns
are rejected before import or acknowledgement.

Each session begins with `windowSeq: 0`. A subsequent window increments it by
one and must use the exact continuation or authorized smaller round-limit split
from the preceding window. `neg_msg` carries the current continuation. A
record-capped next `neg_open` repeats it as `previousContinuation` and, when
non-null, as `window.after`. A terminal successful close carries the final
continuation.

`complete` marks the peer synchronized and closes the session. `round_limit`
authorizes only the exact smaller split; if no split is possible, the session
closes. `busy` is non-punitive and waits for another attempt. `incomplete`
closes the session and schedules normal repair. Exact local error text remains
in local structured logs and never crosses the wire.

## Ordered catch-up

Ordered catch-up is optional and stop-and-wait:

~~~text
ordered_catchup_req(after omitted)
  -> ordered_catchup_push(cursor, hasMore, non-empty operations)
  -> ordered_catchup_req(after = exact cursor), while hasMore
  -> ordered_catchup_push(..., hasMore = false)
~~~

The cursor must identify the final operation in the page and advance beyond the
requested cursor. `ordered_catchup_done` is the distinct zero-row response to an
outstanding request and has neither operations nor cursor. Only one ordered
request is outstanding at a time. Negentropy reconciliation follows ordered
catch-up to resolve any remaining differences.

## Optional features and minimum conformance

A minimum peer implements the eight message types needed for admission and
authorized reconciliation: `ping`, `neg_open`, `neg_msg`, `ops_offer`,
`ops_req`, `ops_push`, `ops_ack`, and `neg_close`.

`queue` is optional best-effort low-latency gossip. A peer that does not
implement it may ignore it; reconciliation remains authoritative. Ordered
catch-up is optional: peers advertise `ordered` only when implemented and must
not start it with a peer that did not advertise a usable ordered source.

## Native engine provenance

The embedded reconciliation engine is vendored without modification except for
the `.cjs` filename selecting Node's module format.

| Property | Value |
| --- | --- |
| Repository | `https://github.com/hoytech/negentropy` |
| Commit | `fc53c6c12db03c0d27abfd1e956ba75c37152821` |
| Source | `js/Negentropy.js` |
| Vendored file | `services/mediators/hyperswarm/src/negentropy/Negentropy.cjs` |
| SHA-256 | `0ccda2fb5343f97a0679442aec55e258cab09ddc775a3f8af87ada7b3c02cb50` |
| License | MIT |
| Embedded frame byte | `0x61` |

These details establish source and frame provenance only. The public MDIP
contract is this v2 document, schema and conformance fixture; no separate legacy
wire contract is supported.
