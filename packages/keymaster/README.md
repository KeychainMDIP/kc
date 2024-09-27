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
import * as gatekeeper_sdk from '@mdip/gatekeeper/sdk';
import * as json_wallet from '@mdip/keymaster/db/json';
import * as cipher_node from '@mdip/cipher/node';
import * as keymaster_lib from '@mdip/keymaster/lib';

gatekeeper_sdk.setURL('http://gatekeeper-host:4224');
await gatekeeper_sdk.waitUntilReady();
await keymaster_lib.start(gatekeeper_sdk, json_wallet, cipher_node);

const newId = await keymaster_lib.createId('Bob');
```

#### Browser wallet

```js
import * as gatekeeper_sdk from '@mdip/gatekeeper/sdk';
import * as browser_wallet from '@mdip/keymaster/db/web';
import * as cipher_web from '@mdip/cipher/web';
import * as keymaster_lib from '@mdip/keymaster/lib';

gatekeeper_sdk.setURL('http://gatekeeper-host:4224');
await gatekeeper_sdk.waitUntilReady();
await keymaster_lib.start(gatekeeper_sdk, browser_wallet, cipher_web);

const newId = await keymaster_lib.createId('Bob');
```

### REST SDK

The SDK is used to communicate with a keymaster REST API service.

```js
import * as keymaster_sdk from '@mdip/keymaster/sdk';

keymaster_sdk.setURL('http://keymaster-host:4226');
await keymaster_sdk.waitUntilReady();

const newId = await keymaster_sdk.createId('Bob');
```
