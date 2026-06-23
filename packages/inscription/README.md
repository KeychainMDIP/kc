# @mdip/inscription

High‑level TypeScript/JavaScript library for creating and fee‑bumping Taproot inscription transactions using `bitcoinjs-lib`. It builds the standard two‑transaction flow (commit + reveal) and supports both P2TR and P2WPKH funding inputs. The library signs entirely in‑process using account‑level BIP32 extended private keys (xprv/tprv), no external signers or PSBT hand‑offs required.

---

## Installation

```bash
npm install @mdip/inscription
```

```ts
import Inscription from '@mdip/inscription';

const inscription = new Inscription({
  feeMax: 0.002,        // maximum total BTC fee you are willing to pay
  network: 'bitcoin',   // 'bitcoin' | 'testnet' | 'regtest'
});
```

---

## Security Model

* **Pass only account‑level xprvs**, not your root seed. The lib never needs the master seed and never persists keys.
* Required keys:

    * **BIP86** account xprv (Taproot): `m/86'/{coin}'/{account}'` **mandatory**
    * **BIP84** account xprv (bech32): `m/84'/{coin}'/{account}'` **optional**, only if funding with P2WPKH UTXOs
* `coin` is `0` for mainnet and `1` for testnets/regtest.

---

## Types

```ts
export type NetworkName = 'bitcoin' | 'testnet' | 'regtest';

export type SupportedTypes = 'p2wpkh' | 'p2tr';

export interface FundInput {
  type: SupportedTypes;   // 'p2wpkh' or 'p2tr'
  txid: string;           // funding txid
  vout: number;           // output index
  amount: number;         // amount in satoshis
  hdkeypath: string;      // full path, e.g. m/86/1/0/0/123
}

export interface AccountKeys {
  bip86: string;          // account xprv/tprv for BIP86 (Taproot)
  bip84?: string;         // account xprv/tprv for BIP84 (bech32), if using P2WPKH inputs
}

export interface InscriptionOptions {
  feeMax: number;         // maximum total fee in BTC (e.g., 0.002)
  network: NetworkName;   // 'bitcoin' | 'testnet' | 'regtest'
}
```

> **Note:** `FundInput.amount` is satoshis (number). `hdkeypath` must be a concrete child path under the relevant account.

---

## API

### `new Inscription(options: InscriptionOptions)`

Creates an instance configured for your network and fee cap.

---

### `createTransactions(queue, hdkeypath, utxos, estSatPerVByte, keys)`

Builds and signs the commit and reveal transactions for a batch of operations.

**Parameters**

* `queue: Operation[]` — The operations to inscribe (e.g., from `gatekeeper.getQueue(...)`). The library will pack as many as fit under its internal size limits.
* `hdkeypath: string` — Full BIP86 derivation path for the Taproot address that:

    * receives the commit change, and
    * is used to create the Taproot outputs that will later be spent in the reveal.

  If used a package with a single Taproot key define its hdkeypath here. 
* `utxos: FundInput[]` — Funding UTXOs from either this Taproot branch or other addresses under the same BIP84/BIP86 account keys.
* `estSatPerVByte: number` — Target fee rate in sat/vB used to estimate and set fees.
* `keys: AccountKeys` — Account‑level extended private keys used for signing.

**Returns**

```ts
{
  commitHex: string;  // raw hex of the commit transaction
  revealHex: string;  // raw hex of the reveal transaction
  batch: Operation[]; // the subset of queue that was actually inscribed
}
```

**Broadcasting**
Send both `commitHex` and `revealHex` immediately, in order (commit first). The reveal can sit in the mempool while the commit is unconfirmed.

**Example**

```ts
import Inscription from '@mdip/inscription';

const inscription = new Inscription({ feeMax: 0.002, network: 'bitcoin' });
const queue = await gatekeeper.getQueue(REGISTRY);

const { commitHex, revealHex, batch } = await inscription.createTransactions(
  queue,                    // Operation[]
  "m/86/0/0/0/0",           // Taproot address path for outputs/change
  utxos,                    // FundInput[] (P2TR/P2WPKH) under the same accounts
  35,                       // estSatPerVByte (sat/vB)
  {
    bip86: 'xprv…',         // BIP86 account xprv (required)
    bip84: 'xprv…',         // BIP84 account xprv (optional if using P2WPKH)
  }
);

await gatekeeper.clearQueue(REGISTRY, batch);
// broadcast commitHex then revealHex
```

---

### `bumpTransactionFee(hdkeypath, utxos, curSatPerVb, estSatPerVByte, keys, commitHex, revealHex)`

