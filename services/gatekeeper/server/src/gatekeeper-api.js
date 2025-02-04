import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonCache from '@mdip/gatekeeper/db/json-cache';
import DbRedis from '@mdip/gatekeeper/db/redis';
import DbSqlite from '@mdip/gatekeeper/db/sqlite';
import DbMongo from '@mdip/gatekeeper/db/mongo';
import config from './config.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

const dbName = 'mdip';
const db = (config.db === 'sqlite') ? new DbSqlite(dbName)
    : (config.db === 'mongodb') ? new DbMongo(dbName)
        : (config.db === 'redis') ? new DbRedis(dbName)
            : (config.db === 'json') ? new DbJsonCache(dbName)
                : (config.db === 'json-cache') ? new DbJsonCache(dbName)
                    : null;
await db.start();

const gatekeeper = new Gatekeeper({ db, didPrefix: config.didPrefix, registries: config.registries });
const startTime = new Date();
const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' })); // Sets the JSON payload limit to 1MB
app.use(cors());

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

v1router.get('/status', async (req, res) => {
    try {
        const status = await getStatus();
        res.json(status);
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
        await checkDids();
    }
    catch (error) {
        console.error(`Error in DID garbage collection: ${error}`);
    }
    setTimeout(gcLoop, config.gcInterval * 60 * 1000);
}

let didCheck;

async function checkDids() {
    console.time('checkDIDs');
    didCheck = await gatekeeper.checkDIDs();
    console.timeEnd('checkDIDs');
}

async function getStatus() {
    return {
        uptimeSeconds: Math.round((new Date() - startTime) / 1000),
        dids: didCheck,
        memoryUsage: process.memoryUsage()
    };
}

async function reportStatus() {
    await checkDids();
    const status = await getStatus();

    console.log('Status -----------------------------');

    console.log(`DID Database (${config.db}):`);
    console.log(`  Total: ${status.dids.total}`);

    if (status.dids.total > 0) {
        console.log(`  By type:`);
        console.log(`    Agents: ${status.dids.byType.agents}`);
        console.log(`    Assets: ${status.dids.byType.assets}`);
        console.log(`    Confirmed: ${status.dids.byType.confirmed}`);
        console.log(`    Unconfirmed: ${status.dids.byType.unconfirmed}`);
        console.log(`    Ephemeral: ${status.dids.byType.ephemeral}`);
        console.log(`    Invalid: ${status.dids.byType.invalid}`);

        console.log(`  By registry:`);
        const registries = Object.keys(status.dids.byRegistry).sort();
        for (let registry of registries) {
            console.log(`    ${registry}: ${status.dids.byRegistry[registry]}`);
        }

        console.log(`  By version:`);
        let count = 0;
        for (let version of [1, 2, 3, 4, 5]) {
            const num = status.dids.byVersion[version] || 0;
            console.log(`    ${version}: ${num}`);
            count += num;
        }
        console.log(`    6+: ${status.dids.total - count}`);
    }

    console.log(`Memory Usage Report:`);
    console.log(`  RSS: ${formatBytes(status.memoryUsage.rss)} (Resident Set Size - total memory allocated for the process)`);
    console.log(`  Heap Total: ${formatBytes(status.memoryUsage.heapTotal)} (Total heap allocated)`);
    console.log(`  Heap Used: ${formatBytes(status.memoryUsage.heapUsed)} (Heap actually used)`);
    console.log(`  External: ${formatBytes(status.memoryUsage.external)} (Memory used by C++ objects bound to JavaScript)`);
    console.log(`  Array Buffers: ${formatBytes(status.memoryUsage.arrayBuffers)} (Memory used by ArrayBuffer and SharedArrayBuffer)`);

    console.log(`Uptime: ${status.uptimeSeconds}s (${formatDuration(status.uptimeSeconds)})`);

    console.log('------------------------------------');
}

function formatDuration(seconds) {
    const secPerMin = 60;
    const secPerHour = secPerMin * 60;
    const secPerDay = secPerHour * 24;

    const days = Math.floor(seconds / secPerDay);
    seconds %= secPerDay;

    const hours = Math.floor(seconds / secPerHour);
    seconds %= secPerHour;

    const minutes = Math.floor(seconds / secPerMin);
    seconds %= secPerMin;

    let duration = "";

    if (days > 0) {
        if (days > 1) {
            duration += `${days} days, `;
        } else {
            duration += `1 day, `;
        }
    }

    if (hours > 0) {
        if (hours > 1) {
            duration += `${hours} hours, `;
        } else {
            duration += `1 hour, `;
        }
    }

    if (minutes > 0) {
        if (minutes > 1) {
            duration += `${minutes} minutes, `;
        } else {
            duration += `1 minute, `;
        }
    }

    if (seconds === 1) {
        duration += `1 second`;
    } else {
        duration += `${seconds} seconds`;
    }

    return duration;
}

function formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

async function main() {
    console.log(`Starting KeychainMDIP Gatekeeper with a db (${config.db}) check...`);
    await reportStatus();
    setInterval(reportStatus, config.statusInterval * 60 * 1000);

    console.log(`Starting DID garbage collection in ${config.gcInterval} minutes`);
    setTimeout(gcLoop, config.gcInterval * 60 * 1000);

    console.log(`DID prefix: ${JSON.stringify(gatekeeper.didPrefix)}`);
    console.log(`Supported registries: ${JSON.stringify(gatekeeper.supportedRegistries)}`);

    app.listen(config.port, () => {
        console.log(`Server is running on port ${config.port}`);
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
