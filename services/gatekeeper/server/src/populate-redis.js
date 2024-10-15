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

    while (ids.length > 0) {
        const i = Math.floor(Math.random() * ids.length);
        const id = ids[i];
        await db_redis.deleteEvents(id);
        console.log(`deleted ${id} ${i}`);
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

export async function importEvents(db_redis, cache) {
    let keys = Object.keys(cache);
    for (let i = 0; i < keys.length; i++) {
        const id = keys[i];
        const events = cache[id];
        const current = db_redis.getEvents(id);
        for (const event of events) {
            const ok = await gatekeeper.verifyEvent(event);

            if (ok) {
                await db_redis.addEvent(id, event);
                console.log(`added event ${event.operation.signature.value}`);
            }
        }
        console.log(`imported ${i} ${id}`);
    }
}

export async function importBatch(db_redis, batch) {
    let updated = 0;
    let verified = 0;
    let confirmed = 0;
    let rejected = 0;

    for (let i = 0; i < batch.length; i++) {
        const event = batch[i];

        console.time('verifyEvent');
        const { ok, did } = await gatekeeper.verifyEvent(event);
        console.timeEnd('verifyEvent');

        console.log(`verified event ${i} ${did} ${ok}`);

        if (ok) {
            console.time('getEvents');
            const current = await db_redis.getEvents(did);
            console.timeEnd('getEvents');

            const match = current.find(item => item.operation.signature.value === event.operation.signature.value);

            if (match) {
                const create = current[0];
                const registry = create.operation.mdip.registry;

                if (match.registry === registry) {
                    // Don't update if this op has already been validated on its native registry
                    verified += 1;
                    continue;
                }

                if (event.registry === registry) {
                    // If this import is on the native registry, replace the current one
                    const index = current.indexOf(match);
                    current[index] = event;
                    await db_redis.setEvents(did, current);
                    confirmed += 1;
                }
            }
            else {
                //await db_redis.addEvent(did, event);
                // updated += 1;
            }
        }
        else {
            console.log(JSON.stringify(event, null, 4));
            rejected += 1;
        }
    }

    console.log(JSON.stringify({ updated, verified, confirmed, rejected}, null, 4));
}

