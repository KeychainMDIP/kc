# MDIP Keymaster

Keymaster is a client library for the MDIP.
It manages a wallet with any number of identities.

## Installation

```bash
npm install @mdip/keymaster
```

## Usage

### Library

Construct the library with four dependencies:

- a configured gatekeeper instance
- a metadata store
- a wallet provider for signing, encryption, and key management
- a cipher library (@mdip/cipher/node for servers or @mdip/cipher/web for web browsers)

Install the Gatekeeper and cipher packages when using Keymaster as an embedded library:

```bash
npm install @mdip/gatekeeper @mdip/cipher
```

#### Node application

```js
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletJson from '@mdip/keymaster/wallet/json';
import CipherNode from '@mdip/cipher/node';
import Keymaster, { MnemonicHdWalletProvider } from '@mdip/keymaster';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});
const store = new WalletJson();
const providerStore = new WalletJson('wallet-provider.json');
const cipher = new CipherNode();
const passphrase = 'SuperSecurePassphrase';
const walletProvider = new MnemonicHdWalletProvider({ store: providerStore, cipher, passphrase });
const keymaster = new Keymaster({
    gatekeeper,
    store,
    walletProvider,
    cipher,
    didPrefix: 'did:test'
});

const newId = await keymaster.createId('Bob');
```

#### Browser wallet

```js
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletWeb from '@mdip/keymaster/wallet/web';
import CipherWeb from '@mdip/cipher/web';
import Keymaster, { MnemonicHdWalletProvider } from '@mdip/keymaster';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});
const store = new WalletWeb();
const providerStore = new WalletWeb('mdip-wallet-provider');
const cipher = new CipherWeb();
const passphrase = 'SuperSecurePassphrase';
const walletProvider = new MnemonicHdWalletProvider({ store: providerStore, cipher, passphrase });
const keymaster = new Keymaster({
    gatekeeper,
    store,
    walletProvider,
    cipher,
    didPrefix: 'did:test'
});

const newId = await keymaster.createId('Bob');
```

The metadata store contains v2 identity metadata and provider key references. The
mnemonic provider stores the encrypted mnemonic and derivation state separately.
Use `exportWalletBundle()` and `importWalletBundle()` for a complete backup; v2
metadata alone cannot restore provider keys. Standalone metadata saves must reference
keys already registered by the active provider. Existing v0/v1 wallets migrate when
loaded with `MnemonicHdWalletProvider`. Encrypted identity backups created by
older wallets remain recoverable.

`newWallet(mnemonic, true)` initializes a mnemonic without requiring a published
backup. Call `recoverWallet()` separately to restore a published wallet backup;
lookup, decryption, and persistence failures are returned to the caller.

### Client

The KeymasterClient is used to communicate with a keymaster REST API service.

```js
import KeymasterClient from '@mdip/keymaster/client';

const keymaster = new KeymasterClient();
await keymaster.connect({
    url: 'http://keymaster-host:4226',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});

const newId = await keymaster.createId('Bob');
```

`KeymasterClient` and `SearchClient` requests time out after 60 seconds by
default. Set `timeoutMs` to use a different positive, finite deadline. Long-running
services can pass an `AbortSignal` as `signal`. Aborting it cancels active
requests and readiness waits.

### Wallet cleanup

`fixWallet()` removes malformed DIDs and entries whose resolved DID document is
deactivated. If resolution fails, including a `notFound` result, cleanup stops
without saving any removals. A DID missing from one Gatekeeper may not have
synchronized yet. If cleanup removes the current identity, it selects the first
remaining identity, or clears `current` if none remain.
