# MDIP Keymaster REST API server

The Keymaster service exposes the Keymaster client library as a REST API.
This is necessary if the client is written is a programming language other than Javascript or Typescript, such as python.
This service is also useful when clients share a wallet, such as the `kc` CLI and MDIP mediators running on a server node.

## Environment variables

| variable | default | description |
| --- | --- | --- |
| `KC_GATEKEEPER_URL` | http://localhost:4224 | MDIP gatekeeper service URL |
| `KC_KEYMASTER_PORT` | 4226 | Service port |
| `KC_KEYMASTER_DB` | json | Wallet database adapter, must be `redis`, `json`, `mongodb`, or `sqlite` |
| `KC_ENCRYPTED_PASSPHRASE` | (no default) | If specified, the wallet will be encrypted and decrypted with this passphrase |
| `KC_WALLET_CACHE` | false | Use wallet cache to increase performance (but understand security implications) |
| `KC_DEFAULT_REGISTRY` | hyperswarm | Default registry to use when creating DIDs |
| `KC_KEYMASTER_TRUST_PROXY` | false | If true, trust upstream proxy headers when determining client IP (`req.ip`) |
| `KC_KEYMASTER_RATE_LIMIT_ENABLED` | false | Enable API rate limiting |
| `KC_KEYMASTER_RATE_LIMIT_WINDOW_VALUE` | 1 | Time window size for rate limiting |
| `KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT` | minute | Time unit for rate limiting window: `second`, `minute`, or `hour` |
| `KC_KEYMASTER_RATE_LIMIT_MAX_REQUESTS` | 600 | Max requests allowed per client during one window |
| `KC_KEYMASTER_RATE_LIMIT_WHITELIST` | (empty) | Comma-separated IP/CIDR list to bypass limits |
| `KC_KEYMASTER_RATE_LIMIT_SKIP_PATHS` | /api/v1/ready | Comma-separated API paths excluded from limits |
| `KC_LOG_LEVEL` | info | Log level: `debug`, `info`, `warn`, `error` |
