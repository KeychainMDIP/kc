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
import CipherNode from '@mdip/cipher/node';
import Keymaster from '@mdip/keymaster';

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
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletWeb from '@mdip/keymaster/wallet/web';
import CipherWeb from '@mdip/cipher/web';
import Keymaster from '@mdip/keymaster';

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
