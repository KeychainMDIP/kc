# MDIP Satoshi Inscribed mediator

The Satoshi Inscribed mediator is designed to operate with all blockchains derived from Bitcoin core that support Taproot, that support the standard RPC interface to the blockchain (Feathercoin, Litecoin, Tesseract, etc.)

The mediator has two responsibilities:
- **Import**: Scans all confirmed transactions for MDIP Operations found in a Taproot reveal transaction's witness. If a DID is discovered, the mediator resolves it.
- **Export**: Creates batches and registers them on the blockchain. The mediator polls its corresponding Gatekeeper queue for new operations. If it finds new operations, it creates and sends a new transaction that encodes the operation batch in a Taproot reveal transaction's witness

## Environment variables

| variable                  | default               | description                                                       |
|---------------------------|-----------------------|-------------------------------------------------------------------|
| `KC_NODE_ID       `       | (no default)          | Keymaster agent name                                              |
| `KC_GATEKEEPER_URL`       | http://localhost:4224 | MDIP gatekeeper service URL                                       |
| `KC_KEYMASTER_URL`        | http://localhost:4226 | MDIP keymaster service URL                                        |
| `KC_ENCRYPTED_PASSPHRASE` | (no default)          | If specified, the wallet will be decrypted with this passphrase   |
| `KC_SAT_CHAIN`            | BTC                   | Blockchain ticker symbol                                          |
| `KC_SAT_NETWORK`          | mainnet               | `mainnet` or `testnet`                                            |
| `KC_SAT_HOST`             | localhost             | Host where blockchain node is running                             |
| `KC_SAT_PORT`             | 8332                  | Port where blockchain node is running                             |
| `KC_SAT_WALLET`           | (no default)          | Blockchain node wallet to use                                     |
| `KC_SAT_USER`             | (no default)          | Blockchain node RPC user                                          |
| `KC_SAT_PASS`             | (no default)          | Blockchain node RPC password                                      |
| `KC_SAT_IMPORT_INTERVAL`  | 0                     | Minutes between import cycles (0 to disable)                      |
| `KC_SAT_EXPORT_INTERVAL`  | 0                     | Mintues between export cycles (0 to disable)                      |
| `KC_SAT_FEE_BLOCK_TARGET` | 1                     | Confirmation target for the fee                                   |
| `KC_SAT_FEE_FALLBACK_SAT_BYTE` | 10               | Fallback Sat/Byte if estimatesmartfee does not have enough data   |
| `KC_SAT_FEE_MAX`          | 0.00002               | Maximum transaction fee                                           |
| `KC_SAT_RBF_ENABLED`      | false                 | Whether Replace-By-Fee is enabled                                 |
| `KC_SAT_START_BLOCK`      | 0                     | Blockchain scan starting block index                              |
| `KC_SAT_REIMPORT`         | true                  | Whether to reimport all discovered batches on startup             |
| `KC_SAT_DB`               | json                  | Database adapter, must be `redis`, `json`, `mongodb`, or `sqlite` |
| `KC_LOG_LEVEL`            | info                  | Log level: `debug`, `info`, `warn`, `error`                       |
