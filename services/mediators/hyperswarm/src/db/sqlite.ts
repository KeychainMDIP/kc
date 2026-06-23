import fs from 'fs/promises';
import path from 'path';
import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import { childLogger } from '@mdip/common/logger';
import { OperationSyncStore, SyncOperationRecord, SyncStoreListOptions } from './types.js';

interface SyncRow {
    id: string;
    ts: number;
    operation_json: string;
    inserted_at: number;
}

const SQLITE_NOT_STARTED_ERROR = 'Sync SQLite DB not open. Call start() first.';
const log = childLogger({ service: 'hyperswarm-sync-db', module: 'sqlite' });

export default class SqliteOperationSyncStore implements OperationSyncStore {
    private readonly dbName: string;
    private readonly dataFolder: string;
    private db: sqlite.Database | null;
    private _lock: Promise<void> = Promise.resolve();

    constructor(dbName: string = 'operations.db', dataFolder: string = 'data/hyperswarm') {
        this.dbName = dbName;
        this.dataFolder = dataFolder;
        this.db = null;
    }

    private get dbPath(): string {
        return path.join(this.dataFolder, this.dbName);
    }

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
        } catch (error) {
            try {
                await this.db.exec('ROLLBACK');
            } catch {}
            throw error;
        }
    }

    async start(): Promise<void> {
        if (this.db) {
            return;
        }

        await fs.mkdir(this.dataFolder, { recursive: true });

        this.db = await sqlite.open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS operations (
                id TEXT PRIMARY KEY,
                ts INTEGER NOT NULL,
                operation_json TEXT NOT NULL,
                inserted_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_operations_ts_id ON operations (ts, id);
        `);
    }

    async stop(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }

    async reset(): Promise<void> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        await this.runExclusive(async () => {
            await this.withTx(async () => {
                await this.db!.run('DELETE FROM operations');
            });
        });
    }

    async upsertMany(records: Array<Omit<SyncOperationRecord, 'insertedAt'> | SyncOperationRecord>): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        if (!Array.isArray(records) || records.length === 0) {
            return 0;
        }

        return this.runExclusive(async () => {
            try {
                return await this.withTx(async () => {
                    let inserted = 0;
                    const now = Date.now();

                    for (const record of records) {
                        const insertedAt = 'insertedAt' in record ? record.insertedAt : now;
                        const res = await this.db!.run(
                            `INSERT OR IGNORE INTO operations(id, ts, operation_json, inserted_at) VALUES(?, ?, ?, ?)`,
                            record.id,
                            record.ts,
                            JSON.stringify(record.operation),
                            insertedAt,
                        );

                        inserted += res.changes ?? 0;
                    }

                    return inserted;
                });
            } catch (error) {
                log.error({ error }, 'upsertMany failed');
                throw error;
            }
        });
    }

    async getByIds(ids: string[]): Promise<SyncOperationRecord[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        if (!Array.isArray(ids) || ids.length === 0) {
            return [];
        }

        const placeholders = ids.map(() => '?').join(', ');
        const rows = await this.db.all<SyncRow[]>(
            `SELECT id, ts, operation_json, inserted_at FROM operations WHERE id IN (${placeholders})`,
            ...ids
        );

        const byId = new Map(rows.map(row => [row.id, this.mapRow(row)]));
        return ids
            .map(id => byId.get(id))
            .filter((item): item is SyncOperationRecord => !!item);
    }

    async iterateSorted(options: SyncStoreListOptions = {}): Promise<SyncOperationRecord[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const limit = options.limit ?? 1000;
        const after = options.after;
        const fromTs = options.fromTs;
        const toTs = options.toTs;
        const params: Array<number | string> = [];
        const predicates: string[] = [];

        if (after) {
            predicates.push('(ts > ? OR (ts = ? AND id > ?))');
            params.push(after.ts, after.ts, after.id);
        }

        if (typeof fromTs === 'number') {
            predicates.push('ts >= ?');
            params.push(fromTs);
        }

        if (typeof toTs === 'number') {
            predicates.push('ts <= ?');
            params.push(toTs);
        }

        const where = predicates.length > 0
            ? `WHERE ${predicates.join(' AND ')}`
            : '';

        params.push(limit);

        const rows = await this.db.all<SyncRow[]>(
            `SELECT id, ts, operation_json, inserted_at
             FROM operations
             ${where}
             ORDER BY ts ASC, id ASC
             LIMIT ?`,
            ...params
        );

        return rows.map(row => this.mapRow(row));
    }

    async has(id: string): Promise<boolean> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const row = await this.db.get<{ id: string }>('SELECT id FROM operations WHERE id = ? LIMIT 1', id);
        return !!row;
    }

    async count(): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const row = await this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM operations');
        return row?.count ?? 0;
    }

    private mapRow(row: SyncRow): SyncOperationRecord {
        return {
            id: row.id,
            ts: row.ts,
            operation: JSON.parse(row.operation_json),
            insertedAt: row.inserted_at,
        };
    }
}
