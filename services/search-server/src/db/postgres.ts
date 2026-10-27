import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SEARCH_SCHEMA_SQL } from './postgres-schema.js';
import { COORDINATION_TIMEOUT_MS, IndexOwnershipLostError, SearchUnavailableError, SEARCH_PROTOCOL_VERSION, SEARCH_SCHEMA_VERSION, SEARCH_LOCK_NAMESPACE, SEARCH_WRITER_LOCK, SEARCH_SCHEMA_LOCK, SEARCH_LAYOUT_SQL, SEARCH_TABLES, SEARCH_VIEWS, SEARCH_LAYOUT_HASH } from './coordination.js';
import { Pool, type PoolClient } from 'pg';
import {
    ApplyIndexPageOptions,
    ApplyIndexPageResult,
    BlockId,
    BlockInfo,
    ChallengeReceiptListOptions,
    ChallengeReceiptListResult,
    ChallengeReceiptRecord,
    ChallengeReceiptUsageOptions,
    ChallengeReceiptUsageResult,
    DIDsDb,
    DIDEventHistory,
    DIDEventListOptions,
    DIDEventListResult,
    IdentityListOptions,
    IdentityListResult,
    NetworkMetricSnapshot,
    PublishedCredentialListOptions,
    PublishedCredentialListResult,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
    SearchDocsOptions,
    SearchDocsResult,
    GatekeeperEvent,
} from '../types.js';
import { getEventDisplayTime, stableStringify } from './db-utils.js';
import { deduplicateDIDPrefixReferences, extractIdentity, extractIdentityFields } from '../published-credentials.js';
import {
    classifyDIDPrefix,
    getDIDPrefix,
    getDIDSuffix,
    isAgentDID,
} from '../did-aliases.js';

const DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS = 3_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 5_000;
const INSERT_BATCH_SIZE = 500;

