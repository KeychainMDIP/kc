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
- JSON with memory cache - @mdip/gatekeeper/db/json-cache
- sqlite - @mdip/gatekeeper/db/sqlite
- mongodb - @mdip/gatekeeper/db/mongodb
- redis - @mdip/gatekeeper/db/redis

```js
import Gatekeeper from '@mdip/gatekeeper/lib';
import DbRedis from '@mdip/gatekeeper/db/redis';

const db_redis = new DbRedis('mdip-test');
await db_redis.start();

const gatekeeper = new Gatekeeper({ db: db_redis });
await gatekeeper.start();

const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
console.log(JSON.stringify(docs, null, 4));
```

### Client

The GatekeeperClient is used to communicate with a Gatekeeper REST API service.

```js
import GatekeeperClient from '@mdip/gatekeeper/sdk';

// Try connecting to the gatekeeper service every second,
// and start reporting (chatty) if not connected after 5 attempts
const gatekeeper = new GatekeeperClient();
await gatekeeper.start({
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
