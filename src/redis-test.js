import * as db from './db-redis.js';

await db.start();
await db.resetDb();

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
}

async function dump() {
    const keys = await db.getAllKeys();
    for (const key of keys) {
        await db.getEvents(key);
        //console.log(`${key} ${JSON.stringify(events)}`);
    }
}

console.time('populate');
await populate(10000);
console.timeEnd('populate');

console.time('dump');
await dump();
console.timeEnd('dump');

await db.stop();
