

### Search Server

**search-server** is a Node service that connects to a Gatekeeper instance, fetches newly updated DIDs, and stores the associated DID documents in a local database. It exposes HTTP endpoints for returning a DID document from a DID or text based queries against the DID documents, returning lists of DIDs that match.

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
KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS=/api/v1/ready

# Logging
KC_LOG_LEVEL=info
```

### Endpoints

### `GET /api/v1/did/:did`
- **Description**: Returns the DID Document
- **Returns**:
    - `200 OK` + JSON DID Document if present.
    - `404 Not Found` if no cached doc is found for the given `:did`.

### `GET /api/v1/search`
- **Description**: Performs a text search across all DID documents. Returns an array of matching DIDs.
- **Query Param**: q (string)
- **Returns**:
    - 200 OK + [] (empty array) if nothing matches, otherwise an array of DID strings.

### Published credential metrics

`search-server` also derives metrics for publicly published credentials by reading
subject DID manifests. These metrics only cover credentials that have been
published into a subject DID document; privately held or merely issued
credentials are not included.

### `GET /api/v1/metrics/schemas/published`
- **Description**: Returns counts of published credentials grouped by schema DID.
- **Returns**:
    - `200 OK` + `{ "schemas": [{ "schemaDid": "...", "count": 42 }] }`

### `GET /api/v1/metrics/credentials/published`
- **Description**: Returns published credential rows with optional filtering and pagination.
- **Query Params**:
    - `credentialDid` (optional)
    - `schemaDid` (optional)
    - `issuerDid` (optional)
    - `subjectDid` (optional)
    - `limit` (optional, default `50`)
    - `offset` (optional, default `0`)
- **Notes**:
    - `updatedAt` is derived from the credential manifest entry's `signature.signed` when available, with a fallback to the subject DID document timestamp.
- **Returns**:
    - `200 OK` + `{ "total": 123, "credentials": [{ "credentialDid": "...", "schemaDid": "...", "issuerDid": "...", "subjectDid": "...", "holderDid": "...", "updatedAt": "..." }] }`

## Contributing

Feel free to open issues or submit pull requests for improvements and new features.
