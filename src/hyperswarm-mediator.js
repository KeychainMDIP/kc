import fs from 'fs';
import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import asyncLib from 'async';
import { EventEmitter } from 'events';

import * as gatekeeper from './gatekeeper-sdk.js';
import * as cipher from './cipher-lib.js';
import config from './config.js';

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const BATCH_SIZE = 100;
const PROTOCOL = '/MDIP/v24.08.16';

const nodes = {};
const batchesSeen = {};

// Keep track of all connections
let connections = [];
const connectionLastSeen = {};
const connectionNodeName = {};

let swarm = null;
let peerName = '';

goodbye(() => {
    if (swarm) {
        swarm.destroy();
    }
});

async function createSwarm() {
    if (swarm) {
        swarm.destroy();
    }

    swarm = new Hyperswarm();
    peerName = b4a.toString(swarm.keyPair.publicKey, 'hex');

    swarm.on('connection', conn => addConnection(conn));

    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();

    const shortTopic = shortName(b4a.toString(topic, 'hex'));
    console.log(`new hyperswarm peer id: ${shortName(peerName)} (${config.nodeName}) joined topic: ${shortTopic} using protocol: ${PROTOCOL}`);
}

async function addConnection(conn) {
    connections.push(conn);

    const name = b4a.toString(conn.remotePublicKey, 'hex');
    conn.once('close', () => closeConnection(conn, name));
    conn.on('data', data => receiveMsg(conn, name, data));

    console.log(`received connection from: ${shortName(name)}`);

    const names = connections.map(conn => shortName(b4a.toString(conn.remotePublicKey, 'hex')));
    console.log(`${connections.length} connections: ${names}`);

    const msg = {
        type: 'sync',
        time: new Date().toISOString(),
        relays: [],
        node: config.nodeName,
    };

    const json = JSON.stringify(msg);
    conn.write(json);
}

function closeConnection(conn, name) {
    console.log(`* connection closed with: ${shortName(name)} (${connectionNodeName[name]}) *`);
    const index = connections.indexOf(conn);
    if (index !== -1) {
        connections.splice(index, 1);
    }
}

function shortName(name) {
    return name.slice(0, 4) + '-' + name.slice(-4);
}

async function createBatch() {
    console.time('exportBatch');
    const allEvents = await gatekeeper.exportBatch();
    console.timeEnd('exportBatch');
    console.log(`${allEvents.length} events fetched`);

    // hyperswarm distributes only operations
    return allEvents.map(event => event.operation);
}

function cacheBatch(batch) {
    const hash = cipher.hashJSON(batch);
    batchesSeen[hash] = true;
    console.log(`batch in db: ${shortName(hash)}`);
}

function logBatch(batch, name) {
    const debugFolder = 'data/debug';

    if (!config.debug) {
        return;
    }

    if (!fs.existsSync(debugFolder)) {
        fs.mkdirSync(debugFolder, { recursive: true });
    }

    const hash = shortName(cipher.hashJSON(batch));
    const batchfile = `${debugFolder}/${hash}-${name}.json`;
    const batchJSON = JSON.stringify(batch, null, 4);
    fs.writeFileSync(batchfile, batchJSON);
}

async function initializeBatchesSeen() {
    const batch = await createBatch();

    logBatch(batch, config.nodeName);

    let chunk = [];
    for (const events of batch) {
        chunk.push(events);

        if (chunk.length >= BATCH_SIZE) {
            cacheBatch(chunk);
            chunk = [];
        }
    }

    cacheBatch(chunk);
}

async function shareDb(conn) {
    try {
        const batch = await createBatch();

        const msg = {
            type: 'batch',
            data: batch,
            relays: [],
            node: config.nodeName,
        };

        const json = JSON.stringify(msg);
        conn.write(json);
    }
    catch (error) {
        console.log(error);
    }
}

