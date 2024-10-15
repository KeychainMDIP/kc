import Redis from 'ioredis';
import * as exceptions from '@mdip/exceptions';

let redis;
let DB;

export async function start(dbName) {
    let url = process.env.KC_REDIS_URL || 'redis://localhost:6379';

    redis = new Redis(url);
    DB = dbName;
}

export async function stop() {
    await redis.quit();
}

export async function resetDb() {
    let cursor = '0';
    let totalDeleted = 0;
    do {
        // Scan for keys that match the pattern
        const [newCursor, keys] = await redis.scan(cursor, 'MATCH', `${DB}/*`, 'COUNT', 1000);
        cursor = newCursor;

        if (keys.length > 0) {
            // Delete the keys found
            const deletedCount = await redis.del(...keys);
            totalDeleted += deletedCount; // Increment the total count
        }
    } while (cursor !== '0'); // Continue scanning until cursor returns to 0
    return totalDeleted;
}

export async function addEvent(did, event) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    const key = didKey(did);
    const val = JSON.stringify(event);
    redis.rpush(key, val);
}

export async function setEvents(did, events) {
    deleteEvents(did);

    // Add new events
    for (const event of events) {
        addEvent(did, event);
    }
}

function didKey(did) {
    const id = did.split(':').pop();
    return `${DB}/dids/${id}`;

}
export async function getEvents(did) {
    const events = await redis.lrange(didKey(did), 0, -1);
    return events.map(event => JSON.parse(event));
}

export async function deleteEvents(did) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    return redis.del(didKey(did));
}

export async function getAllKeys() {
    const keys = await redis.keys(`${DB}/dids/*`);
    return keys.map(key => key.split('/').pop()); // Extract the id part from the key
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
    await redis.rpush(`${DB}/queue/${registry}`, JSON.stringify(op));
}

export async function getQueue(registry) {
    try {
        const ops = await redis.lrange(`${DB}/queue/${registry}`, 0, -1);
        return ops.map(op => JSON.parse(op));
    } catch {
        return [];
    }
}

export async function clearQueue(registry, batch) {
    try {
        const ops = await getQueue(registry);
        const newOps = ops.filter(op => !batch.some(b => b.signature.value === op.signature.value));

        // Clear the current queue and add back the filtered operations
        await redis.del(`${DB}/queue/${registry}`);
        if (newOps.length > 0) {
            await redis.rpush(`${DB}/queue/${registry}`, ...newOps.map(op => JSON.stringify(op)));
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}
