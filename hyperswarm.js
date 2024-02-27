import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import * as cipher from './cipher.js';

let gatekeeper = null;

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
    conn.on('data', data => receiveMsg(name, data));
});

export async function start(protocol, gk) {
    gatekeeper = gk;

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

export async function publishExport(did) {
    try {
        const txns = await gatekeeper.exportDID(did);
        const hash = cipher.hashJSON(txns);

        messagesSeen[hash] = true;
        logTxns(txns, 'local');

        const msg = {
            op: 'export',
            data: txns,
            relays: [],
        };

        await relayMsg(msg);
    }
    catch (error) {
        console.log(error);
    }
}

async function receiveMsg(name, json) {
    try {
        const msg = JSON.parse(json);
        const hash = cipher.hashJSON(msg.data);
        const seen = messagesSeen[hash];

        if (!seen) {
            msg.relays.push(name);
            await republishMsg(msg);

            const did = await gatekeeper.importDID(msg.data);
            console.log(`${did} imported`);
        }
    }
    catch (error) {
        console.log('receiveMsg error:', error);
    }
}

async function republishMsg(msg) {
    try {
        const hash = cipher.hashJSON(msg.data);
        messagesSeen[hash] = true;
        logTxns(msg.data, msg.relays[0]);
        await relayMsg(msg);
    }
    catch (error) {
        console.log(error);
    }
}

async function relayMsg(msg) {
    const json = JSON.stringify(msg);

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

function logTxns(txns, name) {
    nodes[name] = (nodes[name] || 0) + 1;
    const detected = Object.keys(nodes).length;

    console.log(`from: ${name}`);
    console.log(JSON.stringify(txns, null, 4));
    console.log(`--- ${conns.length} nodes connected, ${detected} nodes detected`);
}
