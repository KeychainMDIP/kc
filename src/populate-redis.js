
import * as db_json from './db-json.js';
import * as db_redis from './db-redis.js';

await db_json.start('mdip');
await db_redis.start('mdip');

async function copyDIDs() {
    const ids = await db_json.getAllKeys();
    const deleted = await db_redis.resetDb();

    console.log(`${deleted} keys deleted`);

    for (const i in ids) {
        const id = ids[i];
        const events = await db_json.getEvents(id);
        await db_redis.setEvents(id, events);
        console.log(`${i} ${id} copied`);
    }
}

async function dumpDIDs() {
    const ids = await db_redis.getAllKeys();
    console.log(`${ids.length} keys`);
    for (const i in ids) {
        const id = ids[i];
        const events = await db_redis.getEvents(id);
        console.log(`${i} ${id} retrieved`);
    }
}

async function deleteDIDs() {
    let ids = await db_redis.getAllKeys();
    let cache = {};

    while (ids.length > 0) {
        // Select a random index
        const i = Math.floor(Math.random() * ids.length);

        // Get the DID at the random index
        const id = ids[i];

        cache[id] = await db_redis.getEvents(id);
        await db_redis.deleteEvents(id);
        console.log(`deleted ${id} ${i}`);

        // Remove the DID from the ids array
        ids.splice(i, 1);
    }

    return cache;
}

async function restoreDIDs(cache) {
    let keys = Object.keys(cache);
    for (let i = 0; i < keys.length; i++) {
        const id = keys[i];
        await db_redis.setEvents(id, cache[id]);
        console.log(`${i} ${id} restored`);
    }
}

console.time('copyDIDs');
await copyDIDs();
console.timeEnd('copyDIDs');

console.time('dumpDIDs');
await dumpDIDs();
console.timeEnd('dumpDIDs');

console.time('deleteDIDs');
const cache = await deleteDIDs();
console.timeEnd('deleteDIDs');

console.time('restoreDIDs');
await restoreDIDs(cache);
console.timeEnd('restoreDIDs');

await db_json.stop();
await db_redis.stop();
