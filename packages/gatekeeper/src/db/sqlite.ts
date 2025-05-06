import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import { InvalidDIDError } from '@mdip/common/errors';
import { GatekeeperDb, GatekeeperEvent, Operation, BlockId, BlockInfo } from '../types.js'

interface DidsRow {
    id: string
    events: string
}

interface QueueRow {
    id: string
    ops: string
}

const SQLITE_NOT_STARTED_ERROR = 'SQLite DB not open. Call start() first.';

export default class DbSqlite implements GatekeeperDb {
    private readonly dbName: string;
    private db: sqlite.Database | null;

    constructor(name: string, dataFolder: string = 'data') {
        this.dbName = `${dataFolder}/${name}.db`;
        this.db = null
    }

    async start(): Promise<void> {
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

        await this.db.exec(`CREATE TABLE IF NOT EXISTS blocks (
                registry TEXT NOT NULL,
                hash TEXT NOT NULL,
                height INTEGER NOT NULL,
                time TEXT NOT NULL,
                txns INTEGER NOT NULL,
                PRIMARY KEY (registry, hash)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_height ON blocks (registry, height);
        `);
    }

    async stop(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }


    async resetDb(): Promise<void> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        await this.db.run('DELETE FROM dids');
        await this.db.run('DELETE FROM queue');
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        if (!did) {
            throw new InvalidDIDError();
        }

        const events = await this.getEvents(did);
        events.push(event);

        return this.setEvents(did, events);
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop() || '';
        const result = await this.db.run(`INSERT OR REPLACE INTO dids(id, events) VALUES(?, ?)`, id, JSON.stringify(events));
        return result.changes ?? 0;
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        if (!did) {
            throw new InvalidDIDError();
        }

        try {
            const id = did.split(':').pop() || '';
            const row = await this.db.get<DidsRow>('SELECT * FROM dids WHERE id = ?', id);

            if (row?.events) {
                return JSON.parse(row.events) as GatekeeperEvent[];
            }
            else {
                return [];
            }
        }
        catch {
            return [];
        }
    }

    async deleteEvents(did: string): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop() || '';
        const result = await this.db.run('DELETE FROM dids WHERE id = ?', id);
        return result.changes ?? 0;
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const ops = await this.getQueue(registry);

        ops.push(op);

        await this.db.run(`INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`, registry, JSON.stringify(ops));

        return ops.length;
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        try {
            const row = await this.db.get<QueueRow>('SELECT * FROM queue WHERE id = ?', registry);

            if (!row) {
                return [];
            }

            return JSON.parse(row.ops) as Operation[];
        }
        catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        try {
            const oldQueue = await this.getQueue(registry);
            const newQueue = oldQueue.filter(item => !batch.some(op => op.signature?.value === item.signature?.value));

            await this.db.run(`INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`, registry, JSON.stringify(newQueue));
            return true;
        }
        catch (error) {
            console.error(error);
            return false;
        }
    }

    async getAllKeys(): Promise<string[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const rows = await this.db.all('SELECT id FROM dids');
        return rows.map(row => row.id);
    }

    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        try {
            // Insert or replace the block information
            await this.db.run(
                `INSERT OR REPLACE INTO blocks (registry, hash, height, time) VALUES (?, ?, ?, ?)`,
                registry,
                blockInfo.hash,
                blockInfo.height,
                blockInfo.time,
            );

            return true;
        } catch (error) {
            return false;
        }
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        try {
            let blockRow: BlockInfo | undefined;

            if (blockId === undefined) {
                // Return block with max height
                blockRow = await this.db.get<BlockInfo>(
                    `SELECT * FROM blocks WHERE registry = ? ORDER BY height DESC LIMIT 1`,
                    registry
                );
            } else if (typeof blockId === 'number') {
                blockRow = await this.db.get<BlockInfo>(
                    `SELECT * FROM blocks WHERE registry = ? AND height = ?`,
                    registry,
                    blockId
                );
            } else {
                blockRow = await this.db.get<BlockInfo>(
                    `SELECT * FROM blocks WHERE registry = ? AND hash = ?`,
                    registry,
                    blockId
                );
            }

            return blockRow ?? null;
        } catch (error) {
            return null;
        }
    }
}
