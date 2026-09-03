# MDIP Keymaster REST API server

The Keymaster service exposes the Keymaster client library as a REST API.
This is useful when the client is written in a programming language other than JavaScript or TypeScript.
This service is also useful when clients share a wallet, such as the `kc` CLI and MDIP mediators running on a server node.

## Environment variables

| variable | default | description |
| --- | --- | --- |
| `KC_GATEKEEPER_URL` | http://localhost:4224 | MDIP gatekeeper service URL |
| `KC_SEARCH_URL` | http://localhost:4002 | MDIP search service URL |
| `KC_DISABLE_SEARCH` | false | Disable search-service integration |
| `KC_KEYMASTER_PORT` | 4226 | Service port |
| `KC_NODE_ID` | required | Node identity name to create if missing and resolve at startup |
| `KC_KEYMASTER_DB` | json | Wallet database adapter, must be `redis`, `json`, `mongodb`, `sqlite`, or `postgres` |
| `KC_ENCRYPTED_PASSPHRASE` | required | Passphrase used to encrypt and decrypt the server wallet |
| `KC_WALLET_CACHE` | false | Use wallet cache to increase performance (but understand security implications) |
| `KC_DEFAULT_REGISTRY` | hyperswarm | Default registry to use when creating DIDs |
| `KC_KEYMASTER_DID_PREFIX` | (empty) | Optional `did:<method>` prefix embedded in new signed create operations. Method names use only lowercase letters and digits |
| `KC_KEYMASTER_SERVE_CLIENT` | true | Serve the Keymaster web client from the API process |
| `KC_KEYMASTER_TRUST_PROXY` | false | If true, trust upstream proxy headers when determining client IP (`req.ip`) |
| `KC_KEYMASTER_RATE_LIMIT_ENABLED` | false | Enable API rate limiting |
| `KC_KEYMASTER_RATE_LIMIT_WINDOW_VALUE` | 1 | Time window size for rate limiting |
| `KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT` | minute | Time unit for rate limiting window: `second`, `minute`, or `hour` |
| `KC_KEYMASTER_RATE_LIMIT_MAX_REQUESTS` | 600 | Max requests allowed per client during one window |
| `KC_KEYMASTER_RATE_LIMIT_WHITELIST` | (empty) | Comma-separated IP/CIDR list to bypass limits |
| `KC_KEYMASTER_RATE_LIMIT_SKIP_PATHS` | /api/v1/ready | Comma-separated API paths excluded from limits |
| `KC_MONGODB_URL` | mongodb://localhost:27017 | MongoDB connection string when `KC_KEYMASTER_DB=mongodb` |
| `KC_REDIS_URL` | redis://localhost:6379 | Redis connection string when `KC_KEYMASTER_DB=redis` |
| `KC_POSTGRES_URL` | postgresql://mdip:mdip@localhost:5432/mdip | PostgreSQL connection string when `KC_KEYMASTER_DB=postgres` |
| `KC_LOG_LEVEL` | info | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` |
