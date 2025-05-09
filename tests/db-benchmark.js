import * as uuid from 'uuid';

import DbJson from '@mdip/gatekeeper/db/json';
import DbSqlite from '@mdip/gatekeeper/db/sqlite';
import DbMongo from '@mdip/gatekeeper/db/mongo';
import DbRedis from '@mdip/gatekeeper/db/redis';

async function importDIDs(db) {

    for (let i = 0; i < 100; i++) {

        const id = uuid.v4();
        const did = `did:test:${id}`;
        console.log(i, did);

        console.time('add DID');

        for (let j = 0; j < 10; j++) {

            const event = {
                "registry": "hyperswarm",
                "time": "2024-04-04T13:56:09.975Z",
                "ordinal": 0,
                "operation": {
                    "type": "create",
                    "created": new Date().toISOString(),
                    "mdip": {
                        "version": 1,
                        "type": "asset",
                        "registry": "hyperswarm"
                    },
                    "controller": "did:test:z3v8AuaX8nDuXtLHrLAGmgfeVwCGfX9nMmZPTVbCDfaoiGvLuTv",
                    "data": {
                        "backup": "jOwkc_Xki_1Hhk6qsqDVJEfHn4ZLv7fzpHBBOUdUK6qU_gA-p319ej2vmT227DmZVMxrrUHrrPPa6ZPM7lxPOAvN1cTWQ6L8nTn-SBy6BCrGHYc-VkUEuD1c7peoBT9QooY3Re3zSnv0Wvnr9ZfK4Q-r3s-lwSvAwMbUSxBvvyjLNQOLWecCkYxPW4YLsdw7aqoQHAFhys5564q8EqkGqKRP6SyW3GElF9YtV9Xq22-Hr30u-DGeWSKg-aP25slrRHLUvwYg2EbVeCspZvAIiizfIfhlNKXwmKmqo6dcx8QfcZKtjuJaYYRIC50FvLTPHN3Ca4NAmEXqXzJKj9csMhCJ_VTaQ_NN90ycysdDy7BffYqCDWkntteY5YEHRPt6GruTGPtSoE0fNQCPOZwFsY4"
                    },
                    "signature": {
                        "signer": "did:test:z3v8AuaX8nDuXtLHrLAGmgfeVwCGfX9nMmZPTVbCDfaoiGvLuTv",
                        "signed": "2024-04-04T13:56:09.985Z",
                        "hash": "0ab16157713ae7ff748c6c5d6eb227b4210e50716da2dc160419ebf8065e39af",
                        "value": "b02e0450c3cb72072b07a17b393d6dc824167cfbc619b7929664bc9a8c81abc56a77de7408e924f459877517704eb9076b2c171f4e4305e930de06e4d3d6a96a"
                    }
                }
            };

            console.time('addOperation');
            await db.addEvent(did, event);
            console.timeEnd('addOperation');
        }

        console.time('getAllKeys');
        const keys = await db.getAllKeys();
        console.timeEnd('getAllKeys');
        console.log(`${keys.length} keys`);

        console.timeEnd('add DID');
    }
}

async function exportDIDs(db) {
    const ids = await db.getAllKeys();

    for (const i in ids) {
        const id = ids[i];
        console.time('getEvents');
        const events = await db.getEvents(id);
        console.timeEnd('getEvents');
        console.log(i, id, events);
    }
}

async function runBenchmark(db) {
    await db.start();
    await db.resetDb();

    console.time('>> importDIDs');
    await importDIDs(db);
    console.timeEnd('>> importDIDs');

    console.time('>> exportDIDs');
    await exportDIDs(db);
    console.timeEnd('>> exportDIDs');

    await db.resetDb();
    await db.stop();
}

async function main() {
    const dbName = 'mdip-benchmark';

    const db_json = new DbJson(dbName);
    console.log('>> db_json');
    await runBenchmark(db_json);

    const db_sqlite = new DbSqlite(dbName);
    console.log('>> db_sqlite');
    await runBenchmark(db_sqlite);

    const db_mongodb = new DbMongo(dbName);
    console.log('>> db_mongodb');
    await runBenchmark(db_mongodb);

    const db_redis = new DbRedis(dbName);
    console.log('>> db_redis');
    await runBenchmark(db_redis);
}

main();

