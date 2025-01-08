import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import { InvalidDIDError } from '@mdip/common/errors';

export default class DbSqlite {
    constructor(name, dataFolder = 'data') {
        this.dbName = `${dataFolder}/${name}.db`;
    }

    async start() {
        this.db = await sqlite.open({
            filename: this.dbName,
            driver: sqlite3.Database
        });

        await this.db.exec(`CREATE TABLE IF NOT EXISTS dids (
            id TEXT PRIMARY KEY,
            events TEXT
        )`);

        await this.db.exec(`CREATE TABLE IF NOT EXISTS queue (
            id TEXT PRIMARY KEY,
            ops TEXT
        )`);
    }

    async stop() {
        await this.db.close();
    }


    async resetDb() {
        await this.db.run('DELETE FROM dids');
    }

    async addEvent(did, event) {
        if (!did) {
            throw new InvalidDIDError();
        }

        const events = await this.getEvents(did);
        events.push(event);

        return this.setEvents(did, events);
    }

    async setEvents(did, events) {
        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop();
        return this.db.run(`INSERT OR REPLACE INTO dids(id, events) VALUES(?, ?)`, id, JSON.stringify(events));
    }

    async getEvents(did) {
        if (!did) {
            throw new InvalidDIDError();
        }

        try {
            const id = did.split(':').pop();
            const row = await this.db.get('SELECT * FROM dids WHERE id = ?', id);

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

    async deleteEvents(did) {
        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop();
        return this.db.run('DELETE FROM dids WHERE id = ?', id);
    }

    async queueOperation(registry, op) {
        const ops = await this.getQueue(registry);

        ops.push(op);

        return this.db.run(`INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`, registry, JSON.stringify(ops));
    }

    async getQueue(registry) {
        try {
            const row = await this.db.get('SELECT * FROM queue WHERE id = ?', registry);

            if (!row) {
                return [];
            }

            return JSON.parse(row.ops);
        }
        catch {
            return [];
        }
    }

    async clearQueue(registry, batch) {
        try {
            const oldQueue = await this.getQueue(registry);
            const newQueue = oldQueue.filter(item => !batch.some(op => op.signature.value === item.signature.value));

            await this.db.run(`INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`, registry, JSON.stringify(newQueue));
            return true;
        }
        catch (error) {
            console.error(error);
            return false;
        }
    }

    async getAllKeys() {
        const rows = await this.db.all('SELECT id FROM dids');
        return rows.map(row => row.id);
    }
}
