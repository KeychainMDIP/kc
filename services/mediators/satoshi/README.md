# MDIP Satoshi mediator

The Satoshi mediator operates with configured Bitcoin-derived chains that expose a compatible Bitcoin Core RPC interface and `OP_RETURN` transactions.

The mediator has two responsibilities:

- **Import**: Scans confirmed transactions for MDIP DIDs in the `OP_RETURN` field, resolves each discovered batch DID, and imports its operations into Gatekeeper.
- **Export**: Polls the corresponding Gatekeeper queue, creates a batch asset, and sends a transaction containing that batch DID in the `OP_RETURN` field.

Gatekeeper currently accepts the plain-chain registries `TBTC`, `Signet`, and `TFTC`. Bitcoin mainnet uses the inscription mediator and registry `BTC-Inscription`.

## Environment variables

| variable                       | default              | description                   |
|--------------------------------|----------------------| ----------------------------- |
| `KC_NODE_ID`                    | (no default)         | Keymaster agent name, required for exporting |
| `KC_GATEKEEPER_URL`            | http://localhost:4224 | MDIP gatekeeper service URL   |
| `KC_KEYMASTER_URL`             | required             | MDIP keymaster service URL    |
| `KC_SAT_CHAIN`                 | BTC                  | Chain label. Set `TBTC`, `Signet`, or `TFTC` for a Gatekeeper-compatible plain registry |
| `KC_SAT_NETWORK`               | bitcoin              | `bitcoin`/`mainnet`, `testnet`, or `regtest` |
| `KC_SAT_HOST`                  | localhost            | Host where blockchain node is running |
| `KC_SAT_PORT`                  | 8332                 | Port where blockchain node is running |
| `KC_SAT_WALLET`                | (no default)         | Blockchain node wallet to use  |
| `KC_SAT_USER`                  | (no default)         | Blockchain node RPC user      |
| `KC_SAT_PASS`                  | (no default)         | Blockchain node RPC password  |
| `KC_SAT_IMPORT_INTERVAL`       | 0                    | Minutes between import cycles (0 to disable) |
| `KC_SAT_EXPORT_INTERVAL`       | 0                    | Minutes between export cycles (0 to disable) |
| `KC_SAT_FEE_BLOCK_TARGET`      | 1                    | Fee-estimation confirmation target. It also controls RBF retry timing |
| `KC_SAT_FEE_FALLBACK_SAT_BYTE` | 10                   | Fallback Sat/Byte if estimatesmartfee does not have enough data   |
| `KC_SAT_FEE_MAX`               | 0.00002              | Native-coin threshold used for the export balance preflight and to decide whether another RBF attempt is allowed |
| `KC_SAT_RBF_ENABLED`           | false                | Whether Replace-By-Fee is enabled |
| `KC_SAT_START_BLOCK`           | 0                    | Blockchain scan starting block index |
| `KC_SAT_REIMPORT`              | true                 | Whether to reimport all discovered batches on startup |
| `KC_SAT_DB`                    | json                 | Database adapter, must be `redis`, `json`, `mongodb`, `sqlite`, or `postgres` |
| `KC_MONGODB_URL`               | mongodb://localhost:27017 | MongoDB connection string when `KC_SAT_DB=mongodb` |
| `KC_REDIS_URL`                 | redis://localhost:6379 | Redis connection string when `KC_SAT_DB=redis` |
| `KC_POSTGRES_URL`              | postgresql://mdip:mdip@localhost:5432/mdip | PostgreSQL connection string when `KC_SAT_DB=postgres` |
| `KC_LOG_LEVEL`                 | info                 | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` |
