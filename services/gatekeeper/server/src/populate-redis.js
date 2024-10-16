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

async function importEvent(db_redis, did, event) {
    console.time('getEvents');
    const currentEvents = await db_redis.getEvents(did);
    console.timeEnd('getEvents');

    const match = currentEvents.find(item => item.operation.signature.value === event.operation.signature.value);

    if (match) {
        const first = currentEvents[0];
        const nativeRegistry = first.operation.mdip.registry;

        if (match.registry === nativeRegistry) {
            return false;
        }

        if (event.registry === nativeRegistry) {
            // If this import is on the native registry, replace the current one
            const index = currentEvents.indexOf(match);
            currentEvents[index] = event;
            await db_redis.setEvents(did, currentEvents);
            return true;
        }

        return false;
    }
    else {
        await db_redis.addEvent(did, event);
        return true;
    }
}

export async function importBatch(db_redis, batch, deleteFirst) {
    let updated = 0;
    let verified = 0;
    let confirmed = 0;
    let rejected = 0;

    if (deleteFirst) {
        const deleted = await db_redis.resetDb();
        console.log(`${deleted} keys deleted`);
    }

    for (let i = 0; i < batch.length; i++) {
        const event = batch[i];

        console.time('verifyEvent');
        const { ok, did } = await gatekeeper.verifyEvent(event);
        console.timeEnd('verifyEvent');

        console.log(`verified event ${i} ${did} ${ok}`);

        if (ok) {
            const eventUpdated = await importEvent(db_redis, did, event);

            if (eventUpdated) {
                updated += 1;
            }
            else {
                verified += 1;
            }
        }
        else {
            console.log(JSON.stringify(event, null, 4));
            rejected += 1;
        }
    }

    console.log(JSON.stringify({ updated, verified, confirmed, rejected }, null, 4));
}

