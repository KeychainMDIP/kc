import fs from 'fs/promises';
import path from 'path';
import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import { childLogger } from '@mdip/common/logger';
import {
    ApplySyncStorePageResult,
    OperationSyncStore,
    SyncOperationRecord,
    SyncOperationWriteRecord,
    SyncStoreListOptions,
    SyncStoreOrderedListOptions,
    SyncStorePage,
    SyncStoreWriteResult,
} from './types.js';

interface SyncRow {
    id: string;
    sync_order: number | null;
    signed_ts: number;
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
                sync_order INTEGER,
                signed_ts INTEGER NOT NULL,
                operation_json TEXT NOT NULL,
                inserted_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        await this.ensureOperationsColumns();
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
                await this.db!.run('DELETE FROM sync_state');
            });
        });
    }

    async upsertMany(records: SyncOperationWriteRecord[]): Promise<SyncStoreWriteResult> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        if (!Array.isArray(records) || records.length === 0) {
            return { inserted: 0, updated: 0 };
        }

        return this.runExclusive(async () => {
            try {
                return await this.withTx(() => this.insertRecordsInTx(records));
            } catch (error) {
                log.error({ error }, 'upsertMany failed');
                throw error;
            }
        });
    }

    async applySyncPage(page: SyncStorePage): Promise<ApplySyncStorePageResult> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        return this.runExclusive(async () => {
            try {
                return await this.withTx(async () => {
                    const result = await this.insertRecordsInTx(page.records);
                    for (const [key, value] of Object.entries(page.syncStateUpdates ?? {})) {
                        await this.saveSyncStateInTx(key, value);
                    }
                    return result;
                });
            } catch (error) {
                log.error({ error }, 'applySyncPage failed');
                throw error;
            }
        });
    }

    async loadSyncState(key: string): Promise<string | null> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const row = await this.db.get<{ value: string }>(
            'SELECT value FROM sync_state WHERE key = ?',
            key
        );
        return row?.value ?? null;
    }

    async saveSyncState(key: string, value: string | null): Promise<void> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        await this.runExclusive(async () => {
            await this.withTx(() => this.saveSyncStateInTx(key, value));
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
            `SELECT id, sync_order, signed_ts, operation_json, inserted_at FROM operations WHERE id IN (${placeholders})`,
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
            predicates.push('(signed_ts > ? OR (signed_ts = ? AND id > ?))');
            params.push(after.ts, after.ts, after.id);
        }

        if (typeof fromTs === 'number') {
            predicates.push('signed_ts >= ?');
            params.push(fromTs);
        }

        if (typeof toTs === 'number') {
            predicates.push('signed_ts <= ?');
            params.push(toTs);
        }

        const where = predicates.length > 0
            ? `WHERE ${predicates.join(' AND ')}`
            : '';

        params.push(limit);

        const rows = await this.db.all<SyncRow[]>(
            `SELECT id, sync_order, signed_ts, operation_json, inserted_at
             FROM operations
             ${where}
             ORDER BY signed_ts ASC, id ASC
             LIMIT ?`,
            ...params
        );

        return rows.map(row => this.mapRow(row));
    }

    async iterateOrdered(options: SyncStoreOrderedListOptions = {}): Promise<SyncOperationRecord[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const limit = options.limit ?? 1000;
        const after = options.after;
        const params: Array<number | string> = [];
        const predicates = ['sync_order IS NOT NULL'];

        if (after) {
            predicates.push('(sync_order > ? OR (sync_order = ? AND id > ?))');
            params.push(after.syncOrder, after.syncOrder, after.id);
        }

        params.push(limit);

        const rows = await this.db.all<SyncRow[]>(
            `SELECT id, sync_order, signed_ts, operation_json, inserted_at
             FROM operations
             WHERE ${predicates.join(' AND ')}
             ORDER BY sync_order ASC, id ASC
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

    async countOrdered(): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const row = await this.db.get<{ count: number }>(
            'SELECT COUNT(*) AS count FROM operations WHERE sync_order IS NOT NULL'
        );
        return row?.count ?? 0;
    }

    private mapRow(row: SyncRow): SyncOperationRecord {
        return {
            id: row.id,
            syncOrder: row.sync_order ?? undefined,
            signedTs: row.signed_ts,
            ts: row.signed_ts,
            operation: JSON.parse(row.operation_json),
            insertedAt: row.inserted_at,
        };
    }

    private async insertRecordsInTx(
        records: SyncOperationWriteRecord[]
    ): Promise<SyncStoreWriteResult> {
        let inserted = 0;
        let updated = 0;
        const now = Date.now();

        for (const record of records) {
            const insertedAt = record.insertedAt ?? now;
            const signedTs = this.getSignedTs(record);
            const syncOrder = this.getSyncOrder(record);
            const existing = await this.db!.get<{ sync_order: number | null }>(
                'SELECT sync_order FROM operations WHERE id = ?',
                record.id
            );

            if (existing) {
                if (existing.sync_order === null && syncOrder !== undefined) {
                    const res = await this.db!.run(
                        'UPDATE operations SET sync_order = ? WHERE id = ? AND sync_order IS NULL',
                        syncOrder,
                        record.id
                    );
                    updated += res.changes ?? 0;
                }
                continue;
            }

            const res = await this.db!.run(
                `INSERT INTO operations(id, sync_order, signed_ts, operation_json, inserted_at)
                 VALUES(?, ?, ?, ?, ?)`,
                record.id,
                syncOrder ?? null,
                signedTs,
                JSON.stringify(record.operation),
                insertedAt,
            );

            inserted += res.changes ?? 0;
        }

        return { inserted, updated };
    }

    private async saveSyncStateInTx(key: string, value: string | null): Promise<void> {
        if (value === null) {
            await this.db!.run('DELETE FROM sync_state WHERE key = ?', key);
            return;
        }

        await this.db!.run(
            `INSERT INTO sync_state(key, value) VALUES(?, ?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            key,
            value
        );
    }

    private async ensureOperationsColumns(): Promise<void> {
        await this.ensureColumn('sync_order', 'ALTER TABLE operations ADD COLUMN sync_order INTEGER');
        const hasSignedTs = await this.hasColumn('signed_ts');
        if (!hasSignedTs) {
            await this.db!.exec('ALTER TABLE operations ADD COLUMN signed_ts INTEGER');
        }

        if (await this.hasColumn('ts')) {
            await this.db!.run('UPDATE operations SET signed_ts = ts WHERE signed_ts IS NULL');
        }
        await this.db!.run('UPDATE operations SET signed_ts = 0 WHERE signed_ts IS NULL');
        await this.db!.exec(`
            CREATE INDEX IF NOT EXISTS idx_operations_signed_ts_id ON operations (signed_ts, id);
            CREATE INDEX IF NOT EXISTS idx_operations_sync_order_id ON operations (sync_order, id);
        `);
    }

    private async ensureColumn(columnName: string, addColumnSql: string): Promise<void> {
        if (!(await this.hasColumn(columnName))) {
            await this.db!.exec(addColumnSql);
        }
    }

    private async hasColumn(columnName: string): Promise<boolean> {
        const columns = await this.db!.all<{ name: string }[]>('PRAGMA table_info(operations)');
        return columns.some(column => column.name === columnName);
    }

    private getSignedTs(record: SyncOperationWriteRecord): number {
        const signedTs = record.signedTs ?? record.ts;

        if (typeof signedTs !== 'number' || !Number.isSafeInteger(signedTs)) {
            throw new Error('Sync operation record signedTs must be an integer');
        }

        return signedTs;
    }

    private getSyncOrder(record: SyncOperationWriteRecord): number | undefined {
        return Number.isSafeInteger(record.syncOrder) && record.syncOrder! >= 0
            ? record.syncOrder
            : undefined;
    }
}
