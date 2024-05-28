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
const messagesSeen = {};
let merging = false;

// Keep track of all connections
const conns = [];
swarm.on('connection', conn => {
    const name = b4a.toString(conn.remotePublicKey, 'hex');
    console.log('* got a connection from:', shortName(name), '*');
    conns.push(conn);
    conn.once('close', () => conns.splice(conns.indexOf(conn), 1));
    conn.on('data', data => receiveMsg(name, data));
});

function shortName(name) {
    return name.slice(0, 4) + '-' + name.slice(-4);
}

function isEmpty(obj) {
    return Object.keys(obj).length === 0 && obj.constructor === Object;
}

// eslint-disable-next-line no-unused-vars
async function shareDb() {
    if (merging) {
        return;
    }

    try {
        console.time('getDIDs');
        const didList = await gatekeeper.getDIDs();
        console.timeEnd('getDIDs');

        console.time('exportDIDs');
        const batch = await gatekeeper.exportDIDs(didList);
        console.timeEnd('exportDIDs');
        console.log(`${batch.length} DIDs fetched`);

        if (isEmpty(batch)) {
            return;
        }

        // Have to sort before the hash
        batch.sort((a, b) => new Date(a[0].operation.signature.signed) - new Date(b[0].operation.signature.signed));
        const hash = cipher.hashJSON(batch);

        messagesSeen[hash] = true;

        const msg = {
            hash: hash.toString(),
            type: 'batch',
            data: batch,
            relays: [],
            node: config.nodeName,
        };

        await relayDb(msg);
    }
    catch (error) {
        console.log(error);
    }
}

async function relayDb(msg) {
    const json = JSON.stringify(msg);

    console.log(`* publishing my db: ${shortName(msg.hash)} from: ${shortName(peerName)} (${config.nodeName}) *`);

    for (const conn of conns) {
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

async function importDIDs(batch) {
    try {
        console.log(`importDIDs: merging ${batch.length} DIDs...`);
        console.time('importDIDs');

        for (const events of batch) {
            for (const event of events) {
                event.registry = REGISTRY;
            }
        }

        const { verified, updated, failed } = await gatekeeper.importDIDs(batch);
        console.timeEnd('importDIDs');
        console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
    }
    catch (error) {
        console.error(`importDIDs error: ${error}`);
    }
}

async function mergeBatch(batch) {

    if (!batch) {
        return;
    }

    merging = true;

    let chunk = [];
    for (const events of batch) {
        chunk.push(events);

        if (chunk.length >= 100) {
            await importDIDs(chunk);
            chunk = [];
        }
    }

    await importDIDs(chunk);

    merging = false;
}

// eslint-disable-next-line no-unused-vars
async function mergeQueue(queue) {

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

    console.log(JSON.stringify(batch, null, 4));
    console.time('importBatch');
    const { verified, updated, failed } = await gatekeeper.importBatch(batch);
    console.timeEnd('importBatch');
    console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
}

let queue = asyncLib.queue(async function (task, callback) {
    const { name, json } = task;
    try {
        const msg = JSON.parse(json);
        const batch = msg.data;

        // Have to sort before the hash
        batch.sort((a, b) => new Date(a[0].operation.signature.signed) - new Date(b[0].operation.signature.signed));
        const hash = cipher.hashJSON(batch);
        const seen = messagesSeen[hash];

        if (!seen) {
            const ready = await gatekeeper.isReady();

            if (ready) {
                messagesSeen[hash] = true;

                if (isEmpty(batch)) {
                    return;
                }

                msg.relays.push(name);
                logConnection(msg.relays[0]);
                relayDb(msg);
                console.log(`* merging new db:   ${shortName(hash)} from: ${shortName(name)} (${msg.node || 'anon'}) *`);
                await mergeBatch(batch);
            }
        }
        else {
            console.log(`* received old db:  ${shortName(hash)} from: ${shortName(name)} (${msg.node || 'anon'}) *`);
        }
    }
    catch (error) {
        console.log('receiveMsg error:', error);
    }
    callback();
}, 1); // concurrency is 1

async function receiveMsg(name, json) {
    queue.push({ name, json });
}

async function flushQueue() {
    const queue = await gatekeeper.getQueue(REGISTRY);
    console.log(JSON.stringify(queue, null, 4));

    if (queue.length > 0) {
        const hash = cipher.hashJSON(queue);
        const msg = {
            hash: hash.toString(),
            type: 'queue',
            data: queue,
            relays: [],
            node: config.nodeName,
        };

        await relayDb(msg);
    }
    else {
        console.log('empty queue');
    }
}

async function exportLoop() {
    try {
        await flushQueue();
        console.log('export loop waiting 30s...');
    } catch (error) {
        console.error(`Error in anchorLoop: ${error}`);
    }
    setTimeout(exportLoop, 30 * 1000);
}

function logConnection(name) {
    nodes[name] = (nodes[name] || 0) + 1;
    const detected = Object.keys(nodes).length;

    console.log(`--- ${conns.length} nodes connected, ${detected} nodes detected`);
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

    // setInterval(async () => {
    //     try {
    //         const ready = await gatekeeper.isReady();

    //         if (ready) {
    //             shareDb();
    //         }
    //     }
    //     catch (error) {
    //         console.error(`Error: ${error}`);
    //     }
    // }, 30000);
    exportLoop();
}

async function main() {
    await gatekeeper.waitUntilReady();

    const discovery = swarm.join(topic, { client: true, server: true });

    // The flushed promise will resolve when the topic has been fully announced to the DHT
    discovery.flushed().then(() => {
        start();
    });
}

main();
