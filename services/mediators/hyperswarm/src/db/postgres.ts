import { Pool, PoolClient } from 'pg';
import { Operation } from '@mdip/gatekeeper/types';
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
    sync_order: number | string | null;
    signed_ts: number | string;
    operation_json: Operation | string;
    inserted_at: number | string;
}

interface CountRow {
    count: number | string;
}

interface UpsertRow {
    inserted: boolean;
}

const POSTGRES_NOT_STARTED_ERROR = 'Sync Postgres DB not open. Call start() first.';
const log = childLogger({ service: 'hyperswarm-sync-db', module: 'postgres' });

export default class PostgresOperationSyncStore implements OperationSyncStore {
    private readonly url: string;
    private pool: Pool | null;
    private _lock: Promise<void> = Promise.resolve();

    constructor(
        url: string = process.env.KC_HYPR_POSTGRES_URL
            || process.env.KC_POSTGRES_URL
            || 'postgresql://mdip:mdip@localhost:5432/mdip'
    ) {
        this.url = url;
        this.pool = null;
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error(POSTGRES_NOT_STARTED_ERROR);
        }

        return this.pool;
    }

    private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
        const run = async () => await fn();
        const chained = this._lock.then(run, run);
        this._lock = chained.then(() => undefined, () => undefined);
        return chained;
    }

    private async withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.getPool().connect();

        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {}
            throw error;
        } finally {
            client.release();
        }
    }

    async start(): Promise<void> {
        if (this.pool) {
            return;
        }

        this.pool = new Pool({ connectionString: this.url });

        const pool = this.getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hyperswarm_sync_operations (
                id TEXT COLLATE "C" PRIMARY KEY,
                sync_order BIGINT,
                signed_ts BIGINT NOT NULL,
                operation_json JSONB NOT NULL,
                inserted_at BIGINT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_hypr_sync_operations_signed_ts_id
                ON hyperswarm_sync_operations (signed_ts ASC, id ASC);

            CREATE INDEX IF NOT EXISTS idx_hypr_sync_operations_sync_order_id
                ON hyperswarm_sync_operations (sync_order ASC, id ASC);

            CREATE TABLE IF NOT EXISTS hyperswarm_sync_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        await this.ensureOperationsColumns();
    }

    async stop(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    async reset(): Promise<void> {
        this.getPool();

        await this.runExclusive(async () => {
            await this.withTx(async (client) => {
                await client.query('TRUNCATE TABLE hyperswarm_sync_operations');
                await client.query('TRUNCATE TABLE hyperswarm_sync_state');
            });
        });
    }

    async upsertMany(records: SyncOperationWriteRecord[]): Promise<SyncStoreWriteResult> {
        this.getPool();

        if (!Array.isArray(records) || records.length === 0) {
            return { inserted: 0, updated: 0 };
        }

        return this.runExclusive(async () => {
            try {
                return await this.withTx(client => this.insertRecordsInTx(client, records));
            } catch (error) {
                log.error({ error }, 'upsertMany failed');
                throw error;
            }
        });
    }

    async applySyncPage(page: SyncStorePage): Promise<ApplySyncStorePageResult> {
        this.getPool();

        return this.runExclusive(async () => {
            try {
                return await this.withTx(async (client) => {
                    const result = await this.insertRecordsInTx(client, page.records);
                    for (const [key, value] of Object.entries(page.syncStateUpdates ?? {})) {
                        await this.saveSyncStateInTx(client, key, value);
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
        const result = await this.getPool().query<{ value: string }>(
            `SELECT value
             FROM hyperswarm_sync_state
             WHERE key = $1
             LIMIT 1`,
            [key]
        );

        return result.rows[0]?.value ?? null;
    }

    async saveSyncState(key: string, value: string | null): Promise<void> {
        this.getPool();

        await this.runExclusive(async () => {
            await this.withTx(client => this.saveSyncStateInTx(client, key, value));
        });
    }

    async getByIds(ids: string[]): Promise<SyncOperationRecord[]> {
        if (!Array.isArray(ids) || ids.length === 0) {
            return [];
        }

        const result = await this.getPool().query<SyncRow>(
            `SELECT id, sync_order, signed_ts, operation_json, inserted_at
             FROM hyperswarm_sync_operations
             WHERE id = ANY($1::text[])`,
            [ids]
        );

        const byId = new Map(result.rows.map(row => [row.id, this.mapRow(row)]));
        return ids
            .map(id => byId.get(id))
            .filter((item): item is SyncOperationRecord => !!item);
    }

    async iterateSorted(options: SyncStoreListOptions = {}): Promise<SyncOperationRecord[]> {
        const limit = options.limit ?? 1000;
        const after = options.after;
        const fromTs = options.fromTs;
        const toTs = options.toTs;

        const params: Array<number | string> = [];
        const predicates: string[] = [];

        if (after) {
            const afterTsParam = params.push(after.ts);
            const afterIdParam = params.push(after.id);
            predicates.push(
                `(signed_ts > $${afterTsParam} OR (signed_ts = $${afterTsParam} AND id > $${afterIdParam}))`
            );
        }

        if (typeof fromTs === 'number') {
            const fromTsParam = params.push(fromTs);
            predicates.push(`signed_ts >= $${fromTsParam}`);
        }

        if (typeof toTs === 'number') {
            const toTsParam = params.push(toTs);
            predicates.push(`signed_ts <= $${toTsParam}`);
        }

        const where = predicates.length > 0
            ? `WHERE ${predicates.join(' AND ')}`
            : '';

        const limitParam = params.push(limit);

        const result = await this.getPool().query<SyncRow>(
            `SELECT id, sync_order, signed_ts, operation_json, inserted_at
             FROM hyperswarm_sync_operations
             ${where}
             ORDER BY signed_ts ASC, id ASC
             LIMIT $${limitParam}`,
            params
        );

        return result.rows.map(row => this.mapRow(row));
    }

    async iterateOrdered(options: SyncStoreOrderedListOptions = {}): Promise<SyncOperationRecord[]> {
        const limit = options.limit ?? 1000;
        const after = options.after;

        const params: Array<number | string> = [];
        const predicates = ['sync_order IS NOT NULL'];

        if (after) {
            const afterSyncOrderParam = params.push(after.syncOrder);
            const afterIdParam = params.push(after.id);
            predicates.push(
                `(sync_order > $${afterSyncOrderParam} OR (sync_order = $${afterSyncOrderParam} AND id > $${afterIdParam}))`
            );
        }

        const limitParam = params.push(limit);

        const result = await this.getPool().query<SyncRow>(
            `SELECT id, sync_order, signed_ts, operation_json, inserted_at
             FROM hyperswarm_sync_operations
             WHERE ${predicates.join(' AND ')}
             ORDER BY sync_order ASC, id ASC
             LIMIT $${limitParam}`,
            params
        );

        return result.rows.map(row => this.mapRow(row));
    }

    async has(id: string): Promise<boolean> {
        const result = await this.getPool().query<{ id: string }>(
            `SELECT id
             FROM hyperswarm_sync_operations
             WHERE id = $1
             LIMIT 1`,
            [id]
        );

        return result.rowCount !== 0;
    }

    async count(): Promise<number> {
        const result = await this.getPool().query<CountRow>(
            'SELECT COUNT(*) AS count FROM hyperswarm_sync_operations'
        );

        if (result.rowCount === 0) {
            return 0;
        }

        return this.toNumber(result.rows[0].count);
    }

    async countOrdered(): Promise<number> {
        const result = await this.getPool().query<CountRow>(
            'SELECT COUNT(*) AS count FROM hyperswarm_sync_operations WHERE sync_order IS NOT NULL'
        );

        if (result.rowCount === 0) {
            return 0;
        }

        return this.toNumber(result.rows[0].count);
    }

    private mapRow(row: SyncRow): SyncOperationRecord {
        const operation = typeof row.operation_json === 'string'
            ? JSON.parse(row.operation_json) as Operation
            : row.operation_json;

        return {
            id: row.id,
            syncOrder: row.sync_order == null ? undefined : this.toNumber(row.sync_order),
            signedTs: this.toNumber(row.signed_ts),
            ts: this.toNumber(row.signed_ts),
            operation,
            insertedAt: this.toNumber(row.inserted_at),
        };
    }

    private toNumber(value: number | string): number {
        if (typeof value === 'number') {
            return value;
        }

        return Number.parseInt(value, 10);
    }

    private async insertRecordsInTx(
        client: PoolClient,
        records: SyncOperationWriteRecord[]
    ): Promise<SyncStoreWriteResult> {
        let inserted = 0;
        let updated = 0;
        const now = Date.now();

        for (const record of records) {
            const insertedAt = record.insertedAt ?? now;
            const signedTs = this.getSignedTs(record);
            const syncOrder = this.getSyncOrder(record);

            const response = await client.query<UpsertRow>(
                `INSERT INTO hyperswarm_sync_operations(id, sync_order, signed_ts, operation_json, inserted_at)
                 VALUES($1, $2, $3, $4::jsonb, $5)
                 ON CONFLICT(id) DO UPDATE
                 SET sync_order = EXCLUDED.sync_order
                 WHERE hyperswarm_sync_operations.sync_order IS NULL
                   AND EXCLUDED.sync_order IS NOT NULL
                 RETURNING (xmax = '0'::xid) AS inserted`,
                [
                    record.id,
                    syncOrder ?? null,
                    signedTs,
                    JSON.stringify(record.operation),
                    insertedAt,
                ]
            );

            if ((response.rowCount ?? 0) === 0) {
                continue;
            }

            if (response.rows[0]?.inserted) {
                inserted += 1;
            } else {
                updated += 1;
            }
        }

        return { inserted, updated };
    }

    private async saveSyncStateInTx(client: PoolClient, key: string, value: string | null): Promise<void> {
        if (value === null) {
            await client.query(
                `DELETE FROM hyperswarm_sync_state
                 WHERE key = $1`,
                [key]
            );
            return;
        }

        await client.query(
            `INSERT INTO hyperswarm_sync_state(key, value)
             VALUES($1, $2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            [key, value]
        );
    }

    private async ensureOperationsColumns(): Promise<void> {
        const pool = this.getPool();

        await pool.query(`
            ALTER TABLE hyperswarm_sync_operations
                ADD COLUMN IF NOT EXISTS sync_order BIGINT;

            ALTER TABLE hyperswarm_sync_operations
                ADD COLUMN IF NOT EXISTS signed_ts BIGINT;

            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'hyperswarm_sync_operations'
                      AND column_name = 'ts'
                ) THEN
                    UPDATE hyperswarm_sync_operations
                    SET signed_ts = ts
                    WHERE signed_ts IS NULL;
                END IF;
            END $$;

            UPDATE hyperswarm_sync_operations
            SET signed_ts = 0
            WHERE signed_ts IS NULL;

            ALTER TABLE hyperswarm_sync_operations
                ALTER COLUMN signed_ts SET NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_hypr_sync_operations_signed_ts_id
                ON hyperswarm_sync_operations (signed_ts ASC, id ASC);

            CREATE INDEX IF NOT EXISTS idx_hypr_sync_operations_sync_order_id
                ON hyperswarm_sync_operations (sync_order ASC, id ASC);
        `);
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
