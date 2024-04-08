import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import asyncLib from 'async';
import { EventEmitter } from 'events';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as cipher from './cipher.js';
import config from './config.js';
import * as db_json from './db-json.js';
import * as db_sqlite from './db-sqlite.js';

EventEmitter.defaultMaxListeners = 100;

const protocol = '/MDIP/v22.04.08';
const db = (config.gatekeeperDb === 'sqlite') ? db_sqlite : db_json;

await db.start();

const swarm = new Hyperswarm();
const peerName = b4a.toString(swarm.keyPair.publicKey, 'hex');

goodbye(() => {
    swarm.destroy();
    db.stop();
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

async function fetchDids() {
    const data = {};
    const dids = await db.getAllKeys();

    for (const did of dids) {
        console.log(`fetching ${did}`);
        data[did] = await db.getOperations(did);
    }

    return data;
}

async function shareDb() {
    if (merging) {
        return;
    }

    try {
        const dids = await fetchDids();

        if (isEmpty(dids)) {
            return;
        }

        const hash = cipher.hashJSON(dids);

        messagesSeen[hash] = true;

        const msg = {
            hash: hash.toString(),
            data: dids,
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

async function mergeBatch(batch) {
    try {
        console.log(`mergeBatch: merging ${batch.length} DIDs...`);
        const { verified, updated, failed } = await gatekeeper.mergeBatch(batch);
        console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
    }
    catch (error) {
        console.error(`mergeBatch error: ${error}`);
    }
}

async function mergeDb(db) {
    merging = true;
    if (db) {
        // Import DIDs by creation time order to avoid dependency errors
        let dids = Object.keys(db);
        dids.sort((a, b) => db[a][0].time - db[b][0].time);

        let batch = [];
        for (const did of dids) {
            batch.push(db[did]);

            if (batch.length >= 100) {
                await mergeBatch(batch);
                batch = [];
            }
        }

        await mergeBatch(batch);
    }
    merging = false;
}

let queue = asyncLib.queue(async function (task, callback) {
    const { name, json } = task;
    try {
        const msg = JSON.parse(json);
        const hash = cipher.hashJSON(msg.data);
        const seen = messagesSeen[hash];

        if (!seen) {
            const ready = await gatekeeper.isReady();

            if (ready) {
                messagesSeen[hash] = true;

                const db = msg.data;

                if (isEmpty(db)) {
                    return;
                }

                msg.relays.push(name);
                logConnection(msg.relays[0]);
                relayDb(msg);
                console.log(`* merging new db:   ${shortName(hash)} from: ${shortName(name)} (${msg.node || 'anon'}) *`);
                await mergeDb(db);
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
    console.log(`using ${config.gatekeeperDb} db`);
    console.log('joined topic:', shortName(b4a.toString(topic, 'hex')));

    setInterval(async () => {
        try {
            const ready = await gatekeeper.isReady();

            if (ready) {
                shareDb();
            }
        }
        catch (error) {
            console.error(`Error: ${error}`);
        }
    }, 10000);
}

function main() {
    console.log(`connecting to gatekeeper at ${gatekeeper.URL}`);

    const discovery = swarm.join(topic, { client: true, server: true });

    // The flushed promise will resolve when the topic has been fully announced to the DHT
    discovery.flushed().then(() => {
        start();
    });
}

main();
