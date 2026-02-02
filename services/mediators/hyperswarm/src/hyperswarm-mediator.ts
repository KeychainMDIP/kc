import Hyperswarm, { HyperswarmConnection } from 'hyperswarm';
import goodbye from 'graceful-goodbye';
import b4a from 'b4a';
import { sha256 } from '@noble/hashes/sha256';
import asyncLib from 'async';
import { EventEmitter } from 'events';

import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import KuboClient from '@mdip/ipfs/kubo';
import { Operation } from '@mdip/gatekeeper/types';
import CipherNode from '@mdip/cipher/node';
import config from './config.js';
import { exit } from 'process';

interface HyperMessage {
    type: 'batch' | 'queue' | 'sync' | 'ping';
    time: string;
    node: string;
    relays: string[];
}

interface PingMessage extends HyperMessage {
    peers: string[];
}

interface BatchMessage extends HyperMessage {
    data: Operation[];
}

interface ImportQueueTask {
    name: string;
    msg: BatchMessage;
}

interface ExportQueueTask extends ImportQueueTask {
    conn: HyperswarmConnection;
}

interface NodeInfo {
    name: string;
    ipfs: any;
}

interface ConnectionInfo {
    connection: HyperswarmConnection;
    key: string;
    peerName: string;
    nodeName: string;
    did: string;
    lastSeen: number;
}

const gatekeeper = new GatekeeperClient();
const keymaster = new KeymasterClient();
const ipfs = new KuboClient();
const cipher = new CipherNode();

EventEmitter.defaultMaxListeners = 100;

const REGISTRY = 'hyperswarm';
const BATCH_SIZE = 100;

const connectionInfo: Record<string, ConnectionInfo> = {};
const knownNodes: Record<string, NodeInfo> = {};
const knownPeers: Record<string, string> = {};
const addedPeers: Record<string, number> = {};
const badPeers: Record<string, number> = {};

let swarm: Hyperswarm | null = null;
let nodeKey = '';
let nodeInfo: NodeInfo;

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
    nodeKey = b4a.toString(swarm.keyPair.publicKey, 'hex');

    swarm.on('connection', conn => addConnection(conn));

    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();

    const shortTopic = shortName(b4a.toString(topic, 'hex'));
    console.log(`new hyperswarm peer id: ${shortName(nodeKey)} (${config.nodeName}) joined topic: ${shortTopic} using protocol: ${config.protocol}`);
}

