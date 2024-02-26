import Hyperswarm from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import * as cipher from './cipher.js';

const swarm = new Hyperswarm();
goodbye(() => swarm.destroy())

const mockIPFS = {};
const nodes = {};

// Keep track of all connections
const conns = [];
swarm.on('connection', conn => {
    const name = b4a.toString(conn.remotePublicKey, 'hex');
    console.log('* got a connection from:', name, '*');
    conns.push(conn);
    conn.once('close', () => conns.splice(conns.indexOf(conn), 1));
    conn.on('data', data => receiveMessage(name, data));
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

async function receiveMessage(name, json) {
    try {
        const msg = JSON.parse(json);
        const data = mockIPFS[msg.cid];

        if (!data) {
            msg.relays.push(name);
            console.log('receiveMessage', json);
        }
    }
    catch (error) {
        console.log('receiveMessage error:', error);
    }
}
