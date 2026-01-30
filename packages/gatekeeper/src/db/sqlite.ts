import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import { InvalidDIDError } from '@mdip/common/errors';
import { childLogger } from '@mdip/common/logger';
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
const log = childLogger({ service: 'gatekeeper-db', module: 'sqlite' });

export default class DbSqlite implements GatekeeperDb {
    private readonly dbName: string;
    private db: sqlite.Database | null;

    constructor(name: string, dataFolder: string = 'data') {
        this.dbName = `${dataFolder}/${name}.db`;
        this.db = null
    }

    private _lock: Promise<void> = Promise.resolve();
    private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
        const run = async () => await fn();
        const chained = this._lock.then(run, run);
        this._lock = chained.then(() => undefined, () => undefined);
        return chained;
    }

    private async withTx<T>(fn: () => Promise<T>): Promise<T> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }
        await this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = await fn();
            await this.db.exec('COMMIT');
            return result;
        } catch (e) {
            try {
                await this.db.exec('ROLLBACK');
            } catch {}
            throw e;
        }
    }

    private splitSuffix(did: string): string {
        if (!did) {
            throw new InvalidDIDError();
        }
        const suffix = did.split(':').pop();
        if (!suffix) {
            throw new InvalidDIDError();
        }
        return suffix;
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
        await this.runExclusive(async () => {
            await this.withTx(async () => {
                await this.db!.run('DELETE FROM dids');
                await this.db!.run('DELETE FROM queue');
                await this.db!.run('DELETE FROM blocks');
            });
        });
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        if (!did) {
            throw new InvalidDIDError();
        }

        return this.runExclusive(() =>
            this.withTx(async () => {
                const id = this.splitSuffix(did);
                const events = await this.getEventsStrict(id);
                events.push(event);
                return this.setEventsStrict(id, events);
            })
        );
    }

    private async setEventsStrict(id: string, events: GatekeeperEvent[]): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }
        const res = await this.db.run(
            `INSERT OR REPLACE INTO dids(id, events) VALUES(?, ?)`,
            id,
            JSON.stringify(events)
        );
        return res.changes ?? 0;
    }


    async setEvents(did: string, events: GatekeeperEvent[]): Promise<number> {
        const id = this.splitSuffix(did);
        return this.runExclusive(() =>
            this.withTx(() => this.setEventsStrict(id, events))
        );
    }

    private async getEventsStrict(id: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }
        const row = await this.db!.get<DidsRow>('SELECT events FROM dids WHERE id = ?', id);
        if (!row) {
            return [];
        }
        const events = JSON.parse(row.events);
        if (!Array.isArray(events)) {
            throw new Error('events is not an array');
        }
        return events as GatekeeperEvent[];
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        try {
            const id = this.splitSuffix(did);
            return await this.getEventsStrict(id);
        } catch {
            return [];
        }
    }

    async deleteEvents(did: string): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        return this.runExclusive(() =>
            this.withTx(async () => {
                const id = this.splitSuffix(did);
                const result = await this.db!.run('DELETE FROM dids WHERE id = ?', id);
                return result.changes ?? 0;
            })
        );
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        return this.runExclusive(async () =>
            this.withTx(async () => {
                const ops = await this.getQueueStrict(registry);
                ops.push(op);
                await this.db!.run(
                    `INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`,
                    registry,
                    JSON.stringify(ops)
                );
                return ops.length;
            })
        );
    }

    private async getQueueStrict(registry: string): Promise<Operation[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const row = await this.db.get<QueueRow>('SELECT ops FROM queue WHERE id = ?', registry);
        if (!row) {
            return [];
        }

        const ops = JSON.parse(row.ops);
        if (!Array.isArray(ops)) {
            throw new Error('queue row malformed: ops is not an array');
        }

        return ops as Operation[];
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        try {
            return await this.getQueueStrict(registry);
        } catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        return this.runExclusive(async () =>
            this.withTx(async () => {
                const oldQueue = await this.getQueueStrict(registry);

                const batchHashes = new Set(
                    batch.map(b => b.signature?.hash).filter((h): h is string => h !== undefined)
                );
                const newQueue = oldQueue.filter(
                    item => !batchHashes.has(item.signature?.hash || '')
                );
                await this.db!.run(
                    `INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`,
                    registry,
                    JSON.stringify(newQueue)
                );
                return true;
            }).catch(err => {
                log.error({ error: err }, 'SQLite clearQueue error');
                return false;
            })
        );
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
            await this.runExclusive(async () =>
                await this.db!.run(
                    `INSERT OR REPLACE INTO blocks (registry, hash, height, time, txns) VALUES (?, ?, ?, ?, ?)`,
                    registry,
                    blockInfo.hash,
                    blockInfo.height,
                    blockInfo.time,
                    0
                )
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
