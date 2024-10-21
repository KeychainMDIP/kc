import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import * as exceptions from '@mdip/exceptions';

const dataFolder = 'data';

let db;

export async function start(name = 'mdip') {
    const dbName = `${dataFolder}/${name}.db`;

    db = await sqlite.open({
        filename: dbName,
        driver: sqlite3.Database
    });

    await db.exec(`CREATE TABLE IF NOT EXISTS dids (
        id TEXT PRIMARY KEY,
        events TEXT
    )`);

    await db.exec(`CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY,
        ops TEXT
    )`);
}

export async function stop() {
    await db.close();
}

export async function resetDb() {
    await db.run('DELETE FROM dids');
}

export async function addEvent(did, event) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    const events = await getEvents(did);

    events.push(event);

    const id = did.split(':').pop();
    return db.run(`INSERT OR REPLACE INTO dids(id, events) VALUES(?, ?)`, id, JSON.stringify(events));
}

export async function getEvents(did) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    try {
        const id = did.split(':').pop();
        const row = await db.get('SELECT * FROM dids WHERE id = ?', id);
        
        if (row?.events) {
            return JSON.parse(row.events);
        }
        else {
            return [];
        }
    }
    catch {
        return [];
    }
}

export async function deleteEvents(did) {
    if (!did) {
        throw new Error(exceptions.INVALID_DID);
    }

    const id = did.split(':').pop();
    return db.run('DELETE FROM dids WHERE id = ?', id);
}

export async function queueOperation(registry, op) {
    const ops = await getQueue(registry);

    ops.push(op);

    return db.run(`INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`, registry, JSON.stringify(ops));
}

export async function getQueue(registry) {
    try {
        const row = await db.get('SELECT * FROM queue WHERE id = ?', registry);

        if (!row) {
            return [];
        }

        return JSON.parse(row.ops);
    }
    catch {
        return [];
    }
}

export async function clearQueue(registry, batch) {
    try {
        const oldQueue = await getQueue(registry);
        const newQueue = oldQueue.filter(item => !batch.some(op => op.signature.value === item.signature.value));

        await db.run(`INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`, registry, JSON.stringify(newQueue));
        return true;
    }
    catch (error) {
        console.error(error);
        return false;
    }
}

export async function getAllKeys() {
    const rows = await db.all('SELECT id FROM dids');
    return rows.map(row => row.id);
}

export async function getAllEvents() {
    let allEvents = {};
    const keys = await getAllKeys();
    for (const key of keys) {
        allEvents[key] = await getEvents(key);
    }
    return allEvents;
}
