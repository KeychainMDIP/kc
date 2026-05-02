import { Pool, PoolClient } from 'pg';
import { InvalidDIDError } from '@mdip/common/errors';
import { GatekeeperDb, GatekeeperEvent, Operation, BlockId, BlockInfo } from '../types.js';

interface EventRow {
    event: GatekeeperEvent | string | null;
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

interface CountRow {
    count: number | string;
}

interface SeqRow {
    seq: number | string;
}

interface ValueRow {
    value: string | null;
}

const POSTGRES_NOT_STARTED_ERROR = 'Postgres DB not started. Call start() first.';
const SCHEMA_VERSION = '2';

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

    private parseObject<T>(value: unknown): T {
        if (value == null) {
            throw new Error('Expected object value');
        }

        if (typeof value === 'string') {
            return JSON.parse(value) as T;
        }

        return value as T;
    }

    private parseEvent(value: unknown): GatekeeperEvent {
        return this.parseObject<GatekeeperEvent>(value);
    }

    private toNumber(value: number | string): number {
        if (typeof value === 'number') {
            return value;
        }
        return parseInt(value, 10);
    }

    private async ensureSchema(client: PoolClient): Promise<void> {
        await client.query(`
            CREATE TABLE IF NOT EXISTS gatekeeper_meta (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (namespace, key)
            );

            CREATE TABLE IF NOT EXISTS gatekeeper_dids (
                namespace TEXT NOT NULL,
                id TEXT NOT NULL,
                events JSONB NOT NULL DEFAULT '[]'::jsonb,
                PRIMARY KEY (namespace, id)
            );

            CREATE TABLE IF NOT EXISTS gatekeeper_events (
                namespace TEXT NOT NULL,
                id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                event JSONB NOT NULL,
                PRIMARY KEY (namespace, id, seq)
            );

            CREATE INDEX IF NOT EXISTS idx_gatekeeper_events_ns_id_seq_desc
                ON gatekeeper_events (namespace, id, seq DESC);

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

    private async getSchemaVersion(client: PoolClient): Promise<string | null> {
        const result = await client.query<ValueRow>(
            `SELECT value
             FROM gatekeeper_meta
             WHERE namespace = $1 AND key = 'schema_version'
             LIMIT 1`,
            [this.dbName]
        );

        if (result.rowCount === 0) {
            return null;
        }

        return result.rows[0].value;
    }

    private async setSchemaVersion(client: PoolClient, version: string): Promise<void> {
        await client.query(
            `INSERT INTO gatekeeper_meta (namespace, key, value)
             VALUES ($1, 'schema_version', $2)
             ON CONFLICT (namespace, key)
             DO UPDATE SET value = EXCLUDED.value`,
            [this.dbName, version]
        );
    }

    private async legacyDidTableExists(client: PoolClient): Promise<boolean> {
        const result = await client.query<{ exists: string | null }>(
            `SELECT to_regclass('public.gatekeeper_dids') AS exists`
        );

        return !!result.rows[0]?.exists;
    }

    private async migrateLegacySchema(client: PoolClient): Promise<boolean> {
        if (!(await this.legacyDidTableExists(client))) {
            return false;
        }

        const legacyCount = await client.query<CountRow>(
            `SELECT COALESCE(SUM(jsonb_array_length(events)), 0) AS count
             FROM gatekeeper_dids
             WHERE namespace = $1`,
            [this.dbName]
        );
        const expectedRows = this.toNumber(legacyCount.rows[0].count);

        if (expectedRows === 0) {
            return false;
        }

        await client.query(
            `DELETE FROM gatekeeper_events
             WHERE namespace = $1`,
            [this.dbName]
        );

        await client.query(
            `INSERT INTO gatekeeper_events (namespace, id, seq, event)
             SELECT dids.namespace, dids.id, element.ordinality - 1, element.event
             FROM gatekeeper_dids AS dids
             CROSS JOIN LATERAL jsonb_array_elements(dids.events) WITH ORDINALITY AS element(event, ordinality)
             WHERE dids.namespace = $1`,
            [this.dbName]
        );

        const migratedCount = await client.query<CountRow>(
            `SELECT COUNT(*) AS count
             FROM gatekeeper_events
             WHERE namespace = $1`,
            [this.dbName]
        );
        const actualRows = this.toNumber(migratedCount.rows[0].count);

        if (actualRows !== expectedRows) {
            throw new Error(`Legacy migration count mismatch: expected ${expectedRows}, got ${actualRows}`);
        }

        await client.query(
            `DELETE FROM gatekeeper_dids
             WHERE namespace = $1`,
            [this.dbName]
        );

        return true;
    }

    private async insertEventRows(client: PoolClient, id: string, events: GatekeeperEvent[]): Promise<number> {
        if (events.length === 0) {
            return 0;
        }

        const values: string[] = [];
        const params: Array<string | number> = [];

        for (let i = 0; i < events.length; i += 1) {
            const base = params.length;
            values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`);
            params.push(this.dbName, id, i, JSON.stringify(events[i]));
        }

