import * as db from '../src/db-redis.js';

async function populate(n) {
    for (let i = 0; i < n; i++) {
        const did = `did:test:key-${i}`;

        await db.deleteEvents(did);

        for (let j = 0; j < 10; j++) {
            const event = {
                date: new Date().toISOString(),
                ordinal: j
            };
            await db.addEvent(did, event);
        }
    }

    console.log(`${n} DIDs added with 10 events`);
}

async function dump() {
    const keys = await db.getAllKeys();
    for (const key of keys) {
        await db.getEvents(key);
        //console.log(`${key} ${JSON.stringify(events)}`);
    }
}

await db.start('test');

console.time('populate');
await populate(10000);
console.timeEnd('populate');

console.time('dump');
await dump();
console.timeEnd('dump');

await db.resetDb();
await db.stop();