async function relayMsg(msg) {
    const json = JSON.stringify(msg);

    console.log(`* sending ${msg.type} from: ${shortName(peerName)} (${config.nodeName}) *`);

    for (const conn of connections) {
        const name = b4a.toString(conn.remotePublicKey, 'hex');
        const short = shortName(name);
        const nodeName = connectionNodeName[name];
        const lastTime = connectionLastSeen[name];
        let lastSeen = '';

        if (lastTime) {
            const last = new Date(lastTime);
            const now = new Date();
            const minutesSinceLastSeen = Math.floor((now - last) / 1000 / 60);
            lastSeen = `last seen ${minutesSinceLastSeen} minutes ago ${last.toISOString()}`;
        }

        if (!msg.relays.includes(name)) {
            conn.write(json);
            console.log(`* relaying to: ${short} (${nodeName}) ${lastSeen} *`);
        }
        else {
            console.log(`* skipping relay to: ${short} (${nodeName}) ${lastSeen} *`);
        }
    }
}

async function importBatch(batch) {
    try {
        const hash = cipher.hashJSON(batch);

        if (batchesSeen[hash]) {
            console.log(`importBatch: already seen ${shortName(hash)}...`);
            return;
        }

        batchesSeen[hash] = true;

        const events = [];
        const now = new Date();
        const isoTime = now.toISOString();
        const ordTime = now.getTime();

        for (let i = 0; i < batch.length; i++) {
            events.push({
                registry: REGISTRY,
                time: isoTime,
                ordinal: [ordTime, i],
                operation: batch[i],
            })
        }

        console.log(`importBatch: ${shortName(hash)} merging ${events.length} events...`);
        console.time('importBatch');
        const { verified, updated, failed } = await gatekeeper.importBatch(events);
        console.timeEnd('importBatch');
        console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
        console.log(`${Object.keys(batchesSeen).length} batches seen`);
    }
    catch (error) {
        console.error(`importBatch error: ${error}`);
    }
}

async function mergeBatch(batch) {

    if (!batch) {
        return;
    }

    let chunk = [];
    for (const operation of batch) {
        chunk.push(operation);

        if (chunk.length >= BATCH_SIZE) {
            await importBatch(chunk);
            chunk = [];
        }
    }

    await importBatch(chunk);
}

let importQueue = asyncLib.queue(async function (task, callback) {
    const { name, msg } = task;
    try {
        const ready = await gatekeeper.isReady();

        if (ready) {
            const batch = msg.data;

            if (batch.length === 0) {
                return;
            }

            const nodeName = msg.node || 'anon';
            console.log(`* merging batch (${batch.length} events) from: ${shortName(name)} (${nodeName}) *`);
            await mergeBatch(batch);
        }
    }
    catch (error) {
        console.log('mergeBatch error:', error);
    }
    callback();
}, 1); // concurrency is 1

let exportQueue = asyncLib.queue(async function (task, callback) {
    const { name, msg, conn } = task;
    try {
        const ready = await gatekeeper.isReady();

        if (ready) {
            console.log(`* sharing db with: ${shortName(name)} (${msg.node || 'anon'}) *`);
            await shareDb(conn);
        }
    }
    catch (error) {
        console.log('shareDb error:', error);
    }
    callback();
}, 1); // concurrency is 1

async function receiveMsg(conn, name, json) {
    const msg = JSON.parse(json);

    console.log(`received ${msg.type} from: ${shortName(name)} (${msg.node || 'anon'})`);
    connectionLastSeen[name] = new Date().getTime();
    connectionNodeName[name] = msg.node || 'anon';

    if (msg.type === 'batch') {
        logBatch(msg.data, msg.node || 'anon');
        importQueue.push({ name, msg });
        return;
    }

    if (msg.type === 'queue') {
        importQueue.push({ name, msg });
        msg.relays.push(name);
        logConnection(msg.relays[0]);
        relayMsg(msg);
        return;
    }

    if (msg.type === 'sync') {
        exportQueue.push({ name, msg, conn });
        return;
    }

    if (msg.type === 'ping') {
        return;
    }

    console.log(`unknown message type`);
}

