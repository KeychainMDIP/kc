import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import fs from 'fs';
import asyncLib from 'async';

import * as gatekeeper from './gatekeeper-sdk.js';
import * as cipher from './cipher.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

const protocol = '/MDIP/v22.03.01';

const swarm = new Hyperswarm();
const peerName = b4a.toString(swarm.keyPair.publicKey, 'hex');

goodbye(() => swarm.destroy())

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

function loadDb() {
    const dbName = 'data/mdip.json';

    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {}
    }
}

async function shareDb() {
    if (merging) {
        return;
    }

    try {
        const db = loadDb();
        const hash = cipher.hashJSON(db);

        messagesSeen[hash] = true;

        const msg = {
            hash: hash.toString(),
            data: db,
            relays: [],
        };

        await relayDb(msg);
    }
    catch (error) {
        console.log(error);
    }
}

async function relayDb(msg) {
    const json = JSON.stringify(msg);

    console.log(`publishing my db: ${shortName(msg.hash)} from: ${shortName(peerName)}`);

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

async function mergeDb(db) {
    merging = true;
    if (db.hyperswarm) {
        // Import DIDs by creation time order to avoid dependency errors
        let dids = Object.keys(db.hyperswarm);
        dids.sort((a, b) => db.hyperswarm[a][0].time - db.hyperswarm[b][0].time);

        for (const did of dids) {
            console.log(`${did} ${db.hyperswarm[did][0].time}`);
        }

        for (const did of dids) {
            try {
                const imported = await gatekeeper.importDID(db.hyperswarm[did]);
                if (imported > 0) {
                    console.log(`* imported DID ${did} *`);
                }
            }
            catch (error) {
                console.error(`error importing DID: ${did}: ${error}`);
            }
        }
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
            messagesSeen[hash] = true;
            msg.relays.push(name);
            logMsg(msg.relays[0], hash);
            relayDb(msg);
            console.log(`* merging db ${hash} *`);
            await mergeDb(msg.data);
        }
        else {
            console.log(`received old db:  ${shortName(hash)} from: ${shortName(name)}`);
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

function logMsg(name, hash) {
    nodes[name] = (nodes[name] || 0) + 1;
    const detected = Object.keys(nodes).length;

    console.log(`received new db: ${shortName(hash)} from: ${shortName(name)}`);
    console.log(`--- ${conns.length} nodes connected, ${detected} nodes detected`);
}

setInterval(async () => {
    try {
        shareDb();
    }
    catch (error) {
        console.error(`Error: ${error}`);
    }
}, 10000);

// Join a common topic
const hash = sha256(protocol);
const networkID = Buffer.from(hash).toString('hex');
const topic = b4a.from(networkID, 'hex');
const discovery = swarm.join(topic, { client: true, server: true });

// The flushed promise will resolve when the topic has been fully announced to the DHT
discovery.flushed().then(() => {
    console.log(`connecting to gatekeeper at ${gatekeeper.URL}`);
    console.log(`hyperswarm peer id: ${peerName}`);
    console.log('joined topic:', b4a.toString(topic, 'hex'));
});

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
