
import * as db_json from './db-json.js';
import * as db_redis from './db-redis.js';

await db_json.start('mdip');
await db_redis.start();

async function copyDIDs() {
    const ids = await db_json.getAllKeys();
    db_redis.resetDb();

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

// console.time('copyDIDs');
// await copyDIDs();
// console.timeEnd('copyDIDs');

console.time('dumpDIDs');
await dumpDIDs();
console.timeEnd('dumpDIDs');

await db_json.stop();
await db_redis.stop();
