import * as db_json from '@mdip/gatekeeper/db/json';
import * as db_redis from '@mdip/gatekeeper/db/redis';

async function copyDIDs() {
    const allEvents = await db_json.getAllEvents();
    const ids = Object.keys(allEvents);
    const deleted = await db_redis.resetDb();

    console.log(`${deleted} keys deleted`);

    for (const i in ids) {
        const id = ids[i];
        const events = allEvents[id];
        await db_redis.setEvents(id, events);
        console.log(`${i} ${id} copied`);
    }
}

async function dumpDIDs() {
    const ids = await db_redis.getAllKeys();
    let cache = {};
    console.log(`${ids.length} keys`);
    for (const i in ids) {
        const id = ids[i];
        cache[id] = await db_redis.getEvents(id);
        console.log(`${i} ${id} retrieved`);
    }
    return cache;
}

async function deleteDIDs() {
    let ids = await db_redis.getAllKeys();

    while (ids.length > 0) {
        const i = Math.floor(Math.random() * ids.length);
        const id = ids[i];
        await db_redis.deleteEvents(id);
        console.log(`deleted ${id} ${i}`);
        ids.splice(i, 1);
    }
}

async function restoreDIDs(cache) {
    let keys = Object.keys(cache);
    for (let i = 0; i < keys.length; i++) {
        const id = keys[i];
        await db_redis.setEvents(id, cache[id]);
        console.log(`${i} ${id} restored`);
    }
}

// eslint-disable-next-line
async function test() {
    await db_json.start('mdip');
    await db_redis.start('mdip');

    console.time('copyDIDs');
    await copyDIDs();
    console.timeEnd('copyDIDs');

    console.time('dumpDIDs');
    const cache = await dumpDIDs();
    console.timeEnd('dumpDIDs');

    console.time('deleteDIDs');
    await deleteDIDs();
    console.timeEnd('deleteDIDs');

    console.time('restoreDIDs');
    await restoreDIDs(cache);
    console.timeEnd('restoreDIDs');

    await db_json.stop();
    await db_redis.stop();
}

async function copy() {
    await db_json.start('mdip');
    await db_redis.start('mdip');

    console.time('copyDIDs');
    await copyDIDs();
    console.timeEnd('copyDIDs');

    await db_json.stop();
    await db_redis.stop();
}

//test();
copy();

