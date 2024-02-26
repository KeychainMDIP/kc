import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import * as cipher from './cipher.js';

const swarm = new Hyperswarm();
goodbye(() => swarm.destroy())

const messagesSeen = {};
const nodes = {};

// Keep track of all connections
const conns = [];
swarm.on('connection', conn => {
    const name = b4a.toString(conn.remotePublicKey, 'hex');
    console.log('* got a connection from:', name, '*');
    conns.push(conn);
    conn.once('close', () => conns.splice(conns.indexOf(conn), 1));
    conn.on('data', data => receiveTxn(name, data));
});

export async function start(protocol) {
    // Join a common topic
    const hash = cipher.hashMessage(protocol);
    const topic = b4a.from(hash, 'hex');
    const discovery = swarm.join(topic, { client: true, server: true });

    // The flushed promise will resolve when the topic has been fully announced to the DHT
    discovery.flushed().then(() => {
        console.log(`joined network ${protocol} (${hash})`);
    });
}

export async function stop() {
    swarm.destroy();
}

export async function publishTxn(txn) {
    try {
        const hash = cipher.hashJSON(txn);

        messagesSeen[hash] = true;
        logTxn(txn, 'local');

        const msg = {
            hash: hash,
            txn: txn,
            relays: [],
        };

        await relayTxn(msg);
    }
    catch (error) {
        console.log(error);
    }
}

async function receiveTxn(name, json) {
    try {
        const msg = JSON.parse(json);
        const seen = messagesSeen[msg.cid];

        if (!seen) {
            msg.relays.push(name);
            await republishTxn(msg);
        }
    }
    catch (error) {
        console.log('receiveTxn error:', error);
    }
}

async function republishTxn(msg) {
    try {
        messagesSeen[msg.hash] = true;
        logTxn(msg.txn, msg.relays[0]);
        await relayTxn(msg);
    }
    catch (error) {
        console.log(error);
    }
}

async function relayTxn(msg) {
    const json = JSON.stringify(msg);

    for (const conn of conns) {
        const name = b4a.toString(conn.remotePublicKey, 'hex');

        if (!msg.relays.includes(name)) {
            conn.write(json);
        }
    }
}

function logTxn(txn, name) {
    nodes[name] = (nodes[name] || 0) + 1;
    const detected = Object.keys(nodes).length;

    console.log(`from: ${name}`);
    console.log(JSON.stringify(txn, null, 4));
    console.log(`--- ${conns.length} nodes connected, ${detected} nodes detected`);
}
