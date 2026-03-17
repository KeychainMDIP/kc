import { Pool, PoolClient } from 'pg';
import { InvalidDIDError } from '@mdip/common/errors';
import { childLogger } from '@mdip/common/logger';
import { GatekeeperDb, GatekeeperEvent, Operation, BlockId, BlockInfo } from '../types.js';

interface EventsRow {
    events: GatekeeperEvent[] | string | null;
}

interface QueueRow {
    ops: Operation[] | string | null;
}

interface BlockRow {
    hash: string;
    height: number | string;
    time: number | string;
}

interface LengthRow {
    length: number | string;
}

const POSTGRES_NOT_STARTED_ERROR = 'Postgres DB not started. Call start() first.';
const log = childLogger({ service: 'gatekeeper-db', module: 'postgres' });

export default class DbPostgres implements GatekeeperDb {
    private readonly dbName: string;
    private readonly url: string;
    private pool: Pool | null;

    constructor(dbName: string) {
        this.dbName = dbName;
        this.url = process.env.KC_POSTGRES_URL || 'postgresql://mdip:mdip@localhost:5432/mdip';
        this.pool = null;
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error(POSTGRES_NOT_STARTED_ERROR);
        }
        return this.pool;
    }

    private async withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        const pool = this.getPool();
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Ignore rollback errors and rethrow original error.
            }
            throw error;
        } finally {
            client.release();
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

    private parseArray<T>(value: unknown): T[] {
        if (value == null) {
            return [];
        }

        if (typeof value === 'string') {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) {
                throw new Error('Expected JSON array');
            }
            return parsed as T[];
        }

        if (!Array.isArray(value)) {
            throw new Error('Expected array value');
        }

        return value as T[];
    }

    private toNumber(value: number | string): number {
        if (typeof value === 'number') {
            return value;
        }
        return parseInt(value, 10);
    }

    async start(): Promise<void> {
        if (this.pool) {
            return;
        }

        this.pool = new Pool({ connectionString: this.url });

        const pool = this.getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gatekeeper_dids (
                namespace TEXT NOT NULL,
                id TEXT NOT NULL,
                events JSONB NOT NULL DEFAULT '[]'::jsonb,
                PRIMARY KEY (namespace, id)
            );

            CREATE TABLE IF NOT EXISTS gatekeeper_queue (
                namespace TEXT NOT NULL,
                id TEXT NOT NULL,
                ops JSONB NOT NULL DEFAULT '[]'::jsonb,
                PRIMARY KEY (namespace, id)
            );

            CREATE TABLE IF NOT EXISTS gatekeeper_blocks (
                namespace TEXT NOT NULL,
                registry TEXT NOT NULL,
                hash TEXT NOT NULL,
                height INTEGER NOT NULL,
                time INTEGER NOT NULL,
                txns INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (namespace, registry, hash),
                UNIQUE (namespace, registry, height)
            );

            CREATE INDEX IF NOT EXISTS idx_gatekeeper_blocks_ns_registry_height
                ON gatekeeper_blocks (namespace, registry, height DESC);
        `);
    }

    async stop(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    async resetDb(): Promise<void> {
        await this.withTx(async client => {
            await client.query('DELETE FROM gatekeeper_dids WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_queue WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_blocks WHERE namespace = $1', [this.dbName]);
        });
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        const id = this.splitSuffix(did);
        const pool = this.getPool();

        const result = await pool.query(
            `INSERT INTO gatekeeper_dids (namespace, id, events)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (namespace, id)
             DO UPDATE SET events = COALESCE(gatekeeper_dids.events, '[]'::jsonb) || EXCLUDED.events`,
            [this.dbName, id, JSON.stringify([event])]
        );

        return result.rowCount ?? 0;
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<number> {
        const id = this.splitSuffix(did);
        const pool = this.getPool();

        const result = await pool.query(
            `INSERT INTO gatekeeper_dids (namespace, id, events)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (namespace, id)
             DO UPDATE SET events = EXCLUDED.events`,
            [this.dbName, id, JSON.stringify(events)]
        );

        return result.rowCount ?? 0;
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        const pool = this.getPool();

        try {
            const id = this.splitSuffix(did);
            const result = await pool.query<EventsRow>(
                `SELECT events
                 FROM gatekeeper_dids
                 WHERE namespace = $1 AND id = $2
                 LIMIT 1`,
                [this.dbName, id]
            );

            if (result.rowCount === 0) {
                return [];
            }

            return this.parseArray<GatekeeperEvent>(result.rows[0].events);
        } catch {
            return [];
        }
    }

    async deleteEvents(did: string): Promise<number> {
        const id = this.splitSuffix(did);
        const pool = this.getPool();

        const result = await pool.query(
            `DELETE FROM gatekeeper_dids
             WHERE namespace = $1 AND id = $2`,
            [this.dbName, id]
        );

        return result.rowCount ?? 0;
    }

    async getAllKeys(): Promise<string[]> {
        const pool = this.getPool();
        const result = await pool.query<{ id: string }>(
            `SELECT id
             FROM gatekeeper_dids
             WHERE namespace = $1`,
            [this.dbName]
        );

        return result.rows.map(row => row.id);
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        const pool = this.getPool();

        const result = await pool.query<LengthRow>(
            `INSERT INTO gatekeeper_queue (namespace, id, ops)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (namespace, id)
             DO UPDATE SET ops = COALESCE(gatekeeper_queue.ops, '[]'::jsonb) || EXCLUDED.ops
             RETURNING jsonb_array_length(ops) AS length`,
            [this.dbName, registry, JSON.stringify([op])]
        );

        if (result.rowCount === 0) {
            return 0;
        }

        return this.toNumber(result.rows[0].length);
    }

    async getQueue(registry: string): Promise<Operation[]> {
        const pool = this.getPool();

        try {
            const result = await pool.query<QueueRow>(
                `SELECT ops
                 FROM gatekeeper_queue
                 WHERE namespace = $1 AND id = $2
                 LIMIT 1`,
                [this.dbName, registry]
            );

            if (result.rowCount === 0) {
                return [];
            }

            return this.parseArray<Operation>(result.rows[0].ops);
        } catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        const hashes = new Set(
            batch.map(op => op.signature?.hash).filter((hash): hash is string => !!hash)
        );

        if (hashes.size === 0) {
            return true;
        }

        try {
            await this.withTx(async client => {
                const current = await client.query<QueueRow>(
                    `SELECT ops
                     FROM gatekeeper_queue
                     WHERE namespace = $1 AND id = $2
                     FOR UPDATE`,
                    [this.dbName, registry]
                );

                const oldQueue = current.rowCount === 0
                    ? []
                    : this.parseArray<Operation>(current.rows[0].ops);

                const newQueue = oldQueue.filter(op => !hashes.has(op.signature?.hash || ''));

                await client.query(
                    `INSERT INTO gatekeeper_queue (namespace, id, ops)
                     VALUES ($1, $2, $3::jsonb)
                     ON CONFLICT (namespace, id)
                     DO UPDATE SET ops = EXCLUDED.ops`,
                    [this.dbName, registry, JSON.stringify(newQueue)]
                );
            });

            return true;
        } catch (error) {
            log.error({ error }, 'Postgres clearQueue error');
            return false;
        }
    }

    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        const pool = this.getPool();

        try {
            await pool.query(
                `INSERT INTO gatekeeper_blocks (namespace, registry, hash, height, time, txns)
                 VALUES ($1, $2, $3, $4, $5, 0)
                 ON CONFLICT (namespace, registry, hash)
                 DO UPDATE SET
                    height = EXCLUDED.height,
                    time = EXCLUDED.time,
                    txns = EXCLUDED.txns`,
                [this.dbName, registry, blockInfo.hash, blockInfo.height, blockInfo.time]
            );

            return true;
        } catch {
            return false;
        }
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        const pool = this.getPool();

        try {
            let result;

            if (blockId === undefined) {
                result = await pool.query<BlockRow>(
                    `SELECT hash, height, time
                     FROM gatekeeper_blocks
                     WHERE namespace = $1 AND registry = $2
                     ORDER BY height DESC
                     LIMIT 1`,
                    [this.dbName, registry]
                );
            } else if (typeof blockId === 'number') {
                result = await pool.query<BlockRow>(
                    `SELECT hash, height, time
                     FROM gatekeeper_blocks
                     WHERE namespace = $1 AND registry = $2 AND height = $3
                     LIMIT 1`,
                    [this.dbName, registry, blockId]
                );
            } else {
                result = await pool.query<BlockRow>(
                    `SELECT hash, height, time
                     FROM gatekeeper_blocks
                     WHERE namespace = $1 AND registry = $2 AND hash = $3
                     LIMIT 1`,
                    [this.dbName, registry, blockId]
                );
            }

            if (result.rowCount === 0) {
                return null;
            }

            const row = result.rows[0];
            return {
                hash: row.hash,
                height: this.toNumber(row.height),
                time: this.toNumber(row.time),
            };
        } catch {
            return null;
        }
    }
}
