

### Search Server

**search-server** is a Node service that connects to a Gatekeeper instance, syncs DID events through the Gatekeeper index export endpoint, and stores the associated DID documents in a local database. It exposes HTTP endpoints for returning a DID document from a DID or text based queries against the DID documents, returning lists of DIDs that match.

### Quick start

```bash
npm install
npm start
```

### Configuration

Copy the provided environment sample and configure the necessary variables:

```bash
cp sample.env .env
```

Then edit the `.env` file to set your desired configuration:

```env
# The port the server will run on
KC_SEARCH_SERVER_PORT=4002

# URL where your Gatekeeper service is running
KC_SEARCH_SERVER_GATEKEEPER_URL=http://localhost:4224

# How often (in ms) to poll Gatekeeper for new or updated DIDs.
KC_SEARCH_SERVER_REFRESH_INTERVAL_MS=5000

# How often (in ms) to rebuild all daily network metric snapshots.
KC_SEARCH_SERVER_METRICS_REFRESH_INTERVAL_MS=3600000

# Optional network scope: did:test | did:mdip | empty for all networks
KC_SEARCH_SERVER_DID_PREFIX=did:test

# Database adapter: sqlite | postgres | memory
KC_SEARCH_SERVER_DB=sqlite

# Used when KC_SEARCH_SERVER_DB=postgres
# Falls back to KC_POSTGRES_URL when unset
KC_SEARCH_SERVER_POSTGRES_URL=postgresql://mdip:mdip@localhost:5432/mdip

# Trust proxy headers when determining req.ip
KC_SEARCH_SERVER_TRUST_PROXY=false

# API rate limiting
KC_SEARCH_SERVER_RATE_LIMIT_ENABLED=false
KC_SEARCH_SERVER_RATE_LIMIT_WINDOW_VALUE=1
KC_SEARCH_SERVER_RATE_LIMIT_WINDOW_UNIT=minute
KC_SEARCH_SERVER_RATE_LIMIT_MAX_REQUESTS=600
KC_SEARCH_SERVER_RATE_LIMIT_WHITELIST=
KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS=/api/v1/ready,/api/v1/status

# Logging
KC_LOG_LEVEL=info
```

The search database is a rebuildable index and this service does not migrate
older table layouts. Reset an existing search-server database before deploying
a release that changes its schema.

### Endpoints

