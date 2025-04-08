import fs from 'fs';
import Hyperswarm, { HyperswarmConnection } from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import asyncLib from 'async';
import { EventEmitter } from 'events';

import GatekeeperClient from '@mdip/gatekeeper/client';
import { Operation } from '@mdip/gatekeeper/types';
import CipherNode from '@mdip/cipher/node';
import config from './config.js';

interface MediatorMessage {
    type: 'batch' | 'queue' | 'sync' | 'ping';
    time?: string;
    relays: string[];
    node?: string;
    data?: Operation[];
}

interface ImportQueueTask {
    name: string;
    msg: MediatorMessage;
}

interface ExportQueueTask extends ImportQueueTask {
    conn: HyperswarmConnection;
}

const gatekeeper = new GatekeeperClient();
const cipher = new CipherNode();

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const BATCH_SIZE = 100;

const nodes: Record<string, number> = {};

// Keep track of all connections
let connections: HyperswarmConnection[] = [];
const connectionLastSeen: Record<string, number> = {};
const connectionNodeName: Record<string, string> = {};

let swarm: Hyperswarm | null = null;
let peerName = '';

goodbye(() => {
    if (swarm) {
        swarm.destroy();
    }
});

async function createSwarm(): Promise<void> {
    if (swarm) {
        swarm.destroy();
    }

    swarm = new Hyperswarm();
    peerName = b4a.toString(swarm.keyPair.publicKey, 'hex');

    swarm.on('connection', conn => addConnection(conn));

    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();

    const shortTopic = shortName(b4a.toString(topic, 'hex'));
    console.log(`new hyperswarm peer id: ${shortName(peerName)} (${config.nodeName}) joined topic: ${shortTopic} using protocol: ${config.protocol}`);
}

