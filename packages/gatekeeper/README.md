# MDIP Gatekeeper

Gatekeeper is a node library for the MDIP.
It manages a local database of DIDs on the MDIP network.
Gatekeeper functions are used to Create, Read, Update, and Delete DIDs (CRUD).

## Installation

```bash
npm install @mdip/gatekeeper
```
## Usage

### Library

The library must be configured by calling the start function with one of the supported databases:
- JSON - @mdip/gatekeeper/db/json
- sqlite - @mdip/gatekeeper/db/sqlite
- mongodb - @mdip/gatekeeper/db/mongodb

```js
import * as gatekeeper from '@mdip/gatekeeper/lib';
import * as db_json from '@mdip/gatekeeper/db/json';

await json_db.start('mdip-test');
await gatekeeper.start({ db: db_json });

const did = 'did:test:did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
console.log(JSON.stringify(docs, null, 4));
```

### REST SDK

The SDK is used to communicate with a Gatekeeper REST API service.

```js
import * as gatekeeper from '@mdip/gatekeeper/sdk';

await gatekeeper.start({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});

const did = 'did:test:did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
console.log(JSON.stringify(docs, null, 4));
```
