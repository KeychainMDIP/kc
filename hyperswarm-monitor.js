import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import fs from 'fs';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as cipher from './cipher.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

const protocol = '/MDIP/v22.02.30';

const swarm = new Hyperswarm();
goodbye(() => swarm.destroy())

const nodes = {};
const messagesSeen = {};

// Keep track of all connections
const conns = [];
swarm.on('connection', conn => {
    const name = b4a.toString(conn.remotePublicKey, 'hex');
    console.log('* got a connection from:', name, '*');
    conns.push(conn);
    conn.once('close', () => conns.splice(conns.indexOf(conn), 1));
    conn.on('data', data => receiveMsg(name, data));
});

function loadDb() {
    const dbName = 'mdip.json';

    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {}
    }
}

async function shareDb() {
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

    console.log(`* publishing db: ${msg.hash} *`);

    for (const conn of conns) {
        const name = b4a.toString(conn.remotePublicKey, 'hex');

        if (!msg.relays.includes(name)) {
            conn.write(json);
            console.log(`* relaying to: ${name} *`);
        }
        else {
            console.log(`* skipping relay to: ${name} *`);
        }
    }
}

async function mergeDb(db) {
    // if (db.anchors) {
    //     for (const did of Object.keys(db.anchors)) {
    //         try {
    //             const imported = await gatekeeper.createDID(db.anchors[did]);
    //             if (imported === 1) {
    //                 console.log(JSON.stringify(db.anchors[did], null, 4));
    //                 console.log(`* imported anchor ${did} *`);
    //             }
    //         }
    //         catch (error) {
    //             console.error(`error importing anchor: ${did}: ${error}`);
    //         }
    //     }
    // }

    if (db.hyperswarm) {
        // Import DIDs by creation time order to avoid dependency errors
        let dids = Object.keys(db.hyperswarm);
        dids.sort((a, b) => db.hyperswarm[a].time - db.hyperswarm[b].time);

        for (const did of dids) {
            try {
                const imported = await gatekeeper.importDID(db.hyperswarm[did]);
                if (imported > 0) {
                    //console.log(JSON.stringify(db.hyperswarm[did], null, 4));
                    console.log(`* imported DID ${did} *`);
                }
            }
            catch (error) {
                console.error(`error importing DID: ${did}: ${error}`);
            }
        }
    }
}

async function receiveMsg(name, json) {
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
            console.log(`* received already seen ${hash} *`);
        }
    }
    catch (error) {
        console.log('receiveMsg error:', error);
    }
}

function logMsg(name, hash) {
    nodes[name] = (nodes[name] || 0) + 1;
    const detected = Object.keys(nodes).length;

    console.log(`from: ${name}`);
    console.log(`received: ${hash}`);
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
