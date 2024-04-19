import { MongoClient } from 'mongodb';
import config from './config.js';

let client;
let db;

export async function start(dbName = 'mdip') {
    client = new MongoClient(config.mongodbUrl);
    await client.connect();
    db = client.db(dbName);
    await db.collection('dids').createIndex({ id: 1 });
}

export async function stop() {
    await client.close();
}

export async function resetDb() {
    await db.collection('dids').deleteMany({});
}

export async function addOperation(op) {
    const id = op.did.split(':').pop();

    console.time('updateOne');
    await db.collection('dids').updateOne(
        { id: id },
        { $push: { ops: op } },
        { upsert: true }
    );
    console.timeEnd('updateOne');
}

export async function getOperations(did) {
    try {
        const id = did.split(':').pop();
        console.time('findOne');
        const row = await db.collection('dids').findOne({ id: id });
        console.timeEnd('findOne');
        return row.ops;
    }
    catch {
        return [];
    }
}

export async function deleteOperations(did) {
    const id = did.split(':').pop();
    await db.collection('dids').deleteOne({ id: id });
}

export async function queueOperation(op) {
    op;
}

export async function getQueue(registry) {
    registry;
}

export async function clearQueue(registry, batch) {
    registry;
    batch;
}

export async function getAllKeys() {
    const rows = await db.collection('dids').find().toArray();
    const ids = rows.map(row => row.id);
    return ids;
}
