# MDIP Satoshi Inscribed mediator

The Satoshi Inscribed mediator operates with configured Bitcoin-derived chains that support Taproot and the standard Bitcoin Core RPC interface.

The mediator has two responsibilities:

- **Import**: Scans confirmed transactions for tagged MDIP operations stored in Taproot reveal witnesses and imports them into Gatekeeper.
- **Export**: Polls the corresponding Gatekeeper queue and sends commit and reveal transactions that store complete operations in the reveal witnesses.

Unlike the Satoshi mediator, which puts a DID that resolves to an operation batch in `OP_RETURN`, this mediator uses `OP_RETURN` only for an MDIP marker. Complete operation data is stored directly in the Taproot reveal witnesses, and one reveal transaction can contain multiple operations.

The mediator appends `-Inscription` to `KC_SAT_CHAIN`. Gatekeeper currently accepts `BTC-Inscription` and `Signet-Inscription`, so use `BTC` or `Signet` as the base chain.

## Environment variables

| variable                  | default               | description                                                       |
|---------------------------|-----------------------|-------------------------------------------------------------------|
| `KC_NODE_ID`              | (no default)          | Required non-empty value when exporting                           |
| `KC_GATEKEEPER_URL`       | http://localhost:4224 | MDIP gatekeeper service URL                                       |
| `KC_SAT_CHAIN`            | BTC                   | Base chain: `BTC` or `Signet`                                     |
| `KC_SAT_NETWORK`          | bitcoin               | `bitcoin`/`mainnet`, `testnet`, or `regtest`                       |
| `KC_SAT_HOST`             | localhost             | Host where blockchain node is running                             |
| `KC_SAT_PORT`             | 8332                  | Port where blockchain node is running                             |
| `KC_SAT_WALLET`           | (no default)          | Blockchain node wallet to use                                     |
| `KC_SAT_USER`             | (no default)          | Blockchain node RPC user                                          |
| `KC_SAT_PASS`             | (no default)          | Blockchain node RPC password                                      |
| `KC_SAT_IMPORT_INTERVAL`  | 0                     | Minutes between import cycles (0 to disable)                      |
| `KC_SAT_EXPORT_INTERVAL`  | 0                     | Minutes between export cycles (0 to disable)                      |
| `KC_SAT_FEE_BLOCK_TARGET` | 1                     | Fee-estimation confirmation target. It also controls RBF retry timing |
| `KC_SAT_FEE_FALLBACK_SAT_BYTE` | 10               | Fallback Sat/Byte if estimatesmartfee does not have enough data   |
| `KC_SAT_FEE_MAX`          | 0.00002               | BTC threshold used for the export balance warning, commit funding cap, and to decide whether another RBF attempt is allowed |
| `KC_SAT_RBF_ENABLED`      | false                 | Whether Replace-By-Fee is enabled                                 |
| `KC_SAT_START_BLOCK`      | 0                     | Blockchain scan starting block index                              |
| `KC_SAT_REIMPORT`         | true                  | Whether to reimport all discovered operations on startup          |
| `KC_SAT_DB`               | json                  | Database adapter, must be `redis`, `json`, `mongodb`, `sqlite`, or `postgres` |
| `KC_MONGODB_URL`          | mongodb://localhost:27017 | MongoDB connection string when `KC_SAT_DB=mongodb`             |
| `KC_REDIS_URL`            | redis://localhost:6379 | Redis connection string when `KC_SAT_DB=redis`                   |
| `KC_POSTGRES_URL`         | postgresql://mdip:mdip@localhost:5432/mdip | PostgreSQL connection string when `KC_SAT_DB=postgres` |
| `KC_LOG_LEVEL`            | info                  | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` |

Numeric settings are validated at startup. The port must be an integer from 1 to 65535. Intervals must be integers from 0 to 35791 minutes, and the starting block must be a non-negative integer. The fee confirmation target and fallback fee must be positive integers, and the maximum fee must be a positive number.
