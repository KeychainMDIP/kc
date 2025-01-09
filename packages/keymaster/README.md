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
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletJson from '@mdip/keymaster/wallet/json';
import * as cipher_node from '@mdip/cipher/node';
import Keymaster from '@mdip/keymaster';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});
const wallet = new WalletJson();
await keymaster_lib.start({
    gatekeeper,
    wallet,
    cipher: cipher_node
});

const newId = await keymaster_lib.createId('Bob');
```

#### Browser wallet

```js
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletWeb from '@mdip/keymaster/wallet/web';
import * as cipher_web from '@mdip/cipher/web';
import Keymaster from '@mdip/keymaster';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});
const wallet = new WalletWeb();
await keymaster_lib.start({
    gatekeeper,
    wallet,
    cipher: cipher_web
});

const newId = await keymaster_lib.createId('Bob');
```

### Client

The KeymasterClient is used to communicate with a keymaster REST API service.

```js
import KeymasterClient from '@mdip/keymaster/client';

const keymaster = new KeymasterClient();
await keymaster.start({
    url: 'http://keymaster-host:4226',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});

const newId = await keymaster.createId('Bob');
```
