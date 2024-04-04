import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';

const dataFolder = 'data';
const dbName = `${dataFolder}/mdip-v2.db`;

const db = await sqlite.open({
    filename: dbName,
    driver: sqlite3.Database
});

await db.exec(`CREATE TABLE IF NOT EXISTS dids (
    id TEXT PRIMARY KEY,
    ops TEXT
)`);

export async function backupDb() {
}

export async function resetDb() {
    await db.run('DELETE FROM dids');
}

export async function addOperation(op) {
    const did = op.did;
    const ops = await getOperations(did);

    ops.push(op);

    const id = op.did.split(':').pop();
    await db.run(`INSERT OR REPLACE INTO dids(id, ops) VALUES(?, ?)`, id, JSON.stringify(ops));
}

export async function getOperations(did) {
    try {
        const id = did.split(':').pop();
        const row = await db.get('SELECT * FROM dids WHERE id = ?', id);
        const ops = JSON.parse(row.ops);
        return ops;
    }
    catch {
        return [];
    }
}

export async function getAllDIDs() {
    const rows = await db.all('SELECT id FROM dids');
    const ids = rows.map(row => row.id);
    const dids = [];

    for (const id of ids) {
        const ops = await getOperations(id);
        dids.push(ops[0].did);
    }

    return dids;
}

export async function deleteDID(did) {
    const id = did.split(':').pop();
    await db.run('DELETE FROM dids WHERE id = ?', id);
}