let syncQueue = asyncLib.queue<HyperswarmConnection, asyncLib.ErrorCallback>(
    async function (conn, callback) {
        try {
            // Wait until the importQueue is empty
            while (importQueue.length() > 0) {
                console.log(`* sync waiting 10s for importQueue to empty. Current length: ${importQueue.length()}`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            const msg: HyperMessage = {
                type: 'sync',
                time: new Date().toISOString(),
                node: nodeInfo.name,
                relays: [],
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
    const peerKey = b4a.toString(conn.remotePublicKey, 'hex');
    const peerName = shortName(peerKey);

    conn.once('close', () => closeConnection(peerKey));
    conn.on('data', data => receiveMsg(peerKey, data));

    console.log(`received connection from: ${peerName}`);

    // Push the connection to the syncQueue instead of writing directly
    syncQueue.push(conn);

    connectionInfo[peerKey] = {
        connection: conn,
        key: peerKey,
        peerName: peerName,
        nodeName: 'anon',
        did: '',
        lastSeen: new Date().getTime(),
    };

    const peerNames = Object.values(connectionInfo).map(info => info.peerName);
    console.log(`--- ${peerNames.length} nodes connected, detected nodes: ${peerNames.join(', ')}`);
}

function closeConnection(peerKey: string): void {
    const conn = connectionInfo[peerKey];
    console.log(`* connection closed with: ${conn.peerName} (${conn.nodeName}) *`);

    delete connectionInfo[peerKey];
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

function sendBatch(conn: HyperswarmConnection, batch: Operation[]): number {
    const limit = 8 * 1024 * 1014; // 8 MB limit

    const msg: BatchMessage = {
        type: 'batch',
        time: new Date().toISOString(),
        node: nodeInfo.name,
        relays: [],
        data: batch,
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

async function relayMsg(msg: HyperMessage): Promise<void> {
    const json = JSON.stringify(msg);

    const connectionsCount = Object.keys(connectionInfo).length;
    console.log(`Connected nodes: ${connectionsCount}`);
    console.log(`* sending ${msg.type} from: ${shortName(nodeKey)} (${config.nodeName}) *`);

    for (const peerKey in connectionInfo) {
        const conn = connectionInfo[peerKey];
        const last = new Date(conn.lastSeen);
        const now = Date.now();
        const minutesSinceLastSeen = Math.floor((now - last.getTime()) / 1000 / 60);
        const lastSeen = `last seen ${minutesSinceLastSeen} minutes ago ${last.toISOString()}`;

        if (!msg.relays.includes(peerKey)) {
            conn.connection.write(json);
            console.log(`* relaying to: ${conn.peerName} (${conn.nodeName}) ${lastSeen} *`);
        }
        else {
            console.log(`* skipping relay to: ${conn.peerName} (${conn.nodeName}) ${lastSeen} *`);
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

async function addPeer(did: string): Promise<void> {
    if (!config.ipfsEnabled) {
        return;
    }

    // Check peer suffix to avoid duplicate DID aliases
    const suffix = did.split(':').pop() || '';

    if (suffix in addedPeers) {
        return;
    }

    console.log(`Adding peer ${did}...`);
    addedPeers[suffix] = Date.now();

    try {
        const docs = await keymaster.resolveDID(did);
        const data = docs.didDocumentData as { node: NodeInfo };

        if (!data?.node || !data.node.ipfs) {
            return;
        }

        const { id, addresses } = data.node.ipfs;

        if (!id || !addresses) {
            return;
        }

        if (id !== nodeInfo.ipfs.id) {
            // A node should never add itself as a peer node
            await ipfs.addPeeringPeer(id, addresses);
        }

        knownNodes[did] = {
            name: data.node.name,
            ipfs: {
                id,
                addresses,
            },
        };

        knownPeers[id] = data.node.name;

        console.log(`Added IPFS peer: ${did} ${JSON.stringify(knownNodes[did], null, 4)}`);
    }
    catch (error) {
        if (!(did in badPeers)) {
            // Store time of first error so we can later implement a retry mechanism
            badPeers[did] = Date.now();
            console.error(`Error adding IPFS peer: ${did}`, error);
        }
    }
}

async function receiveMsg(peerKey: string, json: string): Promise<void> {
    const conn = connectionInfo[peerKey];
    let msg;

    try {
        msg = JSON.parse(json);
    }
    catch (error) {
        const jsonPreview = json.length > 80 ? `${json.slice(0, 40)}...${json.slice(-40)}` : json;
        console.log(`received invalid message from: ${conn.peerName}, JSON: ${jsonPreview}`);
        return;
    }

    const nodeName = msg.node || 'anon';

    console.log(`received ${msg.type} from: ${shortName(peerKey)} (${nodeName})`);
    connectionInfo[peerKey].lastSeen = new Date().getTime();

    if (msg.type === 'batch') {
        if (newBatch(msg.data)) {
            importQueue.push({ name: peerKey, msg });
        }
        return;
    }

    if (msg.type === 'queue') {
        if (newBatch(msg.data)) {
            importQueue.push({ name: peerKey, msg });
            msg.relays.push(peerKey);
            await relayMsg(msg);
        }
        return;
    }

    if (msg.type === 'sync') {
        exportQueue.push({ name: peerKey, msg, conn: conn.connection });
        return;
    }

    if (msg.type === 'ping') {
        connectionInfo[peerKey].nodeName = nodeName;

        if (msg.peers) {
            for (const did of msg.peers) {
                addPeer(did);
            }
        }

        return;
    }

    console.log(`unknown message type: ${msg.type}`);
}

async function flushQueue(): Promise<void> {
    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(`${REGISTRY} queue: ${JSON.stringify(batch, null, 4)}`);

    if (batch.length > 0) {
        const msg: BatchMessage = {
            type: 'queue',
            time: new Date().toISOString(),
            node: nodeInfo.name,
            relays: [],
            data: batch,
        };

        await gatekeeper.clearQueue(REGISTRY, batch);
        await relayMsg(msg);
        await mergeBatch(batch);
    }
}

async function exportLoop(): Promise<void> {
    try {
        await flushQueue();
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    }

    const importQueueLength = importQueue.length();

    if (importQueueLength > 0) {
        const delay = 60;
        console.log(`export loop waiting ${delay}s for import queue to clear: ${importQueueLength}...`);
        setTimeout(exportLoop, delay * 1000);
    }
    else {
        console.log(`export loop waiting ${config.exportInterval}s...`);
        setTimeout(exportLoop, config.exportInterval * 1000);
    }
}

async function checkConnections(): Promise<void> {
    if (Object.keys(connectionInfo).length === 0) {
        console.log("No active connections, rejoining the topic...");
        await createSwarm();
        return;
    }

    const expireLimit = 3 * 60 * 1000; // 3 minutes in milliseconds
    const now = Date.now();

    for (const peerKey in connectionInfo) {
        const conn = connectionInfo[peerKey];
        const timeSinceLastSeen = now - conn.lastSeen;

        if (timeSinceLastSeen > expireLimit) {
            console.log(`Removing stale connection info for: ${conn.peerName} (${conn.nodeName}), last seen ${timeSinceLastSeen / 1000}s ago`);
            delete connectionInfo[peerKey];
        }
    }
}

async function connectionLoop(): Promise<void> {
    try {
        console.log(`Node info: ${JSON.stringify(nodeInfo, null, 4)}`);
        console.log(`Connected to hyperswarm protocol: ${config.protocol}`);

        await checkConnections();

        const msg: PingMessage = {
            type: 'ping',
            time: new Date().toISOString(),
            node: nodeInfo.name,
            relays: [],
            peers: Object.keys(knownNodes),
        };

        await relayMsg(msg);

        if (config.ipfsEnabled) {
            const peeringPeers = await ipfs.getPeeringPeers();
            console.log(`IPFS peers: ${peeringPeers.length}`);
            for (const peer of peeringPeers) {
                console.log(`* peer ${peer.ID} (${knownPeers[peer.ID]})`);
            }
        }

        console.log('connection loop waiting 60s...');
    } catch (error) {
        console.error(`Error in pingLoop: ${error}`);
    }
    setTimeout(connectionLoop, 60 * 1000);
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

    if (config.ipfsEnabled) {
        await keymaster.connect({
            url: config.keymasterURL,
            waitUntilReady: true,
            intervalSeconds: 5,
            chatty: true,
        });

        if (!config.nodeID) {
            console.log('nodeID is not set. Please set the nodeID in the config file.');
            exit(1);
        }

        const { didDocument } = await keymaster.resolveDID(config.nodeID);

        if (!didDocument) {
            console.error(`DID document not found for nodeID: ${config.nodeID}`);
            exit(1);
        }

        const nodeDID = didDocument.id;

        if (!nodeDID) {
            console.error(`DID not found in the DID document for nodeID: ${config.nodeID}`);
            exit(1);
        }

        console.log(`Using nodeID: ${config.nodeID} (${nodeDID})`);

        await ipfs.connect({
            url: config.ipfsURL,
            waitUntilReady: true,
            intervalSeconds: 5,
            chatty: true,
        });
        await ipfs.resetPeeringPeers();

        const ipfsID = await ipfs.getPeerID();
        const ipfsAddresses = await ipfs.getAddresses();
        console.log(`Using IPFS nodeID: ${JSON.stringify(ipfsID, null, 4)}`);

        nodeInfo = {
            name: config.nodeName,
            ipfs: {
                id: ipfsID,
                addresses: ipfsAddresses,
            },
        };

        knownNodes[nodeDID] = nodeInfo;
        await keymaster.updateAsset(nodeDID, { node: nodeInfo });
    } else {
        nodeInfo = {
            name: config.nodeName,
            ipfs: null,
        };
    }

    await exportLoop();
    await connectionLoop();
}

main();
