import { MongoClient } from 'mongodb';
import config from './config.js';
import * as exceptions from '@mdip/exceptions';

let client;
let db;

export async function start(dbName = 'mdip') {
    client = new MongoClient(config.mongodbUrl || 'mongodb://localhost:27017');
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

export async function addEvent(did, event) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    const id = did.split(':').pop();

    return db.collection('dids').updateOne(
        { id: id },
        { $push: { events: event } },
        { upsert: true }
    );
}

export async function getEvents(did) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    try {
        const id = did.split(':').pop();
        const row = await db.collection('dids').findOne({ id: id });
        return row.events;
    }
    catch {
        return [];
    }
}

export async function deleteEvents(did) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    const id = did.split(':').pop();
    await db.collection('dids').deleteOne({ id: id });
}

export async function getAllKeys() {
    const rows = await db.collection('dids').find().toArray();
    return rows.map(row => row.id);
}

export async function getAllEvents() {
    let allEvents = {};
    const keys = await getAllKeys();
    for (const key of keys) {
        allEvents[key] = await getEvents(key);
    }
    return allEvents;
}

export async function queueOperation(registry, op) {
    await db.collection('queue').updateOne(
        { id: registry },
        { $push: { ops: op } },
        { upsert: true }
    );
}

export async function getQueue(registry) {
    try {
        const row = await db.collection('queue').findOne({ id: registry });
        return row ? row.ops : [];
    }
    catch {
        return [];
    }
}

export async function clearQueue(registry, batch) {
    try {
        const queueCollection = db.collection('queue');
        const oldQueueDocument = await queueCollection.findOne({ id: registry });
        const oldQueue = oldQueueDocument.ops;
        const newQueue = oldQueue.filter(item => !batch.some(op => op.signature.value === item.signature.value));

        await queueCollection.updateOne(
            { id: registry },
            { $set: { ops: newQueue } },
            { upsert: true }
        );

        return true;
    }
    catch (error) {
        console.error(error);
        return false;
    }
}
