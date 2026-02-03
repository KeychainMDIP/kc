

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
SEARCH_SERVER_PORT=4002

# URL where your Gatekeeper service is running
SEARCH_SERVER_GATEKEEPER_URL=http://localhost:4224

# How often (in ms) to poll Gatekeeper for new or updated DIDs.
SEARCH_SERVER_REFRESH_INTERVAL_MS=5000

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

## Contributing

Feel free to open issues or submit pull requests for improvements and new features.
