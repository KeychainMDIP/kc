import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { InvalidDIDError } from '@mdip/common/errors';
import { childLogger } from '@mdip/common/logger';
import {
    DIDLifecycle,
    DeleteEventsOptions,
    DueDIDCursor,
    ExpirationJob,
    LifecycleMetadata,
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
import { LIFECYCLE_VERSION, LIFECYCLE_PAGE_SIZE, isDIDLifecycle, isExpirationJob, isLifecycleMetadata, lifecycleLimit, projectLifecycle } from './lifecycle.js';
import { withHealthCheckTimeout } from './health.js';

const log = childLogger({ service: 'gatekeeper-db', module: 'postgres' });
const DEFAULT_POSTGRES_POOL_MAX = 10;
const DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS = 3_000;
const DEFAULT_POSTGRES_KEEP_ALIVE = true;
const DEFAULT_POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS = 10_000;
const DEFAULT_POSTGRES_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_POSTGRES_MAX_LIFETIME_SECONDS = 300;
const POSTGRES_HEALTH_QUERY_TIMEOUT_MS = 1_000;

function readIntegerEnv(name: string, fallback: number, allowZero = false): number {
    const configured = process.env[name];
    const value = Number(configured ?? fallback);
    if (configured?.trim() === '' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
        throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
    }
    return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
    const configured = process.env[name];
    if (configured === undefined) {
        return fallback;
    }
    const value = configured.trim().toLowerCase();
    if (value === 'true' || value === 'false') {
        return value === 'true';
    }
    throw new Error(`${name} must be true or false`);
}

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
    private mutationLock: Promise<void> = Promise.resolve();

    // A statement snapshot can predate a waiting upsert, so serialize this namespace's writer.
    private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.mutationLock.then(fn, fn);
        this.mutationLock = result.then(() => undefined, () => undefined);
        return result;
    }

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

            ALTER TABLE gatekeeper_index_changes ADD COLUMN IF NOT EXISTS lifecycle_version INTEGER;
            CREATE INDEX IF NOT EXISTS idx_gatekeeper_index_changes_lifecycle_missing
                ON gatekeeper_index_changes(namespace, seq)
                WHERE kind = 'did' AND lifecycle_version IS DISTINCT FROM 1;
            CREATE TABLE IF NOT EXISTS gatekeeper_lifecycle (
                namespace TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, record JSONB NOT NULL,
                expires_at BIGINT, controller TEXT, unresolved BOOLEAN NOT NULL DEFAULT FALSE,
                PRIMARY KEY(namespace, kind, id)
            );
            CREATE INDEX IF NOT EXISTS gatekeeper_lifecycle_due ON gatekeeper_lifecycle(namespace, kind, expires_at, id) WHERE expires_at IS NOT NULL;
            CREATE INDEX IF NOT EXISTS gatekeeper_lifecycle_controller ON gatekeeper_lifecycle(namespace, kind, controller, id) WHERE controller IS NOT NULL;
            CREATE INDEX IF NOT EXISTS gatekeeper_lifecycle_unresolved ON gatekeeper_lifecycle(namespace, kind, id) WHERE unresolved;
            CREATE TABLE IF NOT EXISTS gatekeeper_metadata (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (namespace, key)
            );
        `);
    }

    private async ensureIndexEpoch(client?: PoolClient): Promise<string> {
        const executor = client ?? this.getPool();
        const existing = await executor.query<{ value: string }>(
            `SELECT value
             FROM gatekeeper_metadata
             WHERE namespace = $1 AND key = 'indexEpoch'
             LIMIT 1`,
            [this.dbName]
        );
        if (existing.rows[0]?.value) {
            return existing.rows[0].value;
        }

        const epoch = randomUUID();
        await executor.query(
            `INSERT INTO gatekeeper_metadata (namespace, key, value)
             VALUES ($1, 'indexEpoch', $2)
             ON CONFLICT (namespace, key) DO NOTHING`,
            [this.dbName, epoch]
        );

        const saved = await executor.query<{ value: string }>(
            `SELECT value
             FROM gatekeeper_metadata
             WHERE namespace = $1 AND key = 'indexEpoch'
             LIMIT 1`,
            [this.dbName]
        );
        return saved.rows[0]?.value ?? epoch;
    }

    private async getIndexEpoch(): Promise<string> {
        return this.ensureIndexEpoch();
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
                (namespace, kind, did, registry, block, removed, event, lifecycle_version)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 1)`,
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

        const max = readIntegerEnv('KC_POSTGRES_POOL_MAX', DEFAULT_POSTGRES_POOL_MAX);
        const connectionTimeoutMillis = readIntegerEnv(
            'KC_POSTGRES_CONNECTION_TIMEOUT_MS',
            DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS
        );
        const keepAlive = readBooleanEnv('KC_POSTGRES_KEEP_ALIVE', DEFAULT_POSTGRES_KEEP_ALIVE);
        const keepAliveInitialDelayMillis = readIntegerEnv(
            'KC_POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS',
            DEFAULT_POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS
        );
        const idleTimeoutMillis = readIntegerEnv(
            'KC_POSTGRES_IDLE_TIMEOUT_MS',
            DEFAULT_POSTGRES_IDLE_TIMEOUT_MS,
            true
        );
        const maxLifetimeSeconds = readIntegerEnv(
            'KC_POSTGRES_MAX_LIFETIME_SECONDS',
            DEFAULT_POSTGRES_MAX_LIFETIME_SECONDS,
            true
        );
        this.pool = new Pool({
            connectionString: this.url,
            max,
            connectionTimeoutMillis,
            keepAlive,
            keepAliveInitialDelayMillis,
            idleTimeoutMillis,
            maxLifetimeSeconds,
        });
        try {
            await this.withTx(async client => {
                await this.ensureSchema(client);
                await this.ensureIndexEpoch(client);
            });
            await this.initializeLifecycleIndex();
        } catch (error) {
            try { await this.stop(); } catch { /* Preserve the startup failure. */ }
            throw error;
        }
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

        const healthQuery = {
            text: 'SELECT 1',
            query_timeout: POSTGRES_HEALTH_QUERY_TIMEOUT_MS,
        };
        const healthTimeoutMs = (this.pool.options.connectionTimeoutMillis
            ?? DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS)
            + POSTGRES_HEALTH_QUERY_TIMEOUT_MS;

        try {
            await withHealthCheckTimeout(
                this.pool.query(healthQuery),
                'Postgres readiness check timed out',
                healthTimeoutMs
            );
            return true;
        }
        catch (error) {
            log.warn({
                err: error,
                pool: {
                    max: this.pool.options.max,
                    connectionTimeoutMillis: this.pool.options.connectionTimeoutMillis,
                    keepAlive: this.pool.options.keepAlive,
                    keepAliveInitialDelayMillis: this.pool.options.keepAliveInitialDelayMillis,
                    idleTimeoutMillis: this.pool.options.idleTimeoutMillis,
                    maxLifetimeSeconds: this.pool.options.maxLifetimeSeconds,
                    total: this.pool.totalCount,
                    idle: this.pool.idleCount,
                    waiting: this.pool.waitingCount,
                },
            }, 'Postgres readiness check failed');
            return false;
        }
    }

    async resetDb(): Promise<void> {
        return this.runExclusive(async () => {
            await this.withTx(async client => {
                await client.query('DELETE FROM gatekeeper_lifecycle WHERE namespace = $1', [this.dbName]);
                await client.query("DELETE FROM gatekeeper_metadata WHERE namespace = $1 AND key = 'lifecycle'", [this.dbName]);
                await client.query('DELETE FROM gatekeeper_events WHERE namespace = $1', [this.dbName]);
                await client.query('DELETE FROM gatekeeper_queue WHERE namespace = $1', [this.dbName]);
                await client.query('DELETE FROM gatekeeper_blocks WHERE namespace = $1', [this.dbName]);
                await client.query('DELETE FROM gatekeeper_index_changes WHERE namespace = $1', [this.dbName]);
                await client.query(
                    `INSERT INTO gatekeeper_metadata (namespace, key, value)
                     VALUES ($1, 'indexEpoch', $2)
                     ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value`,
                    [this.dbName, randomUUID()]
                );
            });
        });
    }

    private async addEventStrict(
        executor: Pool | PoolClient,
        did: string,
        id: string,
        event: GatekeeperEvent
    ): Promise<number> {
        const serializedEvent = JSON.stringify(event);
        const lifecycle = projectLifecycle(did, [event]);
        // Reuse the plan for this large statement on each pooled connection.
        const result = await executor.query<LengthRow>({
            name: 'gatekeeper-append-event-v1',
            text: `WITH inserted_event AS (
                INSERT INTO gatekeeper_events (namespace, id, seq, event)
                SELECT $1, $2, COALESCE(MAX(seq), -1) + 1, $3::jsonb
                FROM gatekeeper_events
                WHERE namespace = $1 AND id = $2
                RETURNING seq
             ), inserted_change AS (
                INSERT INTO gatekeeper_index_changes
                    (namespace, kind, did, registry, block, removed, event, lifecycle_version)
                SELECT $1, 'did', $4, NULL, NULL, FALSE, $3::jsonb, 1
                FROM inserted_event
                RETURNING 1
             ), projected_lifecycle AS (
                SELECT CASE
                    WHEN $6 = 'create' AND inserted_event.seq > 0 THEN
                        jsonb_set(previous.record, '{revision}', to_jsonb($7::text))
                    WHEN $6 = 'delete' AND previous.record IS NOT NULL THEN
                        CASE WHEN previous.expires_at IS NOT NULL OR COALESCE((previous.record->>'unresolved')::boolean, false) THEN
                            (CASE WHEN COALESCE((previous.record->>'controllerUnknown')::boolean, false)
                                AND previous.record->>'type' IN ('agent', 'asset') AND previous.expires_at IS NOT NULL
                            THEN previous.record - 'controller' - 'controllerUnknown' - 'unresolved'
                            ELSE previous.record - 'controller' - 'controllerUnknown' END)
                            || jsonb_build_object('revision', $7::text, 'did', $4::text)
                        ELSE NULL END
                    WHEN $6 = 'delete' AND inserted_event.seq > 0 THEN NULL
                    ELSE $5::jsonb END AS record
                FROM inserted_event LEFT JOIN gatekeeper_lifecycle previous
                    ON previous.namespace = $1 AND previous.kind = 'did' AND previous.id = $2
             ), saved_lifecycle AS (
                INSERT INTO gatekeeper_lifecycle(namespace, kind, id, record, expires_at, controller, unresolved)
                SELECT $1, 'did', $2, projected.record, (projected.record->>'expiresAt')::bigint,
                    projected.record->>'controller', COALESCE((projected.record->>'controllerUnknown')::boolean, false)
                FROM inserted_change CROSS JOIN projected_lifecycle projected WHERE projected.record IS NOT NULL
                ON CONFLICT(namespace, kind, id) DO UPDATE SET record = excluded.record,
                    expires_at = excluded.expires_at, controller = excluded.controller, unresolved = excluded.unresolved
             ), cleared_lifecycle AS (
                DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'did' AND id = $2
                    AND EXISTS(SELECT 1 FROM projected_lifecycle WHERE record IS NULL)
             ), cancelled_job AS (
                DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'job' AND id = $2
                    AND EXISTS(SELECT 1 FROM inserted_change)
                    AND EXISTS(SELECT 1 FROM projected_lifecycle projected WHERE projected.record IS NULL
                        OR gatekeeper_lifecycle.record->>'expiresAt' IS DISTINCT FROM projected.record->>'expiresAt'
                        OR projected.record->>'type' IS DISTINCT FROM 'agent')
             )
             SELECT COUNT(*) AS length
             FROM inserted_change`,
            values: [this.dbName, id, serializedEvent, did, lifecycle ? JSON.stringify(lifecycle) : null,
                event.operation.type, randomUUID()]
        });

        return this.toNumber(result.rows[0]?.length ?? 0);
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        return this.addEventAndQueue(did, event, []);
    }

    async addEventAndQueue(did: string, event: GatekeeperEvent, queueRegistries: string[]): Promise<number> {
        return this.runExclusive(async () => {
            const id = this.splitSuffix(did);
            if (queueRegistries.length === 0) {
                return this.addEventStrict(this.getPool(), did, id, event);
            }

            return this.withTx(async client => {
                const count = await this.addEventStrict(client, did, id, event);
                for (const registry of queueRegistries) {
                    await client.query(
                        `INSERT INTO gatekeeper_queue (namespace, id, ops)
                         VALUES ($1, $2, $3::jsonb)
                         ON CONFLICT (namespace, id)
                         DO UPDATE SET ops = COALESCE(gatekeeper_queue.ops, '[]'::jsonb) || EXCLUDED.ops`,
                        [this.dbName, registry, JSON.stringify([event.operation])]
                    );
                }
                return count;
            });
        });
    }

    async setEvents(did: string, events: GatekeeperEvent[], options?: SetEventsOptions): Promise<number> {
        return this.runExclusive(async () => {
            const id = this.splitSuffix(did);

            return this.withTx(async client => {
                await client.query(
                    `DELETE FROM gatekeeper_events
                     WHERE namespace = $1 AND id = $2`,
                    [this.dbName, id]
                );

                const inserted = await this.insertEventRows(client, id, events);
                await this.writeLifecycle(client, did, events);
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
        });
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        const pool = this.getPool();
        const id = this.splitSuffix(did);
        const result = await pool.query<EventRow>(
            `SELECT event
             FROM gatekeeper_events
             WHERE namespace = $1 AND id = $2
             ORDER BY seq ASC`,
            [this.dbName, id]
        );

        return result.rows.map(row => this.parseEvent(row.event));
    }

    async deleteEvents(did: string, expected?: DeleteEventsOptions): Promise<number> {
        return this.runExclusive(async () => {
            const id = this.splitSuffix(did);

            return this.withTx(async client => {
                if (expected) {
                    const epoch = await this.ensureIndexEpoch(client);
                    const stored = (await client.query<{ value: string }>(
                        `SELECT value FROM gatekeeper_metadata WHERE namespace = $1 AND key = 'lifecycle'
                            AND EXISTS(SELECT 1 FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'metadata' AND id = 'version')`, [this.dbName])).rows[0];
                    const state: unknown = stored && JSON.parse(stored.value);
                    if (!isLifecycleMetadata(state) || !state.complete || state.version !== LIFECYCLE_VERSION || state.epoch !== epoch) {
                        throw new Error('Lifecycle index is not initialized');
                    }
                    const row = (await client.query<{ record: DIDLifecycle }>(
                        "SELECT record FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'did' AND id = $2 FOR UPDATE", [this.dbName, id])).rows[0];
                    if (epoch !== expected.epoch || (!row || this.parseLifecycle(row.record).revision !== expected.revision)) return 0;
                }
                await client.query("DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'did' AND id = $2", [this.dbName, id]);
                const result = await client.query<EventRow>(
                    `DELETE FROM gatekeeper_events
                     WHERE namespace = $1 AND id = $2
                     RETURNING event`,
                    [this.dbName, id]
                );

                for (const row of result.rows) {
                    await this.recordIndexChange(client, {
                        kind: 'did',
                        did,
                        event: this.parseEvent(row.event),
                        removed: true,
                    });
                }

                return result.rowCount ?? 0;
            });
        });
    }

    private async writeLifecycle(client: PoolClient, did: string, events: GatekeeperEvent[]): Promise<void> {
        const row = projectLifecycle(did, events);
        await client.query('DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = $2 AND id = $3',
            [this.dbName, 'did', this.splitSuffix(did)]);
        if (row) await this.insertLifecycleRows(client, [row]);
        if (events.length === 0) return;
        await client.query(`DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'job' AND id = $2
            AND ($3::jsonb IS NULL OR record->>'expiresAt' IS DISTINCT FROM $3::jsonb->>'expiresAt'
                OR $3::jsonb->>'type' IS DISTINCT FROM 'agent')`,
        [this.dbName, this.splitSuffix(did), row ? JSON.stringify(row) : null]);
    }

    private async insertLifecycleRows(client: PoolClient, rows: DIDLifecycle[]): Promise<void> {
        if (!rows.length) return;
        await client.query(`INSERT INTO gatekeeper_lifecycle(namespace, kind, id, record, expires_at, controller, unresolved)
            SELECT $1, 'did', value->>'suffix', value, (value->>'expiresAt')::bigint,
                value->>'controller', COALESCE((value->>'controllerUnknown')::boolean, false)
            FROM jsonb_array_elements($2::jsonb)
            ON CONFLICT(namespace, kind, id) DO UPDATE SET record = excluded.record,
                expires_at = excluded.expires_at, controller = excluded.controller, unresolved = excluded.unresolved`,
        [this.dbName, JSON.stringify(rows)]);
    }

    async initializeLifecycleIndex(): Promise<void> {
        return this.runExclusive(async () => {
            const pool = this.getPool();
            const epoch = await this.getIndexEpoch();
            const checkpoint = (await pool.query<{ seq: string }>(
                'SELECT COALESCE(MAX(seq), 0)::text AS seq FROM gatekeeper_index_changes WHERE namespace = $1', [this.dbName])).rows[0].seq;
            const stored = (await pool.query<{ value: string; present: boolean }>(
                `SELECT value, EXISTS(SELECT 1 FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'metadata' AND id = 'version') AS present
                    FROM gatekeeper_metadata WHERE namespace = $1 AND key = 'lifecycle'`, [this.dbName])).rows[0];
            let state: LifecycleMetadata | undefined = stored ? JSON.parse(stored.value) : undefined;
            if (state !== undefined && !isLifecycleMetadata(state)) throw new Error('Invalid lifecycle metadata');
            const uncovered = state && (await pool.query(`SELECT 1 FROM gatekeeper_index_changes
                WHERE namespace = $1 AND seq > $2 AND kind = 'did' AND lifecycle_version IS DISTINCT FROM ${LIFECYCLE_VERSION} LIMIT 1`,
            [this.dbName, state.checkedCursor])).rows.length > 0;
            const valid = state?.version === LIFECYCLE_VERSION && state.epoch === epoch && stored?.present
                && BigInt(state.checkedCursor) <= BigInt(checkpoint);
            if (!valid || uncovered) {
                const discardJobs = state?.epoch !== epoch;
                state = { version: LIFECYCLE_VERSION, epoch, complete: false, checkedCursor: checkpoint };
                await this.withTx(async client => {
                    await client.query("DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'did'", [this.dbName]);
                    if (discardJobs) await client.query("DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'job'", [this.dbName]);
                    await client.query(`INSERT INTO gatekeeper_lifecycle(namespace, kind, id, record)
                        VALUES ($1, 'metadata', 'version', $2::jsonb) ON CONFLICT(namespace, kind, id) DO UPDATE SET record = excluded.record`,
                    [this.dbName, JSON.stringify({ version: LIFECYCLE_VERSION })]);
                    await this.saveLifecycleMetadata(client, state!);
                });
            }
            if (!state!.complete) {
                while (true) {
                    const page = await pool.query<{ id: string; events: GatekeeperEvent[] }>(`SELECT id, jsonb_agg(event ORDER BY seq) AS events
                        FROM gatekeeper_events WHERE namespace = $1 AND id IN
                            (SELECT DISTINCT id FROM gatekeeper_events WHERE namespace = $1 AND id > $2 ORDER BY id LIMIT $3)
                        GROUP BY id ORDER BY id`, [this.dbName, state!.backfillCursor ?? '', LIFECYCLE_PAGE_SIZE]);
                    if (!page.rows.length) break;
                    const rows = page.rows.flatMap(({ id, events }) => {
                        const row = projectLifecycle(id, events);
                        return row ? [row] : [];
                    });
                    state!.backfillCursor = page.rows[page.rows.length - 1].id;
                    await this.withTx(async client => {
                        await this.insertLifecycleRows(client, rows);
                        await this.saveLifecycleMetadata(client, state!);
                    });
                }
            }
            state = { version: LIFECYCLE_VERSION, epoch, complete: true, checkedCursor: checkpoint };
            await this.withTx(client => this.saveLifecycleMetadata(client, state!));
        });
    }

    private async saveLifecycleMetadata(client: PoolClient, state: LifecycleMetadata): Promise<void> {
        await client.query(`INSERT INTO gatekeeper_metadata(namespace, key, value) VALUES ($1, 'lifecycle', $2)
            ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value`, [this.dbName, JSON.stringify(state)]);
    }

    async getLifecycleMetadata(): Promise<LifecycleMetadata> {
        const row = (await this.getPool().query<{ value: string }>(
            `SELECT value FROM gatekeeper_metadata WHERE namespace = $1 AND key = 'lifecycle'
                AND EXISTS(SELECT 1 FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'metadata' AND id = 'version')`, [this.dbName])).rows[0];
        const state: LifecycleMetadata | undefined = row && JSON.parse(row.value);
        if (!isLifecycleMetadata(state) || !state.complete || state.version !== LIFECYCLE_VERSION || state.epoch !== await this.getIndexEpoch()) {
            throw new Error('Lifecycle index is not initialized');
        }
        return state;
    }

    async getLifecycle(did: string): Promise<DIDLifecycle | null> {
        const row = (await this.getPool().query<{ record: DIDLifecycle }>(
            "SELECT record FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'did' AND id = $2",
            [this.dbName, this.splitSuffix(did)])).rows[0];
        return row ? this.parseLifecycle(row.record) : null;
    }

    private parseLifecycle(value: unknown): DIDLifecycle {
        if (!isDIDLifecycle(value)) throw new Error('Invalid lifecycle record');
        return value;
    }

    private parseExpirationJob(value: unknown): ExpirationJob {
        if (!isExpirationJob(value)) throw new Error('Invalid expiration cleanup record');
        return value;
    }

    async getDueDIDs(cutoff: number, limit: number, after?: DueDIDCursor): Promise<DIDLifecycle[]> {
        const result = await this.getPool().query<{ record: DIDLifecycle }>(`SELECT record FROM gatekeeper_lifecycle
            WHERE namespace = $1 AND kind = 'did' AND NOT unresolved
                AND COALESCE((record->>'unresolved')::boolean, false) = false AND expires_at < $2
                AND (expires_at, id) > ($3::bigint, $4::text)
            ORDER BY expires_at, id LIMIT $5`,
        [this.dbName, cutoff, after?.expiresAt ?? -8_640_000_000_000_001, after?.suffix ?? '', lifecycleLimit(limit)]);
        return result.rows.map(row => this.parseLifecycle(row.record));
    }

    async getControlledDIDs(controller: string, limit: number, after?: string): Promise<DIDLifecycle[]> {
        const result = await this.getPool().query<{ record: DIDLifecycle }>(`SELECT record FROM gatekeeper_lifecycle
            WHERE namespace = $1 AND kind = 'did' AND controller = $2 AND id > $3 AND record->>'type' = 'asset'
            ORDER BY id LIMIT $4`, [this.dbName, this.splitSuffix(controller), after ?? '', lifecycleLimit(limit)]);
        return result.rows.map(row => this.parseLifecycle(row.record));
    }

    async hasUnresolvedLifecycle(): Promise<boolean> {
        return (await this.getPool().query(`SELECT 1 FROM gatekeeper_lifecycle
            WHERE namespace = $1 AND kind = 'did' AND unresolved LIMIT 1`, [this.dbName])).rows.length > 0;
    }

    async getExpirationJobs(limit: number, after?: string): Promise<ExpirationJob[]> {
        const result = await this.getPool().query<{ record: ExpirationJob }>(`SELECT record FROM gatekeeper_lifecycle
            WHERE namespace = $1 AND kind = 'job' AND id > $2 ORDER BY id LIMIT $3`,
        [this.dbName, after ?? '', lifecycleLimit(limit)]);
        return result.rows.map(row => this.parseExpirationJob(row.record));
    }

    async getExpirationJob(suffix: string): Promise<ExpirationJob | null> {
        const row = (await this.getPool().query<{ record: unknown }>(
            "SELECT record FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'job' AND id = $2", [this.dbName, suffix])).rows[0];
        return row ? this.parseExpirationJob(row.record) : null;
    }

    async saveExpirationJob(suffix: string, job: ExpirationJob | null): Promise<void> {
        if (job && (!isExpirationJob(job) || job.suffix !== suffix)) throw new Error('Invalid expiration cleanup record');
        if (!job) {
            await this.getPool().query("DELETE FROM gatekeeper_lifecycle WHERE namespace = $1 AND kind = 'job' AND id = $2", [this.dbName, suffix]);
            return;
        }
        await this.getPool().query(`INSERT INTO gatekeeper_lifecycle(namespace, kind, id, record)
            VALUES ($1, 'job', $2, $3::jsonb) ON CONFLICT(namespace, kind, id) DO UPDATE SET record = excluded.record`,
        [this.dbName, suffix, JSON.stringify(job)]);
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
        const indexEpoch = await this.getIndexEpoch();
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
            checkpointCursor,
            indexEpoch
        );
    }

    async exportIndexChanges(_options?: IndexExportChangesOptions): Promise<IndexExportResponse> {
        const pool = this.getPool();
        const options = _options ?? {};
        const afterSeq = parseIndexExportCursor(options.cursor);
        const limit = normalizeIndexExportLimit(options.limit);
        const checkpointCursor = await this.getIndexCheckpointCursor();
        const indexEpoch = await this.getIndexEpoch();
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
            checkpointCursor,
            did => this.getEvents(did),
            indexEpoch
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
