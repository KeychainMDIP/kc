# Hyperswarm Synchronization Protocol

MDIP nodes exchange Gatekeeper operations over a framed JSON protocol. The
application protocol coordinates ordered catch-up, set reconciliation and the
explicit transfer of operations; Gatekeeper remains authoritative for operation
validity.

All participating mediators must use the same MDIP Hyperswarm wire version. The
current version is `2`, advertised as the required `version` field on the
initial `ping`. It intentionally has no compatibility fallback for older
message shapes. The common message envelope contains only `type`; display name,
peer discovery DIDs, latest signed timestamp and ordered catch-up capability are
optional ping fields.

## Native Negentropy layer

Set reconciliation embeds the official Negentropy v1 byte protocol inside the
MDIP JSON session protocol. Negentropy identifies differing operation IDs; MDIP's
offer/request/push/ack exchange authorizes and transfers the corresponding
operations.

The vendored JavaScript engine is pinned as follows:

| Property | Value |
| --- | --- |
| Repository | `https://github.com/hoytech/negentropy` |
| Commit | `fc53c6c12db03c0d27abfd1e956ba75c37152821` |
| Source file | `js/Negentropy.js` |
| Vendored file | `services/mediators/hyperswarm/src/negentropy/Negentropy.cjs` |
| SHA-256 | `0ccda2fb5343f97a0679442aec55e258cab09ddc775a3f8af87ada7b3c02cb50` |
| Native protocol byte | `0x61` |

The `.cjs` extension only selects Node's module format; the vendored contents
match the pinned official file. The language-neutral protocol is defined by the
[Negentropy Protocol V1 specification](https://github.com/hoytech/negentropy/blob/fc53c6c12db03c0d27abfd1e956ba75c37152821/docs/negentropy-protocol-v1.md).
The repository's deterministic ordering, fingerprint and frame vectors are in
`tests/hyperswarm/fixtures/negentropy-v1-conformance.json`.

Native Negentropy frames are byte arrays carried as canonical padded base64
strings. Their decoded size is limited to 128 KiB; the outer JSON transport
retains its separate 16 MiB framed-message limit.

Reconciliation uses one fixed history beginning at the MDIP epoch, so each
wire window carries only its variable upper bound, record limit and optional
keyset cursor:

```ts
interface ReconciliationWindow {
  until: number;
  limit: number;
  after?: { ts: number; id: string };
}
```

Every session starts at `windowSeq: 0`. A later window increments the sequence
by one and must exactly match a continuation or smaller round-cap split derived
from the preceding window. `neg_msg` and active-session `neg_close` messages
carry `continuation: null` for an uncapped snapshot or its cursor when capped.
The next `neg_open` repeats that value as `previousContinuation`; an immediate
busy rejection may omit it because no snapshot was admitted.

## Ordered catch-up

Ordered catch-up is optional. A client requests the first page without `after`;
continuation requests carry the exact `cursor` returned by the preceding page
as `after`.

```ts
interface OrderedCursor {
  syncOrder: number;
  id: string; // 64 lowercase hexadecimal characters
}

type OrderedCatchupMessage =
  | { type: 'ordered_catchup_req'; sessionId: string; after?: OrderedCursor }
  | { type: 'ordered_catchup_push'; sessionId: string; cursor: OrderedCursor;
      hasMore: boolean; operations: Operation[] }
  | { type: 'ordered_catchup_done'; sessionId: string };
```

Every push contains at least one operation. Its cursor identifies the final
operation and must advance beyond the requested cursor. `hasMore: true`
authorizes a request using that exact cursor; `hasMore: false` completes the
transfer after the page imports. `ordered_catchup_done` is the distinct
zero-row answer to an outstanding request and carries neither operations nor a
cursor. Only one request is outstanding at a time.
