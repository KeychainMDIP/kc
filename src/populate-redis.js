
import * as db_json from './db-json.js';
import * as db_redis from './db-redis.js';

await db_json.start('mdip');
await db_redis.start();

async function copyDIDs() {
    db_redis.resetDb();
    const ids = await db_json.getAllKeys();
    for (const i in ids.slice(0,10)) {
        const id = ids[i];
        console.time('getEvents');
        const events = await db_json.getEvents(id);
        console.timeEnd('getEvents');

        console.log(i, id, events);

        console.time('setEvents');
        db_redis.setEvents(id, events);
        console.timeEnd('setEvents');
    }
}

async function dumpDIDs() {
    const ids = await db_redis.getAllKeys();
    for (const i in ids) {
        const id = ids[i];
        console.time('getEvents');
        const events = await db_redis.getEvents(id);
        console.timeEnd('getEvents');

        console.log(i, id, events);
    }
}

copyDIDs();

await db_json.stop();
await db_redis.stop();
