import { MongoClient } from 'mongodb';
import config from './config.js';

let client;
let db;

export async function start(dbName = 'mdip') {
    client = new MongoClient(config.mongodbUrl);
    await client.connect();
    db = client.db(dbName);
}

export async function stop() {
    await client.close();
}

export async function resetDb() {
    await db.collection('dids').deleteMany({});
}

export async function addOperation(op) {
    const did = op.did;
    const ops = await getOperations(did);

    ops.push(op);

    const id = op.did.split(':').pop();
    await db.collection('dids').updateOne(
        { id: id },
        { $set: { ops: JSON.stringify(ops) } },
        { upsert: true }
    );
}

export async function getOperations(did) {
    try {
        const id = did.split(':').pop();
        const row = await db.collection('dids').findOne({ id: id });
        const ops = JSON.parse(row.ops);
        return ops;
    }
    catch {
        return [];
    }
}

export async function deleteOperations(did) {
    const id = did.split(':').pop();
    await db.collection('dids').deleteOne({ id: id });
}

export async function getAllKeys() {
    const rows = await db.collection('dids').find().toArray();
    const ids = rows.map(row => row.id);
    return ids;
}
