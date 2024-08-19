import Redis from 'ioredis';
import * as exceptions from './exceptions.js';

let redis;

export async function start() {
    // const url = process.env.KC_REDIS_URL || 'http://localhost:6379';
    // redis = new Redis(url);
    redis = new Redis({
        host: 'localhost',
        port: 6379
    });
}

export async function stop() {
    await redis.quit();
}

export async function resetDb() {
    await redis.flushdb();
}

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

    console.log(`${did}`);
    const id = did.split(':').pop();
    console.time('lrange');
    const events = await redis.lrange(`dids/${id}`, 0, -1);
    console.timeEnd('lrange');
    return events.map(event => JSON.parse(event));
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

export async function queueOperation(registry, op) {
    await redis.lpush(`queue:${registry}`, JSON.stringify(op));
}

export async function getQueue(registry) {
    try {
        const ops = await redis.lrange(`queue:${registry}`, 0, -1);
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
        await redis.del(`queue:${registry}`);
        if (newOps.length > 0) {
            await redis.rpush(`queue:${registry}`, ...newOps.map(op => JSON.stringify(op)));
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}
