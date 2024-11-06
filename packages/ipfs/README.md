# MDIP IPFS

MDIP utilities for integrating with IPFS.

## Installation

```bash
npm install @mdip/ipfs
```

## Usage

### Library

The library must be configured by calling the start function:

### REST SDK

The SDK is used to communicate with an IPFS REST API service.

```js
import * as ipfs from '@mdip/ipfs/sdk';

// Try connecting to the gatekeeper service every second,
// and start reporting (chatty) if not connected after 5 attempts
await ipfs.start({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 1,
    chatty: false,
    becomeChattyAfter: 5
});

const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
console.log(JSON.stringify(docs, null, 4));
```
