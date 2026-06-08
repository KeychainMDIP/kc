import { Pool, PoolClient } from 'pg';
import { InvalidDIDError } from '@mdip/common/errors';
import {
    GatekeeperDb,
    GatekeeperEvent,
    Operation,
    BlockId,
    BlockInfo,
    IndexExportSnapshotOptions,
    IndexExportResponse,
    IndexExportChangesOptions,
    SetEventsOptions,
} from '../types.js';
import {
    buildIndexChangesResponse,
    buildIndexSnapshotResponseFromPageKeys,
    normalizeIndexExportLimit,
    parseIndexExportCursor
} from './index-export.js';
import { withHealthCheckTimeout } from './health.js';

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

interface SeqRow {
    seq: number | string;
}

interface IndexChangeRow {
    seq: number | string;
    kind: string;
    did: string | null;
    registry: string | null;
    block: BlockInfo | string | null;
    event: GatekeeperEvent | string | null;
    removed: boolean;
}

const POSTGRES_NOT_STARTED_ERROR = 'Postgres DB not started. Call start() first.';

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

            CREATE TABLE IF NOT EXISTS gatekeeper_index_changes (
                namespace TEXT NOT NULL,
                seq BIGSERIAL PRIMARY KEY,
                kind TEXT NOT NULL,
                did TEXT,
                registry TEXT,
                block JSONB,
                event JSONB,
                removed BOOLEAN NOT NULL DEFAULT FALSE
            );

            CREATE INDEX IF NOT EXISTS idx_gatekeeper_index_changes_ns_seq
                ON gatekeeper_index_changes (namespace, seq ASC);
        `);
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

    private async recordIndexChange(
        client: PoolClient,
        change: {
            kind: 'did' | 'block';
            did?: string;
            registry?: string;
            block?: BlockInfo;
            event?: GatekeeperEvent;
            removed?: boolean;
        }
    ): Promise<void> {
        await client.query(
            `INSERT INTO gatekeeper_index_changes
                (namespace, kind, did, registry, block, removed, event)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)`,
            [
                this.dbName,
                change.kind,
                change.did ?? null,
                change.registry ?? null,
                change.block ? JSON.stringify(change.block) : null,
                change.removed ?? false,
                change.event ? JSON.stringify(change.event) : null,
            ]
        );
    }

    async start(): Promise<void> {
        if (this.pool) {
            return;
        }

        this.pool = new Pool({ connectionString: this.url });
        await this.withTx(async client => {
            await this.ensureSchema(client);
        });
    }

    async stop(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    async isReady(): Promise<boolean> {
        if (!this.pool) {
            return false;
        }

        try {
            await withHealthCheckTimeout(
                this.pool.query('SELECT 1'),
                'Postgres readiness check timed out'
            );
            return true;
        }
        catch {
            return false;
        }
    }

    async resetDb(): Promise<void> {
        await this.withTx(async client => {
            await client.query('DELETE FROM gatekeeper_events WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_queue WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_blocks WHERE namespace = $1', [this.dbName]);
            await client.query('DELETE FROM gatekeeper_index_changes WHERE namespace = $1', [this.dbName]);
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

            await this.recordIndexChange(client, {
                kind: 'did',
                did,
                event,
            });

            return result.rowCount ?? 0;
        });
    }

    async setEvents(did: string, events: GatekeeperEvent[], options?: SetEventsOptions): Promise<number> {
        const id = this.splitSuffix(did);

        return this.withTx(async client => {
            await client.query(
                `DELETE FROM gatekeeper_events
                 WHERE namespace = $1 AND id = $2`,
                [this.dbName, id]
            );

            const inserted = await this.insertEventRows(client, id, events);
            const operationEvents = options?.operationEvents ?? [];

            if (operationEvents.length === 0) {
                await this.recordIndexChange(client, {
                    kind: 'did',
                    did,
                });
            } else {
                for (const event of operationEvents) {
                    await this.recordIndexChange(client, {
                        kind: 'did',
                        did,
                        event,
                    });
                }
            }

            return inserted;
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

        return this.withTx(async client => {
            const result = await client.query(
                `DELETE FROM gatekeeper_events
                 WHERE namespace = $1 AND id = $2`,
                [this.dbName, id]
            );

            if ((result.rowCount ?? 0) > 0) {
                await this.recordIndexChange(client, {
                    kind: 'did',
                    did,
                    removed: true,
                });
            }

            return result.rowCount ?? 0;
        });
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

    private async getIndexCheckpointCursor(): Promise<string> {
        const pool = this.getPool();
        const result = await pool.query<SeqRow>(
            `SELECT COALESCE(MAX(seq), 0) AS seq
             FROM gatekeeper_index_changes
             WHERE namespace = $1`,
            [this.dbName]
        );

        return this.toNumber(result.rows[0].seq).toString();
    }

    async exportIndexSnapshot(_options?: IndexExportSnapshotOptions): Promise<IndexExportResponse> {
        const pool = this.getPool();
        const options = _options ?? {};
        const limit = normalizeIndexExportLimit(options.limit);
        const cursor = options.cursor ?? null;
        const checkpointCursor = options.checkpointCursor ?? await this.getIndexCheckpointCursor();
        const result = await pool.query<{ id: string }>(
            `SELECT DISTINCT id
             FROM gatekeeper_events
             WHERE namespace = $1
               AND ($2::text IS NULL OR id > $2)
             ORDER BY id ASC
             LIMIT $3`,
            [this.dbName, cursor, limit + 1]
        );

        return buildIndexSnapshotResponseFromPageKeys(
            result.rows.map(row => row.id),
            id => this.getEvents(id),
            options,
            checkpointCursor
        );
    }

    async exportIndexChanges(_options?: IndexExportChangesOptions): Promise<IndexExportResponse> {
        const pool = this.getPool();
        const options = _options ?? {};
        const afterSeq = parseIndexExportCursor(options.cursor);
        const limit = normalizeIndexExportLimit(options.limit);
        const result = await pool.query<IndexChangeRow>(
            `SELECT seq, kind, did, registry, block, event, removed
             FROM gatekeeper_index_changes
             WHERE namespace = $1 AND seq > $2
             ORDER BY seq ASC
             LIMIT $3`,
            [this.dbName, afterSeq, limit + 1]
        );
        const page = result.rows.slice(0, limit).map(row => ({
            seq: this.toNumber(row.seq),
            kind: row.kind === 'block' ? 'block' as const : 'did' as const,
            did: row.did ?? undefined,
            registry: row.registry ?? undefined,
            block: typeof row.block === 'string'
                ? JSON.parse(row.block) as BlockInfo
                : row.block ?? undefined,
            event: row.event
                ? this.parseEvent(row.event)
                : undefined,
            removed: row.removed,
        }));

        return buildIndexChangesResponse(
            page,
            result.rows.length > limit,
            options,
            did => this.getEvents(did)
        );
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
        try {
            await this.withTx(async client => {
                await client.query(
                    `INSERT INTO gatekeeper_blocks (namespace, registry, hash, height, time, txns)
                     VALUES ($1, $2, $3, $4, $5, 0)
                     ON CONFLICT (namespace, registry, hash)
                     DO UPDATE SET
                        height = EXCLUDED.height,
                        time = EXCLUDED.time,
                        txns = EXCLUDED.txns`,
                    [this.dbName, registry, blockInfo.hash, blockInfo.height, blockInfo.time]
                );
                await this.recordIndexChange(client, {
                    kind: 'block',
                    registry,
                    block: blockInfo,
                });
            });

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