let syncQueue = asyncLib.queue<HyperswarmConnection, asyncLib.ErrorCallback>(
    async function (conn, callback) {
        try {
            // Wait until the importQueue is empty
            while (importQueue.length() > 0) {
                console.log(`* sync waiting 1s for importQueue to empty. Current length: ${importQueue.length()}`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // wait for 1 second
            }

            const msg = {
                type: 'sync',
                time: new Date().toISOString(),
                relays: [],
                node: config.nodeName,
            };

            const json = JSON.stringify(msg);
            conn.write(json);
        }
        catch (error) {
            console.log('sync error:', error);
        }
        callback();
    }, 1); // concurrency is 1

function addConnection(conn: HyperswarmConnection): void {
    connections.push(conn);

    const name = b4a.toString(conn.remotePublicKey, 'hex');
    conn.once('close', () => closeConnection(conn, name));
    conn.on('data', data => receiveMsg(conn, name, data));

    console.log(`received connection from: ${shortName(name)}`);

    const names = connections.map(conn => shortName(b4a.toString(conn.remotePublicKey, 'hex')));
    console.log(`${connections.length} connections: ${names}`);

    // Push the connection to the syncQueue instead of writing directly
    syncQueue.push(conn);
}

function closeConnection(conn: HyperswarmConnection, name: string): void {
    console.log(`* connection closed with: ${shortName(name)} (${connectionNodeName[name]}) *`);
    const index = connections.indexOf(conn);
    if (index !== -1) {
        connections.splice(index, 1);
    }
}

function shortName(name: string): string {
    return name.slice(0, 4) + '-' + name.slice(-4);
}

function logBatch(batch: Operation[], name: string): void {
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

function sendBatch(conn: HyperswarmConnection, batch: Operation[]): number {
    const limit = 8 * 1024 * 1014; // 8 MB limit

    const msg = {
        type: 'batch',
        data: batch,
        relays: [],
        node: config.nodeName,
    };

    const json = JSON.stringify(msg);

    if (json.length < limit) {
        conn.write(json);
        console.log(` * sent ${batch.length} ops in ${json.length} bytes`);
        return batch.length;
    }
    else {
        if (batch.length < 2) {
            console.error(`Error: Single operation exceeds the limit of ${limit} bytes. Unable to send.`);
            return 0;
        }

        // split batch into 2 halves
        const midIndex = Math.floor(batch.length / 2);
        const batch1 = batch.slice(0, midIndex);
        const batch2 = batch.slice(midIndex);

        return sendBatch(conn, batch1) + sendBatch(conn, batch2);
    }
}

function isStringArray(arr: any[]): arr is string[] {
    return arr.every(item => typeof item === 'string');
}

async function shareDb(conn: HyperswarmConnection): Promise<void> {
    console.time('shareDb');
    try {
        const batchSize = 1000; // export DIDs in batches of 1000 for scalability
        const dids = await gatekeeper.getDIDs();

        // Either empty or we got an MdipDocument[] which should not happen.
        if (!isStringArray(dids)) {
            return;
        }

        for (let i = 0; i < dids.length; i += batchSize) {
            const didBatch = dids.slice(i, i + batchSize);
            const exports = await gatekeeper.exportBatch(didBatch);

            // hyperswarm distributes only operations
            const batch = exports.map(event => event.operation);
            console.log(`${batch.length} operations fetched`);

            if (!batch || batch.length === 0) {
                continue;
            }

            const opsCount = batch.length;
            console.time('sendBatch');
            const opsSent = sendBatch(conn, batch);
            console.timeEnd('sendBatch');
            console.log(` * sent ${opsSent}/${opsCount} operations`);
        }
    }
    catch (error) {
        console.log(error);
    }
    console.timeEnd('shareDb');
}

async function relayMsg(msg: MediatorMessage): Promise<void> {
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
            const now = Date.now();
            const minutesSinceLastSeen = Math.floor((now - last.getTime()) / 1000 / 60);
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

async function importBatch(batch: Operation[]): Promise<void> {
    // The batch we receive from other hyperswarm nodes includes just operations.
    // We have to wrap the operations in new events before submitting to our gatekeeper for importing
    try {
        const hash = cipher.hashJSON(batch);
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
        const response = await gatekeeper.importBatch(events);
        console.timeEnd('importBatch');
        console.log(`* ${JSON.stringify(response)}`);
    }
    catch (error) {
        console.error(`importBatch error: ${error}`);
    }
}

async function mergeBatch(batch: Operation[]): Promise<void> {

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

    if (chunk.length > 0) {
        await importBatch(chunk);
    }

    console.time('processEvents');
    const response = await gatekeeper.processEvents();
    console.timeEnd('processEvents');
    console.log(`mergeBatch: ${JSON.stringify(response)}`);
}

let importQueue = asyncLib.queue<ImportQueueTask, asyncLib.ErrorCallback>(
    async function (task, callback) {
        const { name, msg } = task;
        try {
            const ready = await gatekeeper.isReady();

            if (ready) {
                const batch = msg.data || [];

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

let exportQueue = asyncLib.queue<ExportQueueTask, asyncLib.ErrorCallback>(
    async function (task, callback) {
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


const batchesSeen: Record<string, boolean> = {};

function newBatch(batch: Operation[]): boolean {
    const hash = cipher.hashJSON(batch);

    if (!batchesSeen[hash]) {
        batchesSeen[hash] = true;
        return true;
    }

    return false;
}

async function receiveMsg(conn: HyperswarmConnection, name: string, json: string): Promise<void> {
    let msg;

    try {
        msg = JSON.parse(json);
    }
    catch (error) {
        const jsonPreview = json.length > 80 ? `${json.slice(0, 40)}...${json.slice(-40)}` : json;
        console.log(`received invalid message from: ${shortName(name)}, JSON: ${jsonPreview}`);
        return;
    }

    console.log(`received ${msg.type} from: ${shortName(name)} (${msg.node || 'anon'})`);
    connectionLastSeen[name] = new Date().getTime();

    if (msg.type === 'batch') {
        if (newBatch(msg.data)) {
            logBatch(msg.data, msg.node || 'anon');
            await importQueue.push({ name, msg });
        }
        return;
    }

    if (msg.type === 'queue') {
        if (newBatch(msg.data)) {
            await importQueue.push({ name, msg });
            msg.relays.push(name);
            logConnection(msg.relays[0]);
            await relayMsg(msg);
        }
        return;
    }

    if (msg.type === 'sync') {
        await exportQueue.push({ name, msg, conn });
        return;
    }

    if (msg.type === 'ping') {
        connectionNodeName[name] = msg.node || 'anon';
        return;
    }

    console.log(`unknown message type`);
}

async function flushQueue(): Promise<void> {
    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(`${REGISTRY} queue: ${JSON.stringify(batch, null, 4)}`);

    if (batch.length > 0) {
        const msg: MediatorMessage = {
            type: 'queue',
            data: batch,
            relays: [],
            node: config.nodeName,
        };

        await gatekeeper.clearQueue(REGISTRY, batch);
        await relayMsg(msg);
        await mergeBatch(batch);
    }
}

async function exportLoop(): Promise<void> {
    try {
        await flushQueue();
        console.log(`export loop waiting ${config.exportInterval}s...`);
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    }
    setTimeout(exportLoop, config.exportInterval * 1000);
}

async function checkConnections(): Promise<void> {
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

async function connectionLoop(): Promise<void> {
    try {
        await checkConnections();

        const msg: MediatorMessage = {
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

function logConnection(name: string): void {
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
const hash = sha256(config.protocol);
const networkID = Buffer.from(hash).toString('hex');
const topic = Buffer.from(b4a.from(networkID, 'hex'));

async function main(): Promise<void> {
    await gatekeeper.connect({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    await connectionLoop();
    await exportLoop();
}

main();