        const result = await client.query(
            `INSERT INTO gatekeeper_events (namespace, id, seq, event)
             VALUES ${values.join(', ')}`,
            params
        );

        return result.rowCount ?? 0;
    }

    async start(): Promise<void> {
        if (this.pool) {
            return;
        }

        this.pool = new Pool({ connectionString: this.url });
        await this.withTx(async client => {
            await this.ensureSchema(client);
            const version = await this.getSchemaVersion(client);
            if (version === SCHEMA_VERSION) {
                return;
            }

            await this.migrateLegacySchema(client);
            await this.setSchemaVersion(client, SCHEMA_VERSION);
        });
    }

    async stop(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    async resetDb(): Promise<void> {
        await this.withTx(async client => {
            await client.query('DELETE FROM gatekeeper_meta WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_events WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_dids WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_queue WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_blocks WHERE namespace = $1', [this.dbName]);
        });
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        const id = this.splitSuffix(did);

        return this.withTx(async client => {
            const nextSeq = await client.query<SeqRow>(
                `SELECT COALESCE(MAX(seq), -1) + 1 AS seq
                 FROM gatekeeper_events
                 WHERE namespace = $1 AND id = $2`,
                [this.dbName, id]
            );

            const result = await client.query(
                `INSERT INTO gatekeeper_events (namespace, id, seq, event)
                 VALUES ($1, $2, $3, $4::jsonb)`,
                [this.dbName, id, this.toNumber(nextSeq.rows[0].seq), JSON.stringify(event)]
            );

            return result.rowCount ?? 0;
        });
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<number> {
        const id = this.splitSuffix(did);

        return this.withTx(async client => {
            await client.query(
                `DELETE FROM gatekeeper_events
                 WHERE namespace = $1 AND id = $2`,
                [this.dbName, id]
            );

            return this.insertEventRows(client, id, events);
        });
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        const pool = this.getPool();

        try {
            const id = this.splitSuffix(did);
            const result = await pool.query<EventRow>(
                `SELECT event
                 FROM gatekeeper_events
                 WHERE namespace = $1 AND id = $2
                 ORDER BY seq ASC`,
                [this.dbName, id]
            );

            return result.rows.map(row => this.parseEvent(row.event));
        } catch {
            return [];
        }
    }

    async deleteEvents(did: string): Promise<number> {
        const id = this.splitSuffix(did);
        const pool = this.getPool();

        const result = await pool.query(
            `DELETE FROM gatekeeper_events
             WHERE namespace = $1 AND id = $2`,
            [this.dbName, id]
        );

        return result.rowCount ?? 0;
    }

    async getAllKeys(): Promise<string[]> {
        const pool = this.getPool();
        const result = await pool.query<{ id: string }>(
            `SELECT DISTINCT id
             FROM gatekeeper_events
             WHERE namespace = $1
             ORDER BY id ASC`,
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
        } catch {
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
