import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gatekeeper from '@mdip/gatekeeper/lib';
import * as db_json from '@mdip/gatekeeper/db/json';
import * as db_json_cache from '@mdip/gatekeeper/db/json-cache';
import * as db_sqlite from '@mdip/gatekeeper/db/sqlite';
import * as db_mongodb from '@mdip/gatekeeper/db/mongodb';
import * as db_redis from '@mdip/gatekeeper/db/redis';
import config from './config.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

const db = (config.db === 'sqlite') ? db_sqlite
    : (config.db === 'mongodb') ? db_mongodb
        : (config.db === 'redis') ? db_redis
            : (config.db === 'json') ? db_json
                : (config.db === 'json-cache') ? db_json_cache
                    : null;

await db.start('mdip');
await gatekeeper.start({ db, primeCache: true });

const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' })); // Sets the JSON payload limit to 1MB

// Define __dirname in ES module scope
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the React frontend
app.use(express.static(path.join(__dirname, '../../client/build')));

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

v1router.post('/did', async (req, res) => {
    try {
        const operation = req.body;
        const did = await gatekeeper.createDID(operation);
        res.json(did);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.get('/did/:did', async (req, res) => {
    try {
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

        const doc = await gatekeeper.resolveDID(req.params.did, options);
        res.json(doc);
    } catch (error) {
        return res.status(404).send({ error: 'DID not found' });
    }
});

v1router.post('/did/:did', async (req, res) => {
    try {
        const operation = req.body;
        const ok = await gatekeeper.updateDID(operation);
        res.json(ok);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.delete('/did/:did', async (req, res) => {
    try {
        const operation = req.body;
        const ok = await gatekeeper.deleteDID(operation);
        res.json(ok);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/dids/', async (req, res) => {
    try {
        const dids = await gatekeeper.getDIDs(req.body);
        res.json(dids);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/dids/remove', async (req, res) => {
    try {
        const dids = req.body;
        const response = await gatekeeper.removeDIDs(dids);
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/dids/export', async (req, res) => {
    try {
        const { dids } = req.body;
        const response = await gatekeeper.exportDIDs(dids);
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/dids/import', async (req, res) => {
    try {
        const dids = req.body;
        const response = await gatekeeper.importDIDs(dids);
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/batch/export', async (req, res) => {
    try {
        const { dids } = req.body;
        const response = await gatekeeper.exportBatch(dids);
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/batch/import', async (req, res) => {
    try {
        const batch = req.body;
        const response = await gatekeeper.importBatch(batch);
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.get('/queue/:registry', async (req, res) => {
    try {
        const queue = await gatekeeper.getQueue(req.params.registry);
        res.json(queue);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/queue/:registry/clear', async (req, res) => {
    try {
        const events = req.body;
        const queue = await gatekeeper.clearQueue(req.params.registry, events);
        res.json(queue);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.get('/registries', async (req, res) => {
    try {
        const registries = await gatekeeper.listRegistries();
        res.json(registries);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

// TBD lock it down
v1router.get('/db/reset', async (req, res) => {
    try {
        await gatekeeper.resetDb();
        res.json(true);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.get('/db/verify', async (req, res) => {
    try {
        const response = await gatekeeper.verifyDb();
        res.json(response);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/events/process', async (req, res) => {
    try {
        const response = await gatekeeper.processEvents();
        res.json(response);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

app.use('/api/v1', v1router);

app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../../client/build', 'index.html'));
    } else {
        console.warn(`Warning: Unhandled API endpoint - ${req.method} ${req.originalUrl}`);
        res.status(404).json({ message: 'Endpoint not found' });
    }
});

async function gcLoop() {
    try {
        const response = await gatekeeper.verifyDb();
        console.log(`DID garbage collection: ${JSON.stringify(response)} waiting ${config.gcInterval} minutes...`);
    }
    catch (error) {
        console.error(`Error in DID garbage collection: ${error}`);
    }
    setTimeout(gcLoop, config.gcInterval * 60 * 1000);
}

async function main() {
    console.time('checkDb');
    const check = await gatekeeper.checkDb();
    console.timeEnd('checkDb');
    console.log(`check: ${JSON.stringify(check)}`);

    console.log(`Starting DID garbage collection in ${config.gcInterval} minutes`);
    setTimeout(gcLoop, config.gcInterval * 60 * 1000);

    const registries = await gatekeeper.initRegistries(config.registries);

    app.listen(config.port, () => {
        console.log(`Server is running on port ${config.port}, persisting with ${config.db}`);
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

function reportMemoryUsage() {
    const memoryUsage = process.memoryUsage();

    console.log('Memory Usage Report:');
    console.log(`  RSS: ${formatBytes(memoryUsage.rss)} (Resident Set Size - total memory allocated for the process)`);
    console.log(`  Heap Total: ${formatBytes(memoryUsage.heapTotal)} (Total heap allocated)`);
    console.log(`  Heap Used: ${formatBytes(memoryUsage.heapUsed)} (Heap actually used)`);
    console.log(`  External: ${formatBytes(memoryUsage.external)} (Memory used by C++ objects bound to JavaScript)`);
    console.log(`  Array Buffers: ${formatBytes(memoryUsage.arrayBuffers)} (Memory used by ArrayBuffer and SharedArrayBuffer)`);

    console.log('------------------------------------');
}

function formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Example: Report memory usage every 60 seconds
setInterval(reportMemoryUsage, 60 * 1000);
