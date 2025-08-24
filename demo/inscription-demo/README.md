# mdip-inscription-demo

A minimal export-only mediator that demonstrates how to embed `Operation[]` batches on-chain using the `@mdip/inscription` library and the public mempool.space API. It creates Taproot "commit" and "reveal" transactions, broadcasts them, and optionally bumps fees (RBF/CPFP) if they linger unconfirmed.

---

## What this demo does

* Polls Gatekeeper for pending operations under a registry name `${CHAIN}-Inscription`.
* Uses a **single Taproot address** (derived from your BIP86 account xprv + hd key path) to:

    * fund commit outputs for each reveal leaf,
    * receive change,
    * and fund fee bumps.
* Builds and signs transactions fully in-process with `@mdip/inscription`.
* Broadcasts commit+reveal via mempool.space REST.
* Tracks the latest reveal txid and, once `BUMP_BLOCK_TARGET` blocks have passed with no confirmation, bumps its fee using `inscription.bumpTransactionFee`.
* Persists minimal state in `data/mediator.json` via a simple JSON file DB.

> **Note**: This demo only exports (anchors) operations. It does not scan or import from chain.

---

## Requirements

* Node.js 22+
* Access to a running Gatekeeper instance (see `GATEKEEPER_URL` below)
* A funded Taproot address under your BIP86 account (the demo will derive it for you)

---

## Install & run

```bash
npm install
cp sample.env .env
# edit .env with your keys and endpoints
npm start
```

The start step compiles `src/demo.ts` to `dist/demo.js` and runs it.

---

## Environment variables

Copy `sample.env` to `.env` and set the following:

```ini
CHAIN="Signet"                    # Used to form the registry name: ${CHAIN}-Inscription
NETWORK="testnet"                 # One of: bitcoin | testnet | regtest (maps to bitcoinjs-lib networks)
BIP86_XPRV=""                      # BIP86 (m/86/{coin}/{acct}) account-level xprv (testnet: tprv)
TAPROOT_HDKEYPATH="m/86h/1h/0h/0/0" # Full HD path for the specific Taproot address used by the demo
MEMPOOL_API_BASE="https://mempool.space/signet/api"  # Base URL for mempool.space REST (network-specific)
GATEKEEPER_URL="http://localhost:4224"               # Gatekeeper endpoint
FEE_MAX_BTC=0.002                 # Absolute max fee the library is allowed to spend (BTC)
POLL_INTERVAL_SEC=60              # How often to poll the queue and bump logic
BUMP_BLOCK_TARGET=1               # Wait this many new blocks before attempting a bump
```

### Notes on keys & paths

* **BIP86\_XPRV** must be the **account-level** xprv for Taproot (e.g., `m/86'/1'/0'` on test networks). Do not use a seed/master xprv.
* **TAPROOT\_HDKEYPATH** must be a full path to an address under that account, e.g. `m/86h/1h/0h/0/0`. The demo derives the address from the key+path internally.

### Notes on mempool.space URLs

* Mainnet: `https://mempool.space/api`
* Testnet: `https://mempool.space/testnet/api`
* Signet:  `https://mempool.space/signet/api`

---

## How it works (high level)

1. **Gatekeeper queue**: The demo calls `gatekeeper.getQueue("${CHAIN}-Inscription")` once per `POLL_INTERVAL_SEC`.
2. **UTXOs**: It queries mempool.space for UTXOs of the derived Taproot address.
3. **Fee estimate**: It uses `/v1/fees/recommended` and picks `fastestFee` to compute `estSatPerVByte`.
4. **Build + sign**: Calls `inscription.createTransactions(queue, hdkeypath, utxos, estSatPerVByte, accountKeys)` to get `{ commitHex, revealHex, batch }`.
5. **Broadcast chain**: Sends commit, waits until seen in the mempool, then sends reveal (with retry if inputs are not yet indexed).
6. **Persist state**: Stores the pending reveal txid + block height so it can later RBF/CPFP if needed.
7. **Clear queue**: On success, calls `gatekeeper.clearQueue(registry, batch)`.
8. **Bump logic**: After `BUMP_BLOCK_TARGET` blocks with no confirmation, rebuilds a bumped reveal via `inscription.bumpTransactionFee(...)` and broadcasts the replacement.

---

## Persistence format

```ts
export interface MediatorDb {
  pendingTaproot?: {
    commitTxid?: string;
    revealTxids?: string[]; // newest last
    hdkeypath: string;      // path of the Taproot address in use
    blockCount: number;     // height of the last reveal transaction
  };
}
```
