# MDIP Satoshi mediator

The Satoshi mediator is designed to operate with all blockchains derived from Bitcoin core, that support the standard RPC interface to the blockchain (Feathercoin, Litecoin, Tesseract, etc.)

The mediator has two responsibilities:
- **Import**: Scan all confirmed transactions for MDIP DIDs mentioned in the transaction `OP_CODE`.
  - If a DID is discovered, the mediator resolve it
    - If the DID is a MDIP batch, it imports all the transactions in the batch to the Gatekeeper
- **Export**: Creates batches and registers them on the blockchain
  - The mediator polls its corresponding Gatekeeper queue for new operations
    - If it finds new operations, it creates a new transaction that endodes the batch DID

## Environment variables

| variable              | default                | description                   |
| --------------------- | ---------------------- | ----------------------------- |
| `KC_NODE_ID       `   | (no default)           | Keymaster agent name          |
| `KC_GATEKEEPER_URL`   | http://localhost:4224  | MDIP gatekeeper service URL   |
| `KC_KEYMASTER_URL`    | http://localhost:4226  | MDIP keymaster service URL    |
| `KC_ENCRYPTED_PASSPHRASE` |  (no default) | If specified, the wallet will be decrypted with this passphrase  |
| `KC_SAT_CHAIN`           | BTC | Blockchain ticker symbol |
| `KC_SAT_NETWORK`         | mainnet | `mainnet` or `testnet` |
| `KC_SAT_HOST`            | localhost | Host where blockchain node is running   |
| `KC_SAT_PORT`            | 8332      | Port where blockchain node is running   |
| `KC_SAT_WALLET`          | (no default) | Blockchain node wallet to use  |
| `KC_SAT_USER`            | (no default) | Blockchain node RPC user      |
| `KC_SAT_PASS`            | (no default) | Blockchain node RPC password  |
| `KC_SAT_IMPORT_INTERVAL` | 0 | Minutes between import cycles (0 to disable)  |
| `KC_SAT_EXPORT_INTERVAL` | 0 | Mintues between export cycles (0 to disable)  |
| `KC_SAT_FEE_MIN`         | 0.00002 | Initial transaction fee             |
| `KC_SAT_FEE_MAX`         | 0.00002 | Maximum transaction fee             |
| `KC_SAT_FEE_INC`         | 0.00000 | Transaction fee increment for RBF when transaction is stuck in mempool |
| `KC_SAT_START_BLOCK`     | 0 | Blockchain scan starting block index      |
| `KC_SAT_REIMPORT`        | true | Whether to reimport all discovered batches on startup |
| `KC_SAT_DB`              | json | Database adapter, must be `redis`, `json`, `mongodb`, or `sqlite`               |