Creates a replacement reveal transaction at a higher fee rate. This is a CPFP/RBF‑style bump that can add new inputs (P2TR and/or P2WPKH) and sends change back to the provided Taproot path.

**Parameters**

* `hdkeypath: string` — Full BIP86 path for the Taproot change and reveal spending key (same as in `createTransactions`).
* `utxos: FundInput[]` — Additional funding UTXOs (P2TR/P2WPKH) under the same account keys.
* `curSatPerVb: number` — Current fee rate (sat/vB) you’re paying on the existing reveal in the mempool.
* `estSatPerVByte: number` — Target fee rate (sat/vB). The new reveal will aim for this or the minimum possible above the current fee, whichever is higher.
* `keys: AccountKeys` — Account‑level xprvs used to sign any added inputs and the taproot spend.
* `commitHex: string` — Raw hex of the original commit transaction.
* `revealHex: string` — Raw hex of the original or most revently bumped reveal transaction to bump.

**Returns**

* `string` — Raw hex of the new reveal transaction (broadcast this to bump the fee).

**Example**

```ts
const newRevealHex = await inscription.bumpTransactionFee(
  "m/86/0/0/0/0",
  utxos,             // new UTXOs to fund the bump
  25,                // curSatPerVb currently paid by reveal
  40,                // estSatPerVByte target
  {
      bip86: 'xprv…',         // BIP86 account xprv (required)
        bip84: 'xprv…',         // BIP84 account xprv (optional if using P2WPKH)
  },
  commitHex,
  revealHex
);
// broadcast newRevealHex
```

---

# Address derivation helpers

The library exposes convenience methods to derive addresses directly from account‑level xprv keys and a full BIP32 path.

> ⚠️ These helpers expect account xprvs (e.g., BIP86: `m/86'/{coin}'/{acct}'` and BIP84: `m/84'/{coin}'/{acct}'`).

## `deriveP2TRAddress(bip86Xprv: string, hdkeypath: string): string`

Derives a Taproot (BIP86) bech32m address from an account‑level BIP86 xprv and an address path.

* **Parameters**

    * `bip86Xprv` – Account‑level extended private key for BIP86 (e.g., `tprv...` on testnet, `xprv...` on mainnet).
    * `hdkeypath` – Full BIP32 path to the desired address under that account (e.g., `m/86/1/0'/0/0`).
* **Returns**: A Taproot bech32m address string (e.g., `tb1p...` on testnet or `bc1p...` on mainnet).

**Example**

```ts
import Inscription from '@mdip/inscription';
import { logger } from '@mdip/common/logger';

const ins = new Inscription({ feeMax: 0.002, network: 'testnet' });
const addr = ins.deriveP2TRAddress(process.env.BIP86_XPRV, "m/86/1/0/0/0");
logger.info(`Taproot address: ${addr}`);
```

---

## `deriveP2WPKHAddress(bip84Xprv: string, hdkeypath: string): string`

Derives a Native SegWit (BIP84) bech32 P2WPKH address from an account‑level BIP84 xprv and an address path.

* **Parameters**

    * `bip84Xprv` – Account‑level extended private key for BIP84 (e.g., `tprv...` on testnet, `xprv...` on mainnet).
    * `hdkeypath` – Full BIP32 path under that account (e.g., `m/84/1/0/0/0`).
* **Returns**: A bech32 P2WPKH address string (e.g., `tb1q...` on testnet or `bc1q...` on mainnet).


**Example**

```ts
import Inscription from '@mdip/inscription';
import { logger } from '@mdip/common/logger';

const ins = new Inscription({ feeMax: 0.002, network: 'testnet' });
const addr = ins.deriveP2WPKHAddress(process.env.BIP84_XPRV, "m/84/1/0/0/0");
logger.info(`P2WPKH address: ${addr}`);
```

---

## Notes & Best Practices

* **Account keys vs seed**: Always pass account‑level xprvs (BIP86/BIP84). Do not pass your root seed.
* **UTXO amounts**: Provide `amount` in satoshis.
* **Mixed inputs**: You may fund with a mixture of P2TR and P2WPKH UTXOs. If you include P2WPKH, you must provide `keys.bip84`.
* **Change**: Commit and fee‑bumped reveal change will return to the Taproot address derived from `hdkeypath`.
* **Broadcast order**: Broadcast `commitHex` first, then `revealHex`. Both may remain unconfirmed together.
* **Limits**: The library enforces an inscription payload limit to keep reveals standard.