DID resolution, search, query, event, and credential-metric endpoints apply
`KC_SEARCH_SERVER_DID_PREFIX` when configured. Indexed DID results use the
effective prefix determined by the precedence documented in
[DID network classification](#did-network-classification), not necessarily a
stored alias's prefix.

### `GET /api/v1/ready`
- **Description**: Returns `{ "ready": true }` once the HTTP service is available.

### `GET /api/v1/status`
- **Description**: Returns the database adapter, index synchronization state,
  and the last network-metrics rebuild time or error.

### `GET /api/v1/did/:did`
- **Description**: Returns the DID Document
- **Query Params**:
    - `versionSequence` (optional, positive integer)
    - `versionTime` (optional, timestamp accepted by Gatekeeper resolution)
- **Notes**: Prefix aliases are matched by final CID suffix. A configured
  network scope must match the DID's effective classification; an existing
  storage alias cannot bypass that scope.
- **Returns**:
    - `200 OK` + JSON DID Document if present.
    - `400 Bad Request` for an invalid `versionSequence`.
    - `404 Not Found` if no cached doc is found for the given `:did`.

### `GET /api/v1/did/:did/events`
- **Description**: Returns all indexed events for the DID in operation order.
- **Notes**: DID prefix aliases are matched by final CID suffix and validated
  against the configured network scope.
- **Returns**:
    - `200 OK` + an array of Gatekeeper events.
    - `200 OK` + `[]` if the DID has no indexed events.

### `GET /api/v1/events`
- **Description**: Returns a paginated list of indexed DID events.
- **Query Params**:
    - `registry`, `updatedAfter`, `updatedBefore` (optional)
    - `limit` (optional, default `50`)
    - `offset` (optional, default `0`)
- **Returns**:
    - `200 OK` + `{ "total": 123, "events": [...] }`

### `GET /api/v1/search`
- **Description**: Performs a text search across indexed DID documents in the
  configured network scope and returns matching effective DIDs.
- **Query Param**: q (string)
- **Returns**:
    - 200 OK + [] (empty array) if nothing matches, otherwise an array of DID strings.

### `POST /api/v1/query`
- **Description**: Queries indexed DID documents in the configured network
  scope using a `where` object with an `$in` condition.
- **Body**: `{ "where": { "didDocumentData.type": { "$in": ["value"] } } }`
- **Returns**:
    - `200 OK` + an array of matching effective DIDs.
    - `400 Bad Request` when `where` is missing or is not an object.

### `GET /api/v1/metrics/schemas/published`
- **Description**: Returns current published credential counts grouped by schema DID.
- **Returns**:
    - `200 OK` + `{ "schemas": [{ "schemaDid": "...", "count": 42 }] }`
    - `400 Bad Request` when the removed `date` query parameter is supplied.

### `GET /api/v1/metrics/credentials/published`
- **Description**: Returns published credential rows with optional filtering and pagination.
- **Query Params**:
    - `credentialDid` (optional)
    - `schemaDid` (optional)
    - `issuerDid` (optional)
    - `subjectDid` (optional)
    - `revealed` (optional, `true` or `false`)
    - `limit` (optional, default `50`, maximum `500`)
    - `offset` (optional, default `0`)
- **Notes**:
    - `updatedAt` is derived from the credential manifest entry's `signature.signed` when available, with a fallback to the subject DID document timestamp.
- **Returns**:
    - `200 OK` + `{ "total": 123, "credentials": [{ "credentialDid": "...", "schemaDid": "...", "issuerDid": "...", "subjectDid": "...", "holderDid": "...", "updatedAt": "..." }] }`

### `GET /api/v1/metrics/snapshots/schemas/:date`
- **Description**: Returns cumulative credential counts grouped by schema DID for one UTC day.
- **Path Param**:
    - `date` (required, `YYYY-MM-DD`, must not be in the future)
- **Returns**:
    - `200 OK` + `{ "schemas": [{ "schemaDid": "...", "count": 42 }] }`
    - `400 Bad Request` for an invalid or future date.
    - `404 Not Found` when no snapshot exists for the date.
    - `503 Service Unavailable` while snapshots are rebuilding for the
      configured network scope.

### `GET /api/v1/metrics/snapshots/credentials/:date`
- **Description**: Returns cumulative AgentDID and credential totals plus
  credential schema usage for one UTC day.
- **Path Param**:
    - `date` (required, `YYYY-MM-DD`, must not be in the future)
- **Returns**:
    - `200 OK` + `{ "agentDidCount": 123, "agentDidCountsByPrefix": { "did:mdip": 23, "did:test": 100 }, "credentialCount": 456, "credentialDidCountsByPrefix": { "did:mdip": 56, "did:test": 400 }, "schemas": [{ "schemaDid": "...", "count": 42 }] }`
    - `400 Bad Request` for an invalid or future date.
    - `404 Not Found` when no snapshot exists for the date.
    - `503 Service Unavailable` while snapshots are rebuilding for the
      configured network scope.

### `GET /api/v1/metrics/challenge-receipts`
- **Description**: Returns indexed challenge receipts with optional filtering
  and pagination.
- **Query Params**:
    - `receiptDid`, `attesterDid`, `schemaDid`, `requesterDid`,
      `responseCommitment`, `updatedAfter`, `updatedBefore` (optional)
    - `limit` (optional, default `50`)
    - `offset` (optional, default `0`)
- **Returns**:
    - `200 OK` + `{ "total": 123, "receipts": [...] }`

### `GET /api/v1/metrics/challenge-receipts/usage`
- **Description**: Groups challenge-receipt usage by attester, schema, and
  requester.
- **Query Params**:
    - `attesterDid` (required)
    - `schemaDid`, `requesterDid`, `updatedAfter`, `updatedBefore` (optional)
    - `limit` (optional, default `50`)
    - `offset` (optional, default `0`)
- **Returns**:
    - `200 OK` + `{ "total": 123, "usage": [...] }`
    - `400 Bad Request` when `attesterDid` is missing.

### Network metric snapshots

AgentDID snapshot dates come only from anchor `create` operation `created`
timestamps. Credentials are identified from valid historical AgentDID manifest
entries and dated by their asset anchor `operation.created` when available,
falling back to the manifest credential's `validFrom`. Hyperswarm receipt times
and operation signature timestamps are not used. AgentDIDs remain counted after
deletion, and credentials remain counted after revocation or unpublishing.
Private credentials that have never been published cannot be counted by
search-server.

Historical snapshots are cumulative observations: a credential remains in
snapshots after revocation or unpublishing. The live
`/metrics/credentials/published` and `/metrics/schemas/published` endpoints only
describe credentials in current AgentDID manifests, so their totals can fall.

### DID network classification

The effective prefix precedence is:

1. The signed create operation's explicit `mdip.prefix`.
2. One unique prefix referenced by that DID's update/delete `operation.did`
   values when the create has no explicit prefix.
3. For otherwise unclassified credential and schema assets, one unique prefix
   observed in valid entries across complete historical AgentDID manifests.
4. `did:test` when no unique evidence exists.

Create and update/delete evidence takes precedence over manifest evidence.
Conflicting update/delete prefixes are authoritatively classified as
`did:test`, so manifest evidence cannot move them into another network.
Manifest evidence is stored by source AgentDID during indexing and survives
credential unpublishing, keeping historical schema links resolvable in the same
network scope. Conflicting manifest prefixes fall back to `did:test`. Prefix
aliases sharing a CID suffix are deduplicated.

Set `KC_SEARCH_SERVER_DID_PREFIX` to `did:test` or `did:mdip` to return only
that network from DID, search, event, credential, challenge-receipt, and metric
endpoints. Explicit DIDs using another prefix are excluded from both scopes.
Leave the setting empty to return every indexed network.

Changing the configured scope invalidates the stored snapshot scope before a
rebuild begins. Snapshot endpoints return `503` until the replacement snapshots
and new scope marker have both been saved. This also applies when changing
between a blank scope and `did:test` or `did:mdip`.

Each snapshot stores cumulative credential counts grouped by schema DID,
ordered from most to least used. Request this historical breakdown from
`/metrics/snapshots/schemas/:date`. `/metrics/schemas/published` describes only
the credentials currently present in AgentDID manifests.
Schema prefix aliases sharing the same DID suffix are combined under the
schema asset's explicit classification or durable historical manifest evidence.

Metric dates before the MDIP epoch are included in the `2024-01-01` legacy
baseline. Future-dated entries and entries without a usable timestamp are
omitted. Manifest `validFrom` fallback values must use canonical UTC form
`YYYY-MM-DDTHH:mm:ss.sssZ`. The complete daily history is rebuilt after the
initial index snapshot and then at
`KC_SEARCH_SERVER_METRICS_REFRESH_INTERVAL_MS`, so late operations correct their
metric day and every later snapshot. If a previously missing credential asset
operation arrives, its `operation.created` replaces the `validFrom` fallback on
the next rebuild.

### Published credential metrics

`search-server` also derives metrics for publicly published credentials by reading
subject DID manifests. These metrics only cover credentials that have been
published into a subject DID document; privately held or merely issued
credentials are not included.

### Known limitations

Initial snapshot sync exports DID event histories and preserves accepted DID operation order through the incremental change cursor. It does not currently export Gatekeeper's blockchain table. As a result, a wiped `search-server` can rebuild DID documents and show operations that arrived through Hyperswarm or blockchain registration events, but resolved DID metadata may omit chain timestamp proof details that require block lookups, such as `didDocumentMetadata.timestamp.lowerBound` and `upperBound` block `height`, `hash`, and `time`.

This is intentional for now: `search-server` is not a full Gatekeeper or blockchain indexer. Future work can add block snapshot hydration if the explorer needs complete chain timestamp metadata.

## Contributing

Feel free to open issues or submit pull requests for improvements and new features.
