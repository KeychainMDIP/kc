# MDIP Keymaster

Keymaster is a client library for the MDIP.
It manages a wallet with any number of identities.

## Installation

```bash
npm install @mdip/keymaster
```

## Usage

### Library

The library must be configured by calling the start function with 3 dependencies:
- a configured gatekeeper instance
- a wallet database
- a cipher library (@mdip/cipher/node for servers or @mdip/cipher/web for web browsers)

#### Node application

```js
// Import using subpaths
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletJson from '@mdip/keymaster/wallet/json';
import CipherNode from '@mdip/cipher/node';
import Keymaster from '@mdip/keymaster';

// Non-subpath imports
import { GatekeeperClient } from '@mdip/gatekeeper';
import Keymaster, { WalletJson } from '@mdip/keymaster';
import CipherNode from '@mdip/cipher';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});
const wallet = new WalletJson();
const cipher = new CipherNode();
const keymaster = new Keymaster({
    gatekeeper,
    wallet,
    cipher
});

const newId = await keymaster.createId('Bob');
```

#### Browser wallet

```js
// Import using subpaths
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletWeb from '@mdip/keymaster/wallet/web';
import CipherWeb from '@mdip/cipher/web';
import Keymaster from '@mdip/keymaster';

// Non-subpath imports
import { GatekeeperClient } from '@mdip/gatekeeper';
import Keymaster, { WalletWeb } from '@mdip/keymaster';
import CipherWeb from '@mdip/cipher';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});
const wallet = new WalletWeb();
const cipher = new CipherWeb();
const keymaster = new Keymaster({
    gatekeeper,
    wallet,
    cipher
});

const newId = await keymaster.createId('Bob');
```

### Client

The KeymasterClient is used to communicate with a keymaster REST API service.

```js
// Import using subpaths
import KeymasterClient from '@mdip/keymaster/client';

// Non-subpath imports
import { KeymasterClient } from '@mdip/keymaster';

const keymaster = new KeymasterClient();
await keymaster.connect({
    url: 'http://keymaster-host:4226',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});

const newId = await keymaster.createId('Bob');
```