async function insertRows(
    client: PoolClient,
    statement: string,
    rows: unknown[][],
    casts: string[] = [],
    suffix = ''
): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
        const params: unknown[] = [];
        const values = batch.map(row => `(${row.map((value, column) => {
            params.push(value);
            return `$${params.length}${casts[column] ?? ''}`;
        }).join(', ')})`);
        await client.query(`${statement} VALUES ${values.join(', ')}${suffix}`, params);
    }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
    const configured = process.env[name];
    const value = Number(configured ?? fallback);
    if (configured?.trim() === '' || !Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

interface SyncStateRow {
    value: string;
}

interface DocRow {
    doc: object | string;
}

interface DidRow {
    did: string;
}

interface EffectiveDidRow extends DidRow {
    storedDid: string;
    prefixAmbiguous: boolean;
}

interface EventRow {
    event: GatekeeperEvent | string;
}

interface HistoryEventRow extends EventRow {
    did: string;
    eventIndex: number;
}

interface BlockRow {
    block: BlockInfo | string;
}

interface CountRow {
    total: number;
}

interface IndexStatusRow {
    isIndex: boolean;
    usable: boolean;
    matchesDefinition: boolean;
    hasStatistics: boolean;
}

export default class Postgres implements DIDsDb {
    private readonly url: string;
    private readonly searchTimeoutMs: number;
    private pool: Pool | null = null;
    private readonly owner = randomUUID();
    private readonly closing = new AbortController();
    private initialized = false;
    private readonly context = new AsyncLocalStorage<{ client: PoolClient; mode: 'read' | 'write'; active: boolean }>();
    private static readonly ARRAY_WILDCARD_END = /\[\*]$/;
    private static readonly ARRAY_WILDCARD_MID = /\[\*]\./;

    static async create<T extends DIDsDb>(
        this: new (url: string) => T,
        url: string
    ): Promise<T> {
        const db = new this(url);
        try {
            await db.connect();
            return db;
        } catch (error) {
            await db.disconnect().catch(() => {});
            throw error;
        }
    }

    constructor(url: string) {
        this.url = url;
        this.searchTimeoutMs = readPositiveIntegerEnv(
            'KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS',
            DEFAULT_SEARCH_TIMEOUT_MS
        );
    }

    async connect(signal?: AbortSignal): Promise<void> {
        signal = signal ? AbortSignal.any([signal, this.closing.signal]) : this.closing.signal;
        signal.throwIfAborted();
        if (!this.pool) this.pool = this.createPool();
        if (this.initialized) {
            await this.access('read', async () => {}, signal);
            return;
        }
        const lease = await this.checkout(signal);
        const { client } = lease;
        let writerLocked = false;
        let schemaLocked = false;
        let transaction = false;
        let failed = true;
        try {
            await this.acquireSessionLock(client, SEARCH_WRITER_LOCK, false, signal);
            writerLocked = true;
            // Queue behind existing readers so continuous HTTP traffic cannot starve takeover.
            await client.query(`SET lock_timeout = '${COORDINATION_TIMEOUT_MS}ms'`);
            await client.query('SELECT pg_advisory_lock(hashtext($1), hashtext($2))',
                [SEARCH_LOCK_NAMESPACE, SEARCH_SCHEMA_LOCK]);
            schemaLocked = true;
            await client.query('RESET lock_timeout');
            const metadata = await client.query(`SELECT to_regclass('search_index_control') AS control,
                EXISTS (SELECT 1 FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace
                    WHERE n.nspname = current_schema() AND r.relname = ANY($1::text[])) AS projections_exist`,
            [SEARCH_TABLES]);
            if (metadata.rows[0].control) {
                await this.control(client);
            }
            const result = await client.query(SEARCH_LAYOUT_SQL, [SEARCH_TABLES, SEARCH_VIEWS]);
            const layout = result.rows[0].layout;
            if (metadata.rows[0].control || metadata.rows[0].projections_exist
                || layout.columns !== null || layout.constraints !== null || layout.views !== null) {
                const hash = createHash('sha256').update(JSON.stringify(layout)).digest('hex');
                if (hash !== SEARCH_LAYOUT_HASH) {
                    throw new SearchUnavailableError('Unsupported existing Search schema. Rebuild the Search database before upgrading');
                }
            }
            signal?.throwIfAborted();
            transaction = true;
            await client.query('BEGIN');
            await client.query(SEARCH_SCHEMA_SQL);
            await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
            await client.query(`CREATE TABLE IF NOT EXISTS search_index_control (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                owner TEXT NOT NULL,
                protocol_version INTEGER NOT NULL,
                schema_version INTEGER NOT NULL
            )`);
            await client.query(`INSERT INTO search_index_control (id, owner, protocol_version, schema_version)
                VALUES (1, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner`,
            [this.owner, SEARCH_PROTOCOL_VERSION, SEARCH_SCHEMA_VERSION]);
            signal?.throwIfAborted();
            await client.query('COMMIT');
            transaction = false;
            await this.unlock(client, SEARCH_SCHEMA_LOCK, false);
            schemaLocked = false;
            signal?.throwIfAborted();
            await this.ensureTextIndex(client);
            signal?.throwIfAborted();
            this.initialized = true;
            failed = false;
        } finally {
            if (transaction) {
                try { await client.query('ROLLBACK'); } catch { failed = true; }
            }
            try {
                if (schemaLocked) await this.unlock(client, SEARCH_SCHEMA_LOCK, false);
                if (writerLocked) await this.unlock(client, SEARCH_WRITER_LOCK, false);
            } catch { failed = true; }
            lease.release(failed);
        }
    }

    async disconnect(): Promise<void> {
        this.closing.abort();
        const pool = this.pool;
        this.pool = null;
        await pool?.end();
    }

    async withRead<T>(work: () => Promise<T>): Promise<T> {
        return this.access('read', work);
    }

    async getRole(): Promise<'writer' | 'reader'> {
        return this.withRead(async () =>
            (await this.control(this.getPool())).owner === this.owner ? 'writer' : 'reader');
    }

    private async withWrite<T>(work: () => Promise<T>): Promise<T> {
        return this.access('write', work);
    }

    private async access<T>(
        mode: 'read' | 'write', work: () => Promise<T>, signal = this.closing.signal,
    ): Promise<T> {
        signal.throwIfAborted();
        const existing = this.context.getStore();
        if (existing) {
            if (!existing.active) throw new SearchUnavailableError('Search transaction has ended');
            if (mode === 'write' && existing.mode !== 'write') throw new Error('Cannot write inside a Search read transaction');
            return work();
        }
        const deadline = performance.now() + (mode === 'read'
            ? Math.min(this.searchTimeoutMs, COORDINATION_TIMEOUT_MS) : COORDINATION_TIMEOUT_MS);
        while (true) {
            const lease = await this.checkout(signal);
            const { client } = lease;
            let transaction = false;
            let sharedLocked = false;
            let destroy = false;
            let contended = false;
            const context = { client, mode, active: true };
            try {
                if (mode === 'read') {
                    await this.acquireSessionLock(client, SEARCH_SCHEMA_LOCK, true, signal, deadline);
                    sharedLocked = true;
                    transaction = true;
                    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
                    await this.control(client);
                } else {
                    transaction = true;
                    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
                    if (!await this.tryLock(client, SEARCH_WRITER_LOCK, false, true)) {
                        await client.query('ROLLBACK');
                        transaction = false;
                        contended = true;
                        continue;
                    }
                    if (!await this.tryLock(client, SEARCH_SCHEMA_LOCK, true, true)) {
                        throw new SearchUnavailableError('Search schema is busy');
                    }
                    await this.requireOwner(client);
                }
                const result = await this.context.run(context, work);
                await client.query('COMMIT');
                transaction = false;
                return result;
            } finally {
                context.active = false;
                if (transaction) {
                    try { await client.query('ROLLBACK'); } catch { destroy = true; }
                }
                if (sharedLocked) {
                    try { await this.unlock(client, SEARCH_SCHEMA_LOCK, true); } catch { destroy = true; }
                }
                lease.release(destroy);
                if (contended) {
                    // End failed lock attempts before waiting, so index builds can finish.
                    if (performance.now() >= deadline) throw new SearchUnavailableError('Search writer is busy. Try again');
                    await delay(25, undefined, { signal });
                }
            }
        }
    }

    private async control(client: PoolClient): Promise<{ owner: string }> {
        const result = await client.query<{ owner: string; protocol_version: number; schema_version: number }>(
            'SELECT owner, protocol_version, schema_version FROM search_index_control WHERE id = 1').catch(error => {
            if (error.code === '42P01' || error.code === '42703') {
                throw new SearchUnavailableError('Missing or incompatible Search coordination table');
            }
            throw error;
        });
        const row = result.rows[0];
        if (!row || typeof row.owner !== 'string' || !row.owner
            || row.protocol_version !== SEARCH_PROTOCOL_VERSION || row.schema_version !== SEARCH_SCHEMA_VERSION) {
            throw new SearchUnavailableError('Incompatible or missing Search coordination metadata');
        }
        return row;
    }

    private async requireOwner(client: PoolClient): Promise<void> {
        if ((await this.control(client)).owner !== this.owner) throw new IndexOwnershipLostError();
    }

    private async tryLock(client: PoolClient, key: string, shared: boolean, transaction = false): Promise<boolean> {
        const name = `pg_try_advisory_${transaction ? 'xact_' : ''}lock${shared ? '_shared' : ''}`;
        const result = await client.query<{ acquired: boolean }>(
            `SELECT ${name}(hashtext($1), hashtext($2)) AS acquired`, [SEARCH_LOCK_NAMESPACE, key]);
        return result.rows[0].acquired;
    }

    private async acquireSessionLock(
        client: PoolClient, key: string, shared: boolean, signal?: AbortSignal,
        deadline = performance.now() + COORDINATION_TIMEOUT_MS,
    ): Promise<void> {
        while (true) {
            signal?.throwIfAborted();
            if (await this.tryLock(client, key, shared)) return;
            if (performance.now() >= deadline) throw new SearchUnavailableError('Search database is busy. Try again');
            await delay(25, undefined, { signal });
        }
    }

    private async unlock(client: PoolClient, key: string, shared: boolean): Promise<void> {
        const result = await client.query<{ released: boolean }>(
            `SELECT pg_advisory_unlock${shared ? '_shared' : ''}(hashtext($1), hashtext($2)) AS released`,
            [SEARCH_LOCK_NAMESPACE, key]);
        if (!result.rows[0].released) throw new Error('Search advisory lock was not held');
    }

    private async checkout(signal = this.closing.signal): Promise<{ client: PoolClient; release: (destroy?: boolean) => void }> {
        signal.throwIfAborted();
        if (!this.pool) throw new Error('Postgres DB not connected');
        const client = await this.pool.connect();
        let released = false;
        const release = (destroy = false) => {
            if (released) return;
            released = true;
            signal.removeEventListener('abort', abort);
            client.release(destroy);
        };
        const abort = () => release(true);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
            release(true);
            signal.throwIfAborted();
        }
        return { client, release };
    }

    private async ensureTextIndex(client: PoolClient): Promise<void> {
        const indexStatus = await client.query<IndexStatusRow>(
            `SELECT idx.relkind = 'i' AS "isIndex",
                    COALESCE(i.indisvalid AND i.indisready AND i.indislive, FALSE) AS usable,
                    COALESCE(i.indrelid = to_regclass($2)
                        AND am.amname = 'gin'
                        AND opc.opcname = 'gin_trgm_ops'
                        AND i.indnkeyatts = 1
                        AND i.indnatts = 1
                        AND i.indpred IS NULL
                        AND pg_get_expr(i.indexprs, i.indrelid) = '(doc)::text', FALSE)
                        AS "matchesDefinition",
                    EXISTS (
                        SELECT 1 FROM pg_stats stats
                        WHERE stats.schemaname = idx_ns.nspname
                            AND stats.tablename = idx.relname
                    ) AS "hasStatistics"
             FROM pg_class idx
             LEFT JOIN pg_namespace idx_ns ON idx_ns.oid = idx.relnamespace
             LEFT JOIN pg_index i ON i.indexrelid = idx.oid
             LEFT JOIN pg_am am ON am.oid = idx.relam
             LEFT JOIN pg_opclass opc ON opc.oid = i.indclass[0]
             WHERE idx.oid = to_regclass($1)`,
            ['idx_did_docs_doc_trgm', 'did_docs']
        );
        const existing = indexStatus.rows[0];

        if (existing && !existing.isIndex) {
            throw new Error('Database object idx_did_docs_doc_trgm exists but is not an index');
        }

        if (existing?.usable && existing.matchesDefinition) {
            if (!existing.hasStatistics) {
                await client.query('ANALYZE did_docs');
            }
            return;
        }

        if (existing) {
            await client.query('DROP INDEX CONCURRENTLY IF EXISTS idx_did_docs_doc_trgm');
        }

        await client.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_did_docs_doc_trgm
                ON did_docs USING gin ((doc::text) gin_trgm_ops)
        `);
        await client.query('ANALYZE did_docs');
    }

    async loadSyncState(key: string): Promise<string | null> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const result = await pool.query<SyncStateRow>(
                'SELECT value FROM sync_state WHERE key = $1 LIMIT 1',
                [key]
            );

            if (result.rowCount === 0) {
                return null;
            }

            return result.rows[0].value;
        });
    }

    async saveSyncState(key: string, value: string | null): Promise<void> {
        return this.withWrite(async () => {
            const pool = this.getPool();

            if (value === null) {
                await pool.query('DELETE FROM sync_state WHERE key = $1', [key]);
                return;
            }

            await pool.query(
                `INSERT INTO sync_state (key, value) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                [key, value]
            );
        });
    }

    async getDIDEvents(did: string): Promise<GatekeeperEvent[]> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const result = await pool.query<EventRow>(
                'SELECT event FROM did_events WHERE did = $1 ORDER BY event_index ASC',
                [did]
            );

            return result.rows.map(row =>
                typeof row.event === 'string'
                    ? JSON.parse(row.event) as GatekeeperEvent
                    : row.event
            );
        });
    }

    async findDIDBySuffix(suffix: string, didPrefix?: string): Promise<string | null> {
        return this.withRead(async () => {
            const prefixFilter = didPrefix ? 'AND prefix = $2' : '';
            const result = await this.getPool().query<DidRow>(
                `SELECT did FROM did_classifications_effective
                 WHERE suffix = $1 ${prefixFilter}
                 LIMIT 1`,
                didPrefix ? [suffix, didPrefix] : [suffix]
            );
            return result.rows[0]?.did ?? null;
        });
    }

    async findAmbiguousDIDBySuffix(suffix: string): Promise<string | null> {
        return this.withRead(async () => {
            const result = await this.getPool().query<DidRow>(
                `SELECT dc.did FROM did_classifications dc
                 WHERE dc.suffix = $1
                   AND NOT dc.prefix_authoritative
                   AND (dc.is_agent OR (
                       SELECT COUNT(DISTINCT dpr.prefix)
                       FROM did_prefix_references dpr
                       WHERE dpr.suffix = dc.suffix
                   ) <> 1)
                 LIMIT 1`,
                [suffix]
            );
            return result.rows[0]?.did ?? null;
        });
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        return this.withRead(async () => {
            const pool = this.getPool();
            let result;

            if (blockId === undefined) {
                result = await pool.query<BlockRow>(
                    'SELECT block FROM blocks WHERE registry = $1 ORDER BY height DESC LIMIT 1',
                    [registry]
                );
            }
            else if (typeof blockId === 'number') {
                result = await pool.query<BlockRow>(
                    'SELECT block FROM blocks WHERE registry = $1 AND height = $2 LIMIT 1',
                    [registry, blockId]
                );
            }
            else {
                result = await pool.query<BlockRow>(
                    'SELECT block FROM blocks WHERE registry = $1 AND hash = $2 LIMIT 1',
                    [registry, blockId]
                );
            }

            if (result.rowCount === 0) {
                return null;
            }

            const { block } = result.rows[0];
            return typeof block === 'string' ? JSON.parse(block) as BlockInfo : block;
        });
    }

    async applyIndexPage(page: ApplyIndexPageOptions): Promise<ApplyIndexPageResult> {
        return this.withWrite(async () => {
            const result: ApplyIndexPageResult = {
                changedDids: [],
                storedBlocks: 0,
                removedBlocks: 0,
                removedDids: 0,
            };
            const eventChanges = new Map<string, boolean>();

            for (const record of page.dids) {
                const existing = await this.getDIDEvents(record.did);
                eventChanges.set(
                    record.did,
                    stableStringify(existing) !== stableStringify(record.events)
                );
            }

            const client = this.getPool();

            const blockRows: unknown[][] = [];
            const classificationRows: unknown[][] = [];
            const eventRows: unknown[][] = [];
            const docRows: unknown[][] = [];
            const credentialRows = new Map<string, unknown[]>();
            const schemaRows: unknown[][] = [];
            const fieldRows: unknown[][] = [];
            const referenceRows: unknown[][] = [];
            const receiptRows: unknown[][] = [];
            const syncStateRows: unknown[][] = [];

            for (const { registry, block, removed } of page.blocks) {
                if (removed) {
                    const deletion = await client.query(
                        'DELETE FROM blocks WHERE registry = $1 AND hash = $2',
                        [registry, block.hash]
                    );
                    if (Number(deletion.rowCount) > 0) {
                        result.removedBlocks += 1;
                    }
                    continue;
                }

                blockRows.push([registry, block.hash, block.height, block.time, JSON.stringify(block)]);
                result.storedBlocks += 1;
            }

            for (const record of page.dids) {
                const suffix = getDIDSuffix(record.did);
                const previousClassification = await client.query<DidRow>(
                    'SELECT did FROM did_classifications WHERE suffix = $1',
                    [suffix]
                );
                const previousDid = previousClassification?.rows?.[0]?.did;
                if (previousDid && previousDid !== record.did) {
                    await client.query('DELETE FROM did_events WHERE did = $1', [previousDid]);
                    await client.query('DELETE FROM did_docs WHERE did = $1', [previousDid]);
                    await client.query('DELETE FROM published_credentials WHERE holder_did = $1', [previousDid]);
                    await client.query('DELETE FROM identity_schemas WHERE did = $1', [previousDid]);
                    await client.query('DELETE FROM identity_fields WHERE did = $1', [previousDid]);
                    await client.query('DELETE FROM did_prefix_references WHERE source_did = $1', [previousDid]);
                    await client.query('DELETE FROM challenge_receipts WHERE receipt_did = $1', [previousDid]);
                    await client.query('DELETE FROM did_classifications WHERE suffix = $1', [suffix]);
                }

                const changed = eventChanges.get(record.did) === true;

                if (!changed && !record.removed) {
                    continue;
                }

                result.changedDids.push(record.did);
                await client.query('DELETE FROM did_events WHERE did = $1', [record.did]);

                if (record.removed) {
                    await client.query('DELETE FROM did_docs WHERE did = $1', [record.did]);
                    await client.query('DELETE FROM published_credentials WHERE holder_did = $1', [record.did]);
                    await client.query('DELETE FROM identity_schemas WHERE did = $1', [record.did]);
                    await client.query('DELETE FROM identity_fields WHERE did = $1', [record.did]);
                    await client.query('DELETE FROM did_prefix_references WHERE source_did = $1', [record.did]);
                    await client.query('DELETE FROM challenge_receipts WHERE receipt_did = $1', [record.did]);
                    await client.query('DELETE FROM did_classifications WHERE suffix = $1', [suffix]);
                    result.removedDids += 1;
                    continue;
                }

                const classification = classifyDIDPrefix(record.events);
                classificationRows.push([
                    suffix,
                    record.did,
                    classification.prefix,
                    classification.authoritative,
                    isAgentDID(record.events),
                ]);

                for (const [index, event] of record.events.entries()) {
                    eventRows.push([
                        record.did,
                        index,
                        event.registry,
                        getEventDisplayTime(event),
                        JSON.stringify(event),
                    ]);
                }

                if (record.doc) {
                    docRows.push([record.did, JSON.stringify(record.doc)]);
                }

                await client.query('DELETE FROM published_credentials WHERE holder_did = $1', [record.did]);
                for (const credential of record.publishedCredentials ?? []) {
                    const credentialSuffix = getDIDSuffix(credential.credentialDid);
                    credentialRows.set(`${credential.holderDid}\0${credentialSuffix}`, [
                        credential.holderDid,
                        credentialSuffix,
                        getDIDSuffix(credential.schemaDid),
                        credential.issuerDid,
                        credential.subjectDid,
                        credential.revealed,
                        credential.updatedAt,
                    ]);
                }
                await client.query('DELETE FROM identity_schemas WHERE did = $1', [record.did]);
                for (const schemaSuffix of new Set((record.publishedCredentials ?? []).map(item => getDIDSuffix(item.schemaDid)))) {
                    schemaRows.push([record.did, schemaSuffix]);
                }
                await client.query('DELETE FROM identity_fields WHERE did = $1', [record.did]);
                for (const [suffix, fields] of extractIdentityFields(record.doc ?? {}, record.publishedCredentials ?? [])) {
                    for (const field of fields) {
                        fieldRows.push([record.did, field, suffix]);
                    }
                }
                await client.query('DELETE FROM did_prefix_references WHERE source_did = $1', [record.did]);
                for (const did of deduplicateDIDPrefixReferences(
                    record.didPrefixReferences ?? [],
                    record.publishedCredentials ?? []
                )) {
                    referenceRows.push([record.did, getDIDSuffix(did), getDIDPrefix(did)]);
                }
                await client.query('DELETE FROM challenge_receipts WHERE receipt_did = $1', [record.did]);
                for (const receipt of record.challengeReceipts ?? []) {
                    receiptRows.push([
                        receipt.receiptDid,
                        receipt.attesterDid,
                        getDIDSuffix(receipt.attesterDid),
                        receipt.schemaDid,
                        getDIDSuffix(receipt.schemaDid),
                        receipt.requesterDid,
                        getDIDSuffix(receipt.requesterDid),
                        receipt.responseCommitment,
                        receipt.updatedAt,
                    ]);
                }
            }

            for (const [key, value] of Object.entries(page.syncStateUpdates ?? {})) {
                if (value === null) {
                    await client.query('DELETE FROM sync_state WHERE key = $1', [key]);
                    continue;
                }

                syncStateRows.push([key, value]);
            }

            await insertRows(
                client,
                'INSERT INTO blocks (registry, hash, height, time, block)',
                blockRows,
                ['', '', '', '', '::jsonb'],
                ` ON CONFLICT (registry, hash) DO UPDATE SET
                    height = EXCLUDED.height,
                    time = EXCLUDED.time,
                    block = EXCLUDED.block`
            );
            await insertRows(
                client,
                'INSERT INTO did_classifications (suffix, did, prefix, prefix_authoritative, is_agent)',
                classificationRows,
                [],
                ` ON CONFLICT (suffix) DO UPDATE SET
                    did = EXCLUDED.did,
                    prefix = EXCLUDED.prefix,
                    prefix_authoritative = EXCLUDED.prefix_authoritative,
                    is_agent = EXCLUDED.is_agent`
            );
            await insertRows(
                client,
                'INSERT INTO did_events (did, event_index, registry, time, event)',
                eventRows,
                ['', '', '', '', '::jsonb']
            );
            await insertRows(
                client,
                'INSERT INTO did_docs (did, doc)',
                docRows,
                ['', '::jsonb'],
                ' ON CONFLICT (did) DO UPDATE SET doc = EXCLUDED.doc'
            );
            await insertRows(
                client,
                `INSERT INTO published_credentials (
                    holder_did,
                    credential_suffix,
                    schema_suffix,
                    issuer_did,
                    subject_did,
                    revealed,
                    updated_at
                )`,
                Array.from(credentialRows.values()),
                [],
                ` ON CONFLICT (holder_did, credential_suffix) DO UPDATE SET
                    schema_suffix = EXCLUDED.schema_suffix,
                    issuer_did = EXCLUDED.issuer_did,
                    subject_did = EXCLUDED.subject_did,
                    revealed = EXCLUDED.revealed,
                    updated_at = EXCLUDED.updated_at`
            );
            await insertRows(
                client,
                'INSERT INTO identity_schemas (did, schema_suffix)',
                schemaRows
            );
            await insertRows(
                client,
                'INSERT INTO identity_fields (did, field, schema_suffix)',
                fieldRows
            );
            await insertRows(
                client,
                'INSERT INTO did_prefix_references (source_did, suffix, prefix)',
                referenceRows
            );
            await insertRows(
                client,
                `INSERT INTO challenge_receipts (
                    receipt_did,
                    attester_did,
                    attester_suffix,
                    schema_did,
                    schema_suffix,
                    requester_did,
                    requester_suffix,
                    response_commitment,
                    updated_at
                )`,
                receiptRows,
                [],
                ` ON CONFLICT (receipt_did) DO UPDATE SET
                    attester_did = EXCLUDED.attester_did,
                    attester_suffix = EXCLUDED.attester_suffix,
                    schema_did = EXCLUDED.schema_did,
                    schema_suffix = EXCLUDED.schema_suffix,
                    requester_did = EXCLUDED.requester_did,
                    requester_suffix = EXCLUDED.requester_suffix,
                    response_commitment = EXCLUDED.response_commitment,
                    updated_at = EXCLUDED.updated_at`
            );
            await insertRows(
                client,
                'INSERT INTO sync_state (key, value)',
                syncStateRows,
                [],
                ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'
            );

            return result;
        });
    }

    async getDID(did: string): Promise<object | null> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const result = await pool.query<DocRow>(
                'SELECT doc FROM did_docs WHERE did = $1 LIMIT 1',
                [did]
            );

            if (result.rowCount === 0) {
                return null;
            }

            const { doc } = result.rows[0];
            if (typeof doc === 'string') {
                return JSON.parse(doc);
            }

            return doc;
        });
    }

    async listIdentities(options: IdentityListOptions = {}): Promise<IdentityListResult> {
        return this.withRead(async () => {
            const { didPrefix, includeAmbiguous = false, schemaDid, fields = [], limit = 50, offset = 0 } = options;
            const scopeFilter = didPrefix
                ? includeAmbiguous
                    ? 'AND (dc.prefix COLLATE "C" = $1 OR NOT dc.prefix_authoritative)'
                    : 'AND dc.prefix COLLATE "C" = $1'
                : '';
            let from = `FROM did_classifications dc
                JOIN did_docs d ON d.did = dc.did
                WHERE dc.is_agent = TRUE ${scopeFilter}`;
            const params = didPrefix ? [didPrefix] : [];
            if (fields.length > 0) {
                const placeholders = fields.map((_, index) => `$${params.length + index + 1}`);
                params.push(...fields);
                if (schemaDid) params.push(getDIDSuffix(schemaDid));
                // Hash long field names for lookup, but compare literals too so collisions cannot match.
                from += ` AND EXISTS (
                    SELECT 1 FROM identity_fields idf
                    WHERE idf.did = dc.did AND idf.field IN (${placeholders.join(',')})
                    AND md5(idf.field) IN (${placeholders.map(value => `md5(${value})`).join(',')})
                    ${schemaDid ? `AND idf.schema_suffix = $${params.length}` : ''}
                )`;
            }
            else if (schemaDid) {
                params.push(getDIDSuffix(schemaDid));
                from += ` AND EXISTS (
                    SELECT 1 FROM identity_schemas ids
                    WHERE ids.did = dc.did AND ids.schema_suffix = $${params.length}
                )`;
            }
            const client = this.getPool();
            const count = await client.query<CountRow>(`SELECT COUNT(*)::int AS total ${from}`, params);
            const rows = await client.query<DocRow & DidRow & { prefixAmbiguous: boolean }>(
                `SELECT dc.prefix || ':' || dc.suffix AS did,
                        NOT dc.prefix_authoritative AS "prefixAmbiguous",
                        d.doc ${from}
                 ORDER BY ${didPrefix
        ? 'dc.suffix COLLATE "C"'
        : 'dc.prefix COLLATE "C", dc.suffix COLLATE "C"'}
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, Math.max(0, limit), Math.max(0, offset)]
            );
            return {
                total: count.rows[0].total,
                identities: rows.rows.map(row => extractIdentity(
                    includeAmbiguous && didPrefix && row.prefixAmbiguous
                        ? `${didPrefix}:${getDIDSuffix(row.did)}`
                        : row.did,
                    typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc,
                    options
                )),
            };
        });
    }

    async getPublishedCredentialCountsBySchema(
        didPrefix?: string,
        includeAmbiguous = false
    ): Promise<PublishedCredentialSchemaCount[]> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const schemaPrefix = didPrefix && includeAmbiguous
                ? 'CASE WHEN pc.schema_prefix_ambiguous THEN $1 ELSE pc.schema_effective_prefix END'
                : 'pc.schema_effective_prefix';
            const credentialScope = includeAmbiguous
                ? '(pc.credential_effective_prefix = $1 OR pc.credential_prefix_ambiguous)'
                : 'pc.credential_effective_prefix = $1';
            const schemaScope = includeAmbiguous
                ? '(pc.schema_effective_prefix = $1 OR pc.schema_prefix_ambiguous)'
                : 'pc.schema_effective_prefix = $1';
            const result = await pool.query<PublishedCredentialSchemaCount>(
                `SELECT ${schemaPrefix} || ':' || pc.schema_suffix AS "schemaDid",
                        COUNT(*)::int AS count
                 FROM published_credentials_classified pc
                 ${didPrefix ? `WHERE ${credentialScope} AND ${schemaScope}` : ''}
                 GROUP BY "schemaDid"
                 ORDER BY count DESC, "schemaDid" ASC`,
                didPrefix ? [didPrefix] : []
            );

            return result.rows;
        });
    }

    async listPublishedCredentials(
        options: PublishedCredentialListOptions = {}
    ): Promise<PublishedCredentialListResult> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const {
                didPrefix,
                includeAmbiguous = false,
                credentialDid,
                schemaDid,
                issuerDid,
                subjectDid,
                revealed,
                limit = 50,
                offset = 0,
            } = options;

            const clauses: string[] = [];
            const params: unknown[] = [];
            let index = 1;

            if (didPrefix) {
                clauses.push(includeAmbiguous
                    ? `(pc.credential_effective_prefix = $${index} OR pc.credential_prefix_ambiguous)`
                    : `pc.credential_effective_prefix = $${index}`);
                params.push(didPrefix);
                index++;
            }

            if (credentialDid) {
                clauses.push(`pc.credential_suffix = $${index++}`);
                params.push(getDIDSuffix(credentialDid));
            }

            if (schemaDid) {
                clauses.push(`pc.schema_suffix = $${index++}`);
                params.push(getDIDSuffix(schemaDid));
            }

            if (issuerDid) {
                clauses.push(`right(pc.issuer_did, length($${index}) + 1) = ':' || $${index}`);
                params.push(getDIDSuffix(issuerDid));
                index++;
            }

            if (subjectDid) {
                clauses.push(`pc.subject_did = (
                    SELECT did FROM did_classifications WHERE suffix = $${index++}
                )`);
                params.push(getDIDSuffix(subjectDid));
            }

            if (typeof revealed === 'boolean') {
                clauses.push(`pc.revealed = $${index++}`);
                params.push(revealed);
            }

            const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
            const totalResult = await pool.query<CountRow>(
                `SELECT COUNT(*)::int AS total
                 FROM published_credentials_classified pc
                 ${where}`,
                params
            );

            const pageParams = [...params, Math.max(0, limit), Math.max(0, offset)];
            const limitParam = `$${pageParams.length - 1}`;
            const offsetParam = `$${pageParams.length}`;
            const result = await pool.query<PublishedCredentialRecord & {
                credentialPrefixAmbiguous: boolean;
                schemaPrefixAmbiguous: boolean;
            }>(
                `SELECT
                    pc.holder_did AS "holderDid",
                    pc.credential_effective_prefix || ':' || pc.credential_suffix AS "credentialDid",
                    pc.schema_effective_prefix || ':' || pc.schema_suffix AS "schemaDid",
                    pc.issuer_did AS "issuerDid",
                    pc.subject_did AS "subjectDid",
                    pc.revealed AS "revealed",
                    pc.updated_at AS "updatedAt",
                    pc.credential_prefix_ambiguous AS "credentialPrefixAmbiguous",
                    pc.schema_prefix_ambiguous AS "schemaPrefixAmbiguous"
                 FROM published_credentials_classified pc
                 ${where}
                 ORDER BY pc.updated_at DESC, ${didPrefix ? 'pc.credential_suffix' : '"credentialDid"'} ASC
                 LIMIT ${limitParam} OFFSET ${offsetParam}`,
                pageParams
            );

            return {
                total: totalResult.rows[0]?.total ?? 0,
                credentials: result.rows.map(({ credentialPrefixAmbiguous, schemaPrefixAmbiguous, ...row }) => ({
                    ...row,
                    credentialDid: includeAmbiguous && didPrefix && credentialPrefixAmbiguous
                        ? `${didPrefix}:${getDIDSuffix(row.credentialDid)}`
                        : row.credentialDid,
                    schemaDid: includeAmbiguous && didPrefix && schemaPrefixAmbiguous
                        ? `${didPrefix}:${getDIDSuffix(row.schemaDid)}`
                        : row.schemaDid,
                })),
            };
        });
    }

    async listChallengeReceipts(
        options: ChallengeReceiptListOptions = {}
    ): Promise<ChallengeReceiptListResult> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const {
                limit = 50,
                offset = 0,
            } = options;
            const { where, params } = this.buildChallengeReceiptWhere(options);
            const totalResult = await pool.query<CountRow>(
                `SELECT COUNT(*)::int AS total
                 FROM challenge_receipts cr
                 JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
                 ${where}`,
                params
            );
            const pageParams = [...params, Math.max(0, limit), Math.max(0, offset)];
            const limitParam = `$${pageParams.length - 1}`;
            const offsetParam = `$${pageParams.length}`;
            const result = await pool.query<ChallengeReceiptRecord & { prefixAmbiguous: boolean }>(
                `SELECT
                    dc.prefix || ':' || dc.suffix AS "receiptDid",
                    cr.attester_did AS "attesterDid",
                    cr.schema_did AS "schemaDid",
                    cr.requester_did AS "requesterDid",
                    cr.response_commitment AS "responseCommitment",
                    cr.updated_at AS "updatedAt",
                    dc.prefix_ambiguous AS "prefixAmbiguous"
                 FROM challenge_receipts cr
                 JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
                 ${where}
                 ORDER BY cr.updated_at DESC, ${options.didPrefix ? 'dc.suffix' : '"receiptDid"'} ASC
                 LIMIT ${limitParam} OFFSET ${offsetParam}`,
                pageParams
            );

            return {
                total: totalResult.rows[0]?.total ?? 0,
                receipts: result.rows.map(({ prefixAmbiguous, ...row }) => ({
                    ...row,
                    receiptDid: options.includeAmbiguous && options.didPrefix && prefixAmbiguous
                        ? `${options.didPrefix}:${getDIDSuffix(row.receiptDid)}`
                        : row.receiptDid,
                })),
            };
        });
    }

    async getChallengeReceiptUsage(
        options: ChallengeReceiptUsageOptions = {}
    ): Promise<ChallengeReceiptUsageResult> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const {
                limit = 50,
                offset = 0,
            } = options;
            const { where, params } = this.buildChallengeReceiptWhere(options);
            const totalResult = await pool.query<CountRow>(
                `SELECT COUNT(*)::int AS total
                 FROM (
                    SELECT 1
                    FROM challenge_receipts cr
                    JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
                    ${where}
                    GROUP BY cr.attester_suffix, cr.schema_suffix, cr.requester_suffix
                 ) AS grouped`,
                params
            );
            const pageParams = [...params, Math.max(0, limit), Math.max(0, offset)];
            const limitParam = `$${pageParams.length - 1}`;
            const offsetParam = `$${pageParams.length}`;
            const result = await pool.query<{
                attesterDid: string;
                schemaDid: string;
                requesterDid: string;
                count: number;
                firstUpdatedAt: string;
                lastUpdatedAt: string;
            }>(
                `SELECT
                    MIN(cr.attester_did) AS "attesterDid",
                    MIN(cr.schema_did) AS "schemaDid",
                    MIN(cr.requester_did) AS "requesterDid",
                    COUNT(DISTINCT cr.response_commitment)::int AS count,
                    MIN(cr.updated_at) AS "firstUpdatedAt",
                    MAX(cr.updated_at) AS "lastUpdatedAt"
                 FROM challenge_receipts cr
                 JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
                 ${where}
                 GROUP BY cr.attester_suffix, cr.schema_suffix, cr.requester_suffix
                 ORDER BY count DESC, "schemaDid" ASC, "requesterDid" ASC
                 LIMIT ${limitParam} OFFSET ${offsetParam}`,
                pageParams
            );

            return {
                total: totalResult.rows[0]?.total ?? 0,
                usage: result.rows,
            };
        });
    }

    async listEvents(options: DIDEventListOptions = {}): Promise<DIDEventListResult> {
        return this.withRead(async () => {
            const pool = this.getPool();
            const {
                didPrefix,
                includeAmbiguous = false,
                registry,
                updatedAfter,
                updatedBefore,
                limit = 50,
                offset = 0,
            } = options;
            const clauses: string[] = [];
            const params: unknown[] = [];
            let index = 1;

            if (didPrefix) {
                clauses.push(includeAmbiguous
                    ? `(dc.prefix = $${index} OR dc.prefix_ambiguous)`
                    : `dc.prefix = $${index}`);
                params.push(didPrefix);
                index++;
            }

            if (registry) {
                clauses.push(`e.registry = $${index++}`);
                params.push(registry);
            }

            if (updatedAfter) {
                clauses.push(`e.time > $${index++}`);
                params.push(updatedAfter);
            }

            if (updatedBefore) {
                clauses.push(`e.time < $${index++}`);
                params.push(updatedBefore);
            }

            const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
            const totalResult = await pool.query<CountRow>(
                `SELECT COUNT(*)::int AS total
                 FROM did_events e
                 JOIN did_classifications_effective dc ON dc.did = e.did
                 ${where}`,
                params
            );
            const pageParams = [...params, Math.max(0, limit), Math.max(0, offset)];
            const limitParam = `$${pageParams.length - 1}`;
            const offsetParam = `$${pageParams.length}`;
            const result = await pool.query<{
                did: string;
                registry: string;
                time: string;
                event: GatekeeperEvent | string;
                prefixAmbiguous: boolean;
            }>(
                `SELECT dc.prefix || ':' || dc.suffix AS did,
                        e.registry,
                        e.time,
                        e.event,
                        dc.prefix_ambiguous AS "prefixAmbiguous"
                 FROM did_events e
                 JOIN did_classifications_effective dc ON dc.did = e.did
                 ${where}
                 ORDER BY e.time DESC, ${didPrefix ? 'dc.suffix' : 'did'} ASC, e.event_index ASC
                 LIMIT ${limitParam} OFFSET ${offsetParam}`,
                pageParams
            );

            return {
                total: totalResult.rows[0]?.total ?? 0,
                events: result.rows.map(row => ({
                    did: includeAmbiguous && didPrefix && row.prefixAmbiguous
                        ? `${didPrefix}:${getDIDSuffix(row.did)}`
                        : row.did,
                    registry: row.registry,
                    time: row.time,
                    event: typeof row.event === 'string'
                        ? JSON.parse(row.event) as GatekeeperEvent
                        : row.event,
                })),
            };
        });
    }

    async *iterateDIDEventHistories(pageSize = 500): AsyncIterable<DIDEventHistory> {
        const limit = Math.max(1, pageSize);
        let cursorDid: string | null = null;
        let cursorIndex = -1;
        let currentDid: string | null = null;
        let currentEvents: GatekeeperEvent[] = [];

        while (true) {
            const result: { rows: HistoryEventRow[] } = await this.withRead(async () => {
                const pool = this.getPool();
                await this.requireOwner(pool);
                return cursorDid === null
                    ? await pool.query<HistoryEventRow>(
                        `SELECT did, event_index AS "eventIndex", event
                     FROM did_events
                     ORDER BY did ASC, event_index ASC
                     LIMIT $1`,
                        [limit]
                    )
                    : await pool.query<HistoryEventRow>(
                        `SELECT did, event_index AS "eventIndex", event
                     FROM did_events
                     WHERE (did, event_index) > ($1, $2)
                     ORDER BY did ASC, event_index ASC
                     LIMIT $3`,
                        [cursorDid, cursorIndex, limit]
                    );
            });

            if (result.rows.length === 0) {
                break;
            }

            for (const row of result.rows) {
                if (currentDid !== null && row.did !== currentDid) {
                    yield { did: currentDid, events: currentEvents };
                    currentEvents = [];
                }

                currentDid = row.did;
                currentEvents.push(typeof row.event === 'string'
                    ? JSON.parse(row.event) as GatekeeperEvent
                    : row.event);
            }

            const last: HistoryEventRow = result.rows[result.rows.length - 1];
            cursorDid = last.did;
            cursorIndex = last.eventIndex;

            if (result.rows.length < limit) {
                break;
            }
        }

        if (currentDid !== null) {
            yield { did: currentDid, events: currentEvents };
        }
    }

    async replaceNetworkMetricSnapshots(snapshots: NetworkMetricSnapshot[]): Promise<void> {
        return this.withWrite(async () => {
            const client = this.getPool();
            await client.query('DELETE FROM network_metric_snapshots');
            for (const snapshot of snapshots) {
                await client.query(
                    `INSERT INTO network_metric_snapshots (
                        snapshot_date,
                        did_count,
                        did_counts_by_prefix,
                        agent_did_count,
                        agent_did_counts_by_prefix,
                        credential_count,
                        credential_did_counts_by_prefix,
                        schema_counts,
                        rebuilt_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [
                        snapshot.date,
                        snapshot.didCount,
                        JSON.stringify(snapshot.didCountsByPrefix),
                        snapshot.agentDidCount,
                        JSON.stringify(snapshot.agentDidCountsByPrefix),
                        snapshot.credentialCount,
                        JSON.stringify(snapshot.credentialDidCountsByPrefix),
                        JSON.stringify(snapshot.schemas),
                        snapshot.rebuiltAt,
                    ]
                );
            }
        });
    }

    async getNetworkMetricSnapshot(date: string): Promise<NetworkMetricSnapshot | null> {
        return this.withRead(async () => {
            const result = await this.getPool().query<{
                date: string;
                didCount: number;
                didCountsByPrefix: Record<string, number> | string;
                agentDidCount: number;
                agentDidCountsByPrefix: Record<string, number> | string;
                credentialCount: number;
                credentialDidCountsByPrefix: Record<string, number> | string;
                schemaCounts: PublishedCredentialSchemaCount[] | string;
                rebuiltAt: string;
            }>(
                `SELECT
                    snapshot_date AS date,
                    did_count AS "didCount",
                    did_counts_by_prefix AS "didCountsByPrefix",
                    agent_did_count AS "agentDidCount",
                    agent_did_counts_by_prefix AS "agentDidCountsByPrefix",
                    credential_count AS "credentialCount",
                    credential_did_counts_by_prefix AS "credentialDidCountsByPrefix",
                    schema_counts AS "schemaCounts",
                    rebuilt_at AS "rebuiltAt"
                 FROM network_metric_snapshots
                 WHERE snapshot_date = $1`,
                [date]
            );

            const row = result.rows[0];
            if (!row) {
                return null;
            }

            return {
                date: row.date,
                didCount: row.didCount,
                didCountsByPrefix: typeof row.didCountsByPrefix === 'string'
                    ? JSON.parse(row.didCountsByPrefix) as Record<string, number>
                    : row.didCountsByPrefix,
                agentDidCount: row.agentDidCount,
                agentDidCountsByPrefix: typeof row.agentDidCountsByPrefix === 'string'
                    ? JSON.parse(row.agentDidCountsByPrefix) as Record<string, number>
                    : row.agentDidCountsByPrefix,
                credentialCount: row.credentialCount,
                credentialDidCountsByPrefix: typeof row.credentialDidCountsByPrefix === 'string'
                    ? JSON.parse(row.credentialDidCountsByPrefix) as Record<string, number>
                    : row.credentialDidCountsByPrefix,
                schemas: typeof row.schemaCounts === 'string'
                    ? JSON.parse(row.schemaCounts) as PublishedCredentialSchemaCount[]
                    : row.schemaCounts,
                rebuiltAt: row.rebuiltAt,
            };
        });
    }

    async searchDocs(q: string, options: SearchDocsOptions): Promise<SearchDocsResult> {
        return this.withRead(async () => {
            const { didPrefix, includeAmbiguous = false, limit, cursor } = options;
            const escapedQuery = q.replace(/[!%_]/g, '!$&');
            const params: unknown[] = [escapedQuery];
            const filters: string[] = [];
            if (didPrefix) {
                params.push(didPrefix);
                filters.push(includeAmbiguous
                    ? `(dc.prefix = $${params.length} OR dc.prefix_ambiguous)`
                    : `dc.prefix = $${params.length}`);
            }
            if (cursor) {
                params.push(cursor);
                filters.push(didPrefix
                    ? `dc.suffix COLLATE "C" > $${params.length}`
                    : `(dc.prefix || ':' || dc.suffix) COLLATE "C" > $${params.length}`);
                if (didPrefix) {
                    params[params.length - 1] = getDIDSuffix(cursor);
                }
            }
            params.push(limit + 1);

            const client = this.getPool();
            await client.query(`SET LOCAL statement_timeout = '${this.searchTimeoutMs}ms'`);
            const result = await client.query<DidRow & { prefixAmbiguous: boolean }>(
                `WITH matches AS MATERIALIZED (
                    SELECT did
                    FROM did_docs
                    WHERE doc::text LIKE '%' || $1 || '%' ESCAPE '!'
                 )
                 SELECT dc.prefix || ':' || dc.suffix AS did,
                        dc.prefix_ambiguous AS "prefixAmbiguous"
                 FROM matches m
                 JOIN did_classifications_effective dc ON dc.did = m.did
                 ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
                 ORDER BY ${didPrefix ? 'dc.suffix' : `(dc.prefix || ':' || dc.suffix)`} COLLATE "C"
                 LIMIT $${params.length}`,
                params
            );

            const dids = result.rows.slice(0, limit).map(row =>
                includeAmbiguous && didPrefix && row.prefixAmbiguous
                    ? `${didPrefix}:${getDIDSuffix(row.did)}`
                    : row.did
            );
            return {
                dids,
                nextCursor: result.rows.length > limit ? dids[dids.length - 1] : null,
            };
        });
    }

    async queryDocs(
        where: Record<string, unknown>,
        didPrefix?: string,
        includeAmbiguous = false
    ): Promise<string[]> {
        return this.withRead(async () => {
            const pool = this.getPool();

            const entry = Object.entries(where)[0] as [string, any] | undefined;
            if (!entry) {
                return [];
            }

            const [rawPath, cond] = entry;
            if (typeof cond !== 'object' || !Array.isArray(cond.$in)) {
                throw new Error('Only {$in:[…]} supported');
            }

            const list = cond.$in as unknown[];
            if (list.length === 0) {
                return [];
            }

            const isKeyWildcard = rawPath.endsWith('.*');
            const isValueWildcard = rawPath.includes('.*.');
            const isArrayTail = Postgres.ARRAY_WILDCARD_END.test(rawPath);
            const isArrayMid = Postgres.ARRAY_WILDCARD_MID.test(rawPath);

            let result;

            if (isArrayTail) {
                const basePath = this.toPathTokens(rawPath.replace(Postgres.ARRAY_WILDCARD_END, ''));
                result = await pool.query<DidRow>(
                    `SELECT DISTINCT d.did
                     FROM did_docs d
                     JOIN LATERAL jsonb_array_elements(
                         CASE
                             WHEN jsonb_typeof(d.doc #> $1::text[]) = 'array' THEN d.doc #> $1::text[]
                             ELSE '[]'::jsonb
                         END
                     ) AS elem(value) ON TRUE
                     WHERE EXISTS (
                         SELECT 1
                         FROM unnest($2::text[]) AS expected(value)
                         WHERE elem.value = expected.value::jsonb
                     )`,
                    [basePath, this.toJsonLiterals(list)]
                );
            } else if (isArrayMid) {
                const [prefix, suffix] = rawPath.split('[*].');
                const basePath = this.toPathTokens(prefix);
                const suffixPath = this.toPathTokens(suffix);
                result = await pool.query<DidRow>(
                    `SELECT DISTINCT d.did
                     FROM did_docs d
                     JOIN LATERAL jsonb_array_elements(
                         CASE
                             WHEN jsonb_typeof(d.doc #> $1::text[]) = 'array' THEN d.doc #> $1::text[]
                             ELSE '[]'::jsonb
                         END
                     ) AS elem(value) ON TRUE
                     WHERE EXISTS (
                         SELECT 1
                         FROM unnest($3::text[]) AS expected(value)
                         WHERE elem.value #> $2::text[] = expected.value::jsonb
                     )`,
                    [basePath, suffixPath, this.toJsonLiterals(list)]
                );
            } else if (isKeyWildcard) {
                const basePath = this.toPathTokens(rawPath.slice(0, -2));
                result = await pool.query<DidRow>(
                    `SELECT DISTINCT d.did
                     FROM did_docs d
                     JOIN LATERAL jsonb_each(
                         CASE
                             WHEN jsonb_typeof(d.doc #> $1::text[]) = 'object' THEN d.doc #> $1::text[]
                             ELSE '{}'::jsonb
                         END
                     ) AS member(key, value) ON TRUE
                     WHERE member.key = ANY($2::text[])`,
                    [basePath, list.map(value => String(value))]
                );
            } else if (isValueWildcard) {
                const [prefix, suffix] = rawPath.split('.*.');
                const basePath = this.toPathTokens(prefix);
                const suffixPath = this.toPathTokens(suffix);
                result = await pool.query<DidRow>(
                    `SELECT DISTINCT d.did
                     FROM did_docs d
                     JOIN LATERAL jsonb_each(
                         CASE
                             WHEN jsonb_typeof(d.doc #> $1::text[]) = 'object' THEN d.doc #> $1::text[]
                             ELSE '{}'::jsonb
                         END
                     ) AS member(key, value) ON TRUE
                     WHERE EXISTS (
                         SELECT 1
                         FROM unnest($3::text[]) AS expected(value)
                         WHERE member.value #> $2::text[] = expected.value::jsonb
                     )`,
                    [basePath, suffixPath, this.toJsonLiterals(list)]
                );
            } else {
                const path = this.toPathTokens(rawPath);
                result = await pool.query<DidRow>(
                    `SELECT DISTINCT did
                     FROM did_docs
                     WHERE EXISTS (
                         SELECT 1
                         FROM unnest($2::text[]) AS expected(value)
                         WHERE did_docs.doc #> $1::text[] = expected.value::jsonb
                     )`,
                    [path, this.toJsonLiterals(list)]
                );
            }

            return this.effectiveDIDs(result.rows.map(row => row.did), didPrefix, includeAmbiguous);
        });
    }

    async wipeDb(): Promise<void> {
        return this.withWrite(async () => {
            const pool = this.getPool();
            await pool.query('DELETE FROM did_docs');
            await pool.query('DELETE FROM did_events');
            await pool.query('DELETE FROM did_classifications');
            await pool.query('DELETE FROM blocks');
            await pool.query('DELETE FROM published_credentials');
            await pool.query('DELETE FROM identity_schemas');
            await pool.query('DELETE FROM identity_fields');
            await pool.query('DELETE FROM did_prefix_references');
            await pool.query('DELETE FROM challenge_receipts');
            await pool.query('DELETE FROM network_metric_snapshots');
            await pool.query('DELETE FROM sync_state');
        });
    }

    private getPool(): PoolClient {
        const context = this.context.getStore();
        if (!context?.active) throw new Error('Postgres access outside an active Search transaction');
        return context.client;
    }

    private async effectiveDIDs(
        dids: string[],
        didPrefix: string | undefined,
        includeAmbiguous: boolean
    ): Promise<string[]> {
        const result = await this.getPool().query<EffectiveDidRow>(
            `SELECT did AS "storedDid",
                    prefix || ':' || suffix AS did,
                    prefix_ambiguous AS "prefixAmbiguous"
             FROM did_classifications_effective
             WHERE did = ANY($1::text[])
             ${didPrefix
        ? `AND (prefix = $2${includeAmbiguous ? ' OR prefix_ambiguous' : ''})`
        : ''}`,
            didPrefix ? [dids, didPrefix] : [dids]
        );
        const effectiveByStored = new Map(result.rows.map(row => [
            row.storedDid,
            includeAmbiguous && didPrefix && row.prefixAmbiguous
                ? `${didPrefix}:${getDIDSuffix(row.did)}`
                : row.did,
        ]));
        return dids.flatMap(did => {
            const effectiveDid = effectiveByStored.get(did);
            return effectiveDid ? [effectiveDid] : [];
        });
    }

    protected createPool(): Pool {
        return new Pool({
            connectionString: this.url,
            connectionTimeoutMillis: readPositiveIntegerEnv(
                'KC_POSTGRES_CONNECTION_TIMEOUT_MS',
                DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS
            ),
        });
    }

    private buildChallengeReceiptWhere(
        options: ChallengeReceiptListOptions | ChallengeReceiptUsageOptions
    ): { where: string; params: unknown[] } {
        const clauses: string[] = [];
        const params: unknown[] = [];
        let index = 1;
        const receiptDid = 'receiptDid' in options ? options.receiptDid : undefined;
        const responseCommitment = 'responseCommitment' in options ? options.responseCommitment : undefined;

        if (options.didPrefix) {
            clauses.push(options.includeAmbiguous
                ? `(dc.prefix = $${index} OR dc.prefix_ambiguous)`
                : `dc.prefix = $${index}`);
            params.push(options.didPrefix);
            index++;
        }

        if (receiptDid) {
            clauses.push(`dc.suffix = $${index++}`);
            params.push(getDIDSuffix(receiptDid));
        }

        if (options.attesterDid) {
            clauses.push(`cr.attester_suffix = $${index}`);
            params.push(getDIDSuffix(options.attesterDid));
            index++;
        }

        if (options.schemaDid) {
            clauses.push(`cr.schema_suffix = $${index}`);
            params.push(getDIDSuffix(options.schemaDid));
            index++;
        }

        if (options.requesterDid) {
            clauses.push(`cr.requester_suffix = $${index}`);
            params.push(getDIDSuffix(options.requesterDid));
            index++;
        }

        if (responseCommitment) {
            clauses.push(`cr.response_commitment = $${index++}`);
            params.push(responseCommitment);
        }

        if (options.updatedAfter) {
            clauses.push(`cr.updated_at >= $${index++}`);
            params.push(options.updatedAfter);
        }

        if (options.updatedBefore) {
            clauses.push(`cr.updated_at <= $${index++}`);
            params.push(options.updatedBefore);
        }

        return {
            where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
            params,
        };
    }

    private toJsonLiterals(values: unknown[]): string[] {
        return values.map((value) => {
            if (value === undefined) {
                return 'null';
            }

            const encoded = JSON.stringify(value);
            return encoded === undefined ? 'null' : encoded;
        });
    }

    private toPathTokens(path: string): string[] {
        const normalized = this.normalizePath(path);
        if (!normalized) {
            return [];
        }

        const tokens: string[] = [];
        const re = /([^[.\]]+)|\[(\d+)]/g;
        let match: RegExpExecArray | null = re.exec(normalized);

        while (match) {
            if (match[1]) {
                tokens.push(match[1]);
            }

            if (match[2]) {
                tokens.push(match[2]);
            }
            match = re.exec(normalized);
        }

        return tokens;
    }

    private normalizePath(path: string): string {
        if (!path || path === '$') {
            return '';
        }

        if (path.startsWith('$.')) {
            return path.slice(2);
        }

        if (path.startsWith('$')) {
            return path.slice(1).replace(/^\./, '');
        }

        return path;
    }
}
