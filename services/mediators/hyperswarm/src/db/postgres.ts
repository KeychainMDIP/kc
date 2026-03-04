import { Pool, PoolClient } from 'pg';
import { Operation } from '@mdip/gatekeeper/types';
import { childLogger } from '@mdip/common/logger';
import { OperationSyncStore, SyncOperationRecord, SyncStoreListOptions } from './types.js';

interface SyncRow {
    id: string;
    ts: number | string;
    operation_json: Operation | string;
    inserted_at: number | string;
}

interface CountRow {
    count: number | string;
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
                ts BIGINT NOT NULL,
                operation_json JSONB NOT NULL,
                inserted_at BIGINT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_hypr_sync_operations_ts_id
                ON hyperswarm_sync_operations (ts ASC, id ASC);
        `);
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
                await client.query('DELETE FROM hyperswarm_sync_operations');
            });
        });
    }

    async upsertMany(records: Array<Omit<SyncOperationRecord, 'insertedAt'> | SyncOperationRecord>): Promise<number> {
        this.getPool();

        if (!Array.isArray(records) || records.length === 0) {
            return 0;
        }

        return this.runExclusive(async () => {
            try {
                return await this.withTx(async (client) => {
                    let inserted = 0;
                    const now = Date.now();

                    for (const record of records) {
                        const insertedAt = 'insertedAt' in record ? record.insertedAt : now;
                        const response = await client.query(
                            `INSERT INTO hyperswarm_sync_operations(id, ts, operation_json, inserted_at)
                             VALUES($1, $2, $3::jsonb, $4)
                             ON CONFLICT(id) DO NOTHING`,
                            [record.id, record.ts, JSON.stringify(record.operation), insertedAt]
                        );

                        inserted += response.rowCount ?? 0;
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
        if (!Array.isArray(ids) || ids.length === 0) {
            return [];
        }

        const result = await this.getPool().query<SyncRow>(
            `SELECT id, ts, operation_json, inserted_at
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
            predicates.push(`(ts > $${afterTsParam} OR (ts = $${afterTsParam} AND id > $${afterIdParam}))`);
        }

        if (typeof fromTs === 'number') {
            const fromTsParam = params.push(fromTs);
            predicates.push(`ts >= $${fromTsParam}`);
        }

        if (typeof toTs === 'number') {
            const toTsParam = params.push(toTs);
            predicates.push(`ts <= $${toTsParam}`);
        }

        const where = predicates.length > 0
            ? `WHERE ${predicates.join(' AND ')}`
            : '';

        const limitParam = params.push(limit);

        const result = await this.getPool().query<SyncRow>(
            `SELECT id, ts, operation_json, inserted_at
             FROM hyperswarm_sync_operations
             ${where}
             ORDER BY ts ASC, id ASC
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

    private mapRow(row: SyncRow): SyncOperationRecord {
        const operation = typeof row.operation_json === 'string'
            ? JSON.parse(row.operation_json) as Operation
            : row.operation_json;

        return {
            id: row.id,
            ts: this.toNumber(row.ts),
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
}
