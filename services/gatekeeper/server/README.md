# MDIP Gatekeeper REST API server

The Gatekeeper service is responsible for guarding the integrity of the local DID database.
Every DID has an associated sequence of operations, starting with a create operation.
The Gatekeeper ensures that only valid and verified operations are added to the DID database so that it can resolve the correct consensus JSON documents for a given DID.

Operations come from Keymaster clients such as end-user wallets and network mediators such as the Hyperswarm mediator (used to distribute operations between nodes) and Bitcoin mediator (used to impose an objective order on operations for network consensus).

## Environment variables

| variable | default | description |
| --- | --- | --- |
| `KC_GATEKEEPER_PORT` | 4224 | Service port |
| `KC_GATEKEEPER_DB` | redis | DID database adapter, must be `redis`, `json`, `mongodb`, or `sqlite` |
| `KC_GATEKEEPER_DID_PREFIX` | did:test | Default prefix assigned to DIDs created |
| `KC_IPFS_ENABLE` | true | Enable IPFS storage for opids and CAS endpoints |
| `KC_GATEKEEPER_GC_INTERVAL` | 15 | The number of minutes between garbage collection cycles (0 to disable) |
| `KC_GATEKEEPER_STATUS_INTERVAL` | 5 | The number of minutes between logging status updates (0 to disable) |
| `KC_GATEKEEPER_TRUST_PROXY` | false | If true, trust upstream proxy headers when determining client IP (`req.ip`) |
| `KC_GATEKEEPER_RATE_LIMIT_ENABLED` | false | Enable API rate limiting |
| `KC_GATEKEEPER_RATE_LIMIT_WINDOW_VALUE` | 1 | Time window size for rate limiting |
| `KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT` | minute | Time unit for rate limiting window: `second`, `minute`, or `hour` |
| `KC_GATEKEEPER_RATE_LIMIT_MAX_REQUESTS` | 600 | Max requests allowed per client during one window |
| `KC_GATEKEEPER_RATE_LIMIT_WHITELIST` | (empty) | Comma-separated IP/CIDR list to bypass limits |
| `KC_GATEKEEPER_RATE_LIMIT_SKIP_PATHS` | /api/v1/ready | Comma-separated API paths excluded from limits |
| `KC_LOG_LEVEL` | info | Log level: `debug`, `info`, `warn`, `error` |

## IPFS disabled mode

Set `KC_IPFS_ENABLE=false` to run Gatekeeper without IPFS. In this mode:
- opids are still generated, but they are not stored in IPFS
- CAS endpoints (`/api/v1/cas/*`) return `503 IPFS disabled`