async function flushQueue() {
    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(`${REGISTRY} queue: ${JSON.stringify(batch, null, 4)}`);

    if (batch.length > 0) {
        const msg = {
            type: 'queue',
            data: batch,
            relays: [],
            node: config.nodeName,
        };

        await gatekeeper.clearQueue(REGISTRY, batch);
        await relayMsg(msg);
        await importBatch(batch);
    }
}

async function exportLoop() {
    try {
        await flushQueue();
        console.log('export loop waiting 10s...');
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    }
    setTimeout(exportLoop, 10 * 1000);
}

async function checkConnections() {
    if (connections.length === 0) {
        // Rejoin the topic to find peers
        await createSwarm();
    }
    else {
        // Remove connections that have not be seen in >3 minutes
        const expireLimit = 3 * 60 * 1000; // 3 minutes in milliseconds
        const now = Date.now();

        connections = connections.filter(conn => {
            const name = b4a.toString(conn.remotePublicKey, 'hex');
            const lastTime = connectionLastSeen[name];
            if (lastTime) {
                const timeSinceLastSeen = now - lastTime;
                return timeSinceLastSeen <= expireLimit;
            }
            return true; // If we don't have a last seen time for a connection, keep it
        });
    }
}

async function connectionLoop() {
    try {
        await checkConnections();

        const msg = {
            type: 'ping',
            time: new Date().toISOString(),
            relays: [],
            node: config.nodeName,
        };

        await relayMsg(msg);

        console.log('ping loop waiting 60s...');
    } catch (error) {
        console.error(`Error in pingLoop: ${error}`);
    }
    setTimeout(connectionLoop, 60 * 1000);
}

async function collectGarbage() {
    console.time('collectGarbage');

    const didList = await gatekeeper.getDIDs();
    const expired = [];
    const now = new Date();

    for (let i = 0; i < didList.length; i++) {
        const did = didList[i];

        let output = `gc check: ${i} ${did}`;

        const doc = await gatekeeper.resolveDID(did, { confirm: true });

        if (doc.mdip.registry === REGISTRY) {
            const isoDate = doc.didDocumentData?.ephemeral?.validUntil;

            if (!isoDate) {
                continue;
            }

            const validUntil = new Date(isoDate);

            // Check if validUntil is a valid date
            if (isNaN(validUntil.getTime())) {
                output += ` invalid date format: ${isoDate}`;
                continue;
            }

            if (validUntil < now) {
                expired.push(did);
            }
            else {
                const minutesLeft = Math.round((validUntil.getTime() - now.getTime()) / 60 / 1000);
                output += ` expires in ${minutesLeft} minutes`;
            }
        }

        console.log(output);
    }

    if (expired.length > 0) {
        console.log(`garbage collecting ${expired.length} DIDs...`);
        await gatekeeper.removeDIDs(expired);
    }

    console.timeEnd('collectGarbage');
}

async function gcLoop() {
    try {
        await collectGarbage();
        console.log('garbage collection loop waiting 60m...');
    } catch (error) {
        console.error(`Error in gcLoop: ${error}`);
    }
    setTimeout(gcLoop, 60 * 60 * 1000);
}

function logConnection(name) {
    nodes[name] = (nodes[name] || 0) + 1;
    const detected = Object.keys(nodes).length;

    console.log(`--- ${connections.length} nodes connected, ${detected} nodes detected`);
}

process.on('uncaughtException', (error) => {
    console.error('Unhandled exception caught', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

process.stdin.on('data', d => {
    if (d.toString().startsWith('q')) {
        process.exit();
    }
});

// Join a common topic
const hash = sha256(PROTOCOL);
const networkID = Buffer.from(hash).toString('hex');
const topic = b4a.from(networkID, 'hex');

async function main() {
    gatekeeper.setURL(`${config.gatekeeperURL}:${config.gatekeeperPort}`);
    await gatekeeper.waitUntilReady();
    await initializeBatchesSeen();
    await gcLoop();
    await connectionLoop();
    await exportLoop();
}

main();
