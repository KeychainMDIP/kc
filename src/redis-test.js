import Redis from 'ioredis';
import * as exceptions from './exceptions.js';

let redis = new Redis({
    host: 'localhost',
    port: 6379
});

export async function addEvent(did, event) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    const id = did.split(':').pop();

    //console.time('rpush');
    await redis.rpush(`dids/${id}`, JSON.stringify(event));
    //console.timeEnd('rpush');
}

export async function setEvents(did, events) {
    deleteEvents(did);

    // Add new events
    for (const event of events) {
        addEvent(did, event);
    }
}

export async function getEvents(did) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    try {
        const id = did.split(':').pop();
        //console.time('lrange');
        const events = await redis.lrange(`dids/${id}`, 0, -1);
        //console.timeEnd('lrange');
        return events.map(event => JSON.parse(event));
    } catch {
        return [];
    }
}

export async function deleteEvents(did) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    const id = did.split(':').pop();
    await redis.del(`dids:${id}`);
}

export async function getAllKeys() {
    const keys = await redis.keys('dids/*');
    return keys.map(key => key.split('/')[1]); // Extract the id part from the key
}

await redis.flushdb();

async function populate(n) {
    for (let i = 0; i < n; i++) {
        const did = `did:test:key-${i}`;

        await deleteEvents(did);

        for (let j = 0; j < 10; j++) {
            const event = {
                date: new Date().toISOString(),
                ordinal: j
            };
            await addEvent(did, event);
        }
    }
}

async function dump() {
    const keys = await getAllKeys();
    for (const key of keys) {
        const events = await getEvents(key);
        //console.log(`${key} ${JSON.stringify(events)}`);
    }
}

console.time('populate');
await populate(10000);
console.timeEnd('populate');

console.time('dump');
await dump();
console.timeEnd('dump');

await redis.quit();
