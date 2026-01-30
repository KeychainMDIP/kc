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
// Import using subpaths
import Gatekeeper from '@mdip/gatekeeper';
import DbRedis from '@mdip/gatekeeper/db/redis';
import { logger } from '@mdip/common/logger';

// Non-subpath imports
import Gatekeeper, { DbRedis } from '@mdip/gatekeeper';

const db_redis = new DbRedis('mdip-test');
await db_redis.start();

const gatekeeper = new Gatekeeper({ db: db_redis });
const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
logger.info(JSON.stringify(docs, null, 4));
```

### Client

The GatekeeperClient is used to communicate with a Gatekeeper REST API service.

```js
// Import using subpaths
import GatekeeperClient from '@mdip/gatekeeper/client';
import { logger } from '@mdip/common/logger';

// Non-subpath imports
import { GatekeeperClient } from '@mdip/gatekeeper';

// Try connecting to the gatekeeper service every second,
// and start reporting (chatty) if not connected after 5 attempts
const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 1,
    chatty: false,
    becomeChattyAfter: 5
});

const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const docs = await gatekeeper.resolveDID(did);
logger.info(JSON.stringify(docs, null, 4));
```
