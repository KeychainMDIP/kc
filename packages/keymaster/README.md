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
import * as cipher from '@mdip/cipher/node';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as keymaster from '@mdip/keymaster/lib';
import * as json_wallet from '@mdip/keymaster/db/json';

gatekeeper_sdk.setURL('http://gatekeeper-host:4224');
await gatekeeper_sdk.waitUntilReady();
await keymaster.start(gatekeeper, json_wallet, cipher);

const newId = await keymaster.createId('Bob');
```

#### Browser wallet

```js
import * as cipher from '@mdip/cipher/web';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as keymaster from '@mdip/keymaster/lib';
import * as browser_wallet from '@mdip/keymaster/db/web';

gatekeeper_sdk.setURL('http://gatekeeper-host:4224');
await gatekeeper_sdk.waitUntilReady();
await keymaster.start(gatekeeper, browser_wallet, cipher);

const newId = await keymaster.createId('Bob');
```

### REST SDK

The SDK is used to communicate with a keymaster REST API service.

```js
import * as keymaster from '@mdip/keymaster/sdk';

keymaster.setURL('http://keymaster-host:4226');
await keymaster.waitUntilReady();

const newId = await keymaster.createId('Bob');
```
