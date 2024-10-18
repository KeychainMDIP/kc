import * as gatekeeper from '@mdip/gatekeeper/lib';

export async function copyDIDs(db_json, db_redis) {
    const allEvents = await db_json.getAllEvents();
    const ids = Object.keys(allEvents);
    const deleted = await db_redis.resetDb();

    console.log(`${deleted} keys deleted`);

    for (const i in ids) {
        const id = ids[i];
        const events = allEvents[id];
        await db_redis.setEvents(id, events);
        console.log(`copied ${i} ${id} copied`);
    }
}

export async function dumpDIDs(db_redis) {
    const ids = await db_redis.getAllKeys();
    let cache = {};
    console.log(`${ids.length} keys`);
    for (const i in ids) {
        const id = ids[i];
        cache[id] = await db_redis.getEvents(id);
        console.log(`retrieved ${i} ${id}`);
    }
    return cache;
}

export async function deleteDIDs(db_redis) {
    let ids = await db_redis.getAllKeys();
    let n = 0;

    while (ids.length > 0) {
        n += 1;
        const i = Math.floor(Math.random() * ids.length);
        const id = ids[i];
        await db_redis.deleteEvents(id);
        console.log(`deleted ${n} ${id} ${i}`);
        ids.splice(i, 1);
    }
}

export async function restoreDIDs(db_redis, cache) {
    let keys = Object.keys(cache);
    for (let i = 0; i < keys.length; i++) {
        const id = keys[i];
        await db_redis.setEvents(id, cache[id]);
        console.log(`restored ${i} ${id}`);
    }
}
