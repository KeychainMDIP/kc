import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gatekeeper from './gatekeeper-lib.js';
import config from './config.js';
import * as db_json from './db-json.js';
import * as db_sqlite from './db-sqlite.js';
import * as db_mongodb from './db-mongodb.js';
import * as db_redis from './db-redis.js';
import * as helia from './helia-sdk.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

const db = (config.gatekeeperDb === 'sqlite') ? db_sqlite
    : (config.gatekeeperDb === 'mongodb') ? db_mongodb
        : (config.gatekeeperDb === 'redis') ? db_redis
            : db_json;

await db.start('mdip');
await gatekeeper.start(db, helia);

const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' })); // Sets the JSON payload limit to 1MB

// Define __dirname in ES module scope
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the React frontend
app.use(express.static(path.join(__dirname, 'keymaster-app/build')));

let serverReady = false;

v1router.get('/ready', async (req, res) => {
    try {
        res.json(serverReady);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.get('/version', async (req, res) => {
    try {
        res.json(1);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

// TBD temporary
v1router.get('/db/reset', async (req, res) => {
    return gatekeeper.resetDb()
        .then(() => res.json(true))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/did', async (req, res) => {
    const operation = req.body;
    return gatekeeper.createDID(operation)
        .then(did => res.json(did))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.get('/did/:did', async (req, res) => {
    const options = {};

    if (req.query.atTime) {
        options.atTime = req.query.atTime;
    }

    if (req.query.atVersion) {
        options.atVersion = parseInt(req.query.atVersion);
    }

    if (req.query.confirm) {
        options.confirm = req.query.confirm === 'true';
    }

    if (req.query.verify) {
        options.verify = req.query.verify === 'true';
    }

    return gatekeeper.resolveDID(req.params.did, options)
        .then(doc => res.json(doc))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/did/:did', async (req, res) => {
    const operation = req.body;
    return gatekeeper.updateDID(operation)
        .then(ok => res.json(ok))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.delete('/did/:did', async (req, res) => {
    const operation = req.body;
    return gatekeeper.deleteDID(operation)
        .then(ok => res.json(ok))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/dids/', async (req, res) => {
    return gatekeeper.getDIDs(req.body)
        .then(dids => res.json(dids))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/dids/remove', async (req, res) => {
    const dids = req.body;
    return gatekeeper.removeDIDs(dids)
        .then(response => res.json(response))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/dids/export', async (req, res) => {
    const { dids } = req.body;
    return gatekeeper.exportDIDs(dids)
        .then(response => res.json(response))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/dids/import', async (req, res) => {
    const dids = req.body;
    return gatekeeper.importDIDs(dids)
        .then(response => res.json(response))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/batch/export', async (req, res) => {
    const { dids } = req.body;
    return gatekeeper.exportBatch(dids)
        .then(response => res.json(response))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/batch/import', async (req, res) => {
    const batch = req.body;
    return gatekeeper.importBatch(batch)
        .then(response => res.json(response))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.get('/queue/:registry', async (req, res) => {
    gatekeeper.getQueue(req.params.registry)
        .then(queue => res.json(queue))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.post('/queue/:registry/clear', async (req, res) => {
    const events = req.body;
    return gatekeeper.clearQueue(req.params.registry, events)
        .then(queue => res.json(queue))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

v1router.get('/registries', async (req, res) => {
    return gatekeeper.listRegistries()
        .then(response => res.json(response))
        .catch((error) => {
            console.error(error);
            res.status(500).send(error.toString());
        });
});

app.get('/explore/:did', async (req, res) => {
    try {
        const doc = await gatekeeper.resolveDID(req.params.did, { atTime: req.query.atTime });
        var hthead = '<html><body>';
        hthead = hthead + '<h1>MDIP Network Explorer</h1>';
        hthead = hthead + '<table><tr><td><h3>' + req.params.did + '</h3></td>';
        var htdoc = JSON.stringify(doc, null, 5);
        htdoc = htdoc.replace(/"didDocument"/g, '"<b>didDocument</b>"');
        htdoc = htdoc.replace(/"didDocumentMetadata"/g, '"<b>didDocumentMetadata</b>"');
        htdoc = htdoc.replace(/"manifest"/g, '"<b>manifest</b>"');
        htdoc = htdoc.replace(/"issuer"/g, '"<b>issuer</b>"');
        htdoc = htdoc.replace(/"signer"/g, '"<b>signer</b>"');
        htdoc = htdoc.replace(/"id"/g, '"<b>id</b>"');
        htdoc = htdoc.replace(/"credential"/g, '"<b>credential</b>"');
        htdoc = htdoc.replace(/"vault"/g, '"<b>vault</b>"');
        htdoc = htdoc.replace(/"(did:test:.*)"/g, '"<a href="/explore/$1">$1</a>"');
        htdoc = hthead + '<tr><td><hr><pre>' + htdoc + '</pre><hr></td></tr>';
        var now = new Date();
        htdoc = htdoc + '</table>' + now + '</body></html>';
        res.send(htdoc);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.use('/api/v1', v1router);

app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'keymaster-app/build', 'index.html'));
    } else {
        console.warn(`Warning: Unhandled API endpoint - ${req.method} ${req.originalUrl}`);
        res.status(404).json({ message: 'Endpoint not found' });
    }
});

async function main() {
    const invalid = await gatekeeper.verifyDb();

    if (invalid > 0) {
        console.log(`${invalid} invalid DIDs removed from MDIP db`);
    }

    const registries = await gatekeeper.initRegistries(config.gatekeeperRegistries);
    const port = config.gatekeeperPort;
    const db = config.gatekeeperDb;

    app.listen(port, () => {
        console.log(`Server is running on port ${port}, persisting with ${db}`);
        console.log(`Supported registries: ${registries}`);
        serverReady = true;
    });
}

main();

process.on('uncaughtException', (error) => {
    console.error('Unhandled exception caught', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection caught', reason, promise);
});

