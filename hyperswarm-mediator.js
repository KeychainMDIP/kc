import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import asyncLib from 'async';
import { EventEmitter } from 'events';

import * as gatekeeper from './gatekeeper-sdk.js';
import * as cipher from './cipher.js';
import config from './config.js';

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const protocol = '/MDIP/v22.05.28';
const swarm = new Hyperswarm();
const peerName = b4a.toString(swarm.keyPair.publicKey, 'hex');

goodbye(() => {
    swarm.destroy();
});

const nodes = {};
const batchesSeen = {};

// Keep track of all connections
const connections = [];
swarm.on('connection', conn => {
    const name = b4a.toString(conn.remotePublicKey, 'hex');
    console.log('* got a connection from:', shortName(name), '*');
    connections.push(conn);
    conn.once('close', () => connections.splice(connections.indexOf(conn), 1));
    conn.on('data', data => receiveMsg(conn, name, data));
    syncWith(name, conn);
});

async function syncWith(name, conn) {
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

function shortName(name) {
    return name.slice(0, 4) + '-' + name.slice(-4);
}

async function createBatch() {
    console.time('getDIDs');
    const didList = await gatekeeper.getDIDs();
    console.timeEnd('getDIDs');

    console.time('exportDIDs');
    let batch = await gatekeeper.exportDIDs(didList);
    console.timeEnd('exportDIDs');
    console.log(`${batch.length} DIDs fetched`);

    batch = batch.flat();

    if (batch.length === 0) {
        return;
    }

    batch = batch.sort((a, b) => new Date(a.operation.signature.signed) - new Date(b.operation.signature.signed));

    for (const event of batch) {
        event.registry = REGISTRY;
    }

    return batch;
}

function cacheBatch(batch) {
    const hash = cipher.hashJSON(batch);
    batchesSeen[hash] = true;
    console.log(`batch in db: ${shortName(hash)}`);
}

async function initializeBatchesSeen() {
    const batch = await createBatch();

    let chunk = [];
    for (const events of batch) {
        chunk.push(events);

        if (chunk.length >= 100) {
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

        if (!msg.relays.includes(name)) {
            conn.write(json);
            console.log(`* relaying to: ${shortName(name)} *`);
        }
        else {
            console.log(`* skipping relay to: ${shortName(name)} *`);
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

        console.log(`importBatch: merging ${batch.length} events...`);
        console.time('importBatch');

        const { verified, updated, failed } = await gatekeeper.importBatch(batch);
        console.timeEnd('importBatch');
        console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
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
    for (const events of batch) {
        chunk.push(events);

        if (chunk.length >= 100) {
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

            console.log(`* merging batch (${batch.length} events) from: ${shortName(name)} (${msg.node || 'anon'}) *`);
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

    if (msg.type === 'batch') {
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
    const queue = await gatekeeper.getQueue(REGISTRY);
    console.log(JSON.stringify(queue, null, 4));

    if (queue.length > 0) {
        const batch = [];
        const now = new Date();

        for (let i = 0; i < queue.length; i++) {
            batch.push({
                registry: REGISTRY,
                time: now.toISOString(),
                ordinal: [now.getTime(), i],
                operation: queue[i],
            });
        }

        const msg = {
            type: 'queue',
            data: batch,
            relays: [],
            node: config.nodeName,
        };

        await relayMsg(msg);
        await importBatch(batch);
        await gatekeeper.clearQueue(REGISTRY, queue);
    }
    else {
        console.log('empty queue');
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

async function pingConnections() {
    const msg = {
        type: 'ping',
        time: new Date().toISOString(),
        relays: [],
        node: config.nodeName,
    };

    await relayMsg(msg);
}

async function pingLoop() {
    try {
        await pingConnections();
        console.log('ping loop waiting 60s...');
    } catch (error) {
        console.error(`Error in pingLoop: ${error}`);
    }
    setTimeout(pingLoop, 60 * 1000);
}

async function collectGarbage() {
    const didList = await gatekeeper.getDIDs();
    const expired = [];

    for (const did of didList) {
        const doc = await gatekeeper.resolveDID(did);
        const now = new Date();
        const created = new Date(doc.didDocumentMetadata.created);
        const ageInHours = (now - created) / 1000 / 60 / 60;

        if (doc.mdip.registry === REGISTRY && doc.mdip.type === 'asset' && ageInHours > 24) {
            expired.push(did);
        }
    }

    if (expired.length > 0) {
        console.log(`garbage collecting ${expired.length} DIDs...`);
        await gatekeeper.removeDIDs(expired);
    }
}

async function gcLoop() {
    try {
        await collectGarbage();
        console.log('garbage collection loop waiting 10m...');
    } catch (error) {
        console.error(`Error in gcLoop: ${error}`);
    }
    setTimeout(gcLoop, 10 * 60 * 1000);
}

function logConnection(name) {
    nodes[name] = (nodes[name] || 0) + 1;
    const detected = Object.keys(nodes).length;

    console.log(`--- ${connections.length} nodes connected, ${detected} nodes detected`);
}

process.on('uncaughtException', (error) => {
    //console.error('Unhandled exception caught');
    console.error('Unhandled exception caught', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    //console.error('Unhandled rejection caught');
});

process.stdin.on('data', d => {
    if (d.toString().startsWith('q')) {
        process.exit();
    }
});

// Join a common topic
const hash = sha256(protocol);
const networkID = Buffer.from(hash).toString('hex');
const topic = b4a.from(networkID, 'hex');

async function start() {
    console.log(`hyperswarm peer id: ${shortName(peerName)} (${config.nodeName})`);
    console.log(`joined topic: ${shortName(b4a.toString(topic, 'hex'))} using protocol: ${protocol}`);
    exportLoop();
    pingLoop();
    gcLoop();
}

async function main() {
    await gatekeeper.waitUntilReady();
    await initializeBatchesSeen();

    const discovery = swarm.join(topic, { client: true, server: true });

    // The flushed promise will resolve when the topic has been fully announced to the DHT
    discovery.flushed().then(() => {
        start();
    });
}

main();
