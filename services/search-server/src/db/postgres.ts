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
    NetworkMetricSnapshot,
    PublishedCredentialListOptions,
    PublishedCredentialListResult,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
    GatekeeperEvent,
} from '../types.js';
import { getEventDisplayTime, stableStringify } from './db-utils.js';
import {
    deduplicateDIDPrefixReferences,
    deduplicatePublishedCredentials,
} from '../published-credentials.js';
import {
    AMBIGUOUS_DID_PREFIX,
    classifyDIDPrefix,
    getDIDPrefix,
    getDIDSuffix,
    isAgentDID,
} from '../did-aliases.js';

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

export default class Postgres implements DIDsDb {
    private readonly url: string;
    private pool: Pool | null = null;
    private static readonly ARRAY_WILDCARD_END = /\[\*]$/;
    private static readonly ARRAY_WILDCARD_MID = /\[\*]\./;

    static async create<T extends DIDsDb>(
        this: new (url: string) => T,
        url: string
    ): Promise<T> {
        const db = new this(url);
        await db.connect();
        return db;
    }

    constructor(url: string) {
        this.url = url;
    }

    async connect(): Promise<void> {
        if (this.pool) {
            return;
        }

        this.pool = this.createPool();

        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS did_events (
                did TEXT NOT NULL,
                event_index INTEGER NOT NULL,
                registry TEXT NOT NULL,
                time TEXT NOT NULL,
                event JSONB NOT NULL,
                PRIMARY KEY (did, event_index)
            );

            CREATE INDEX IF NOT EXISTS idx_did_events_did
                ON did_events (did);

            CREATE INDEX IF NOT EXISTS idx_did_events_registry_time
                ON did_events (registry, time);

            CREATE TABLE IF NOT EXISTS did_classifications (
                suffix TEXT PRIMARY KEY,
                did TEXT NOT NULL UNIQUE,
                prefix TEXT NOT NULL,
                prefix_authoritative BOOLEAN NOT NULL,
                is_agent BOOLEAN NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_did_classifications_prefix
                ON did_classifications (prefix);

            CREATE TABLE IF NOT EXISTS did_docs (
                did TEXT PRIMARY KEY,
                doc JSONB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blocks (
                registry TEXT NOT NULL,
                hash TEXT NOT NULL,
                height INTEGER NOT NULL,
                time INTEGER NOT NULL,
                block JSONB NOT NULL,
                PRIMARY KEY (registry, hash)
            );

            CREATE INDEX IF NOT EXISTS idx_blocks_registry_height
                ON blocks (registry, height);

            CREATE TABLE IF NOT EXISTS published_credentials (
                holder_did TEXT NOT NULL,
                credential_did TEXT NOT NULL,
                credential_suffix TEXT NOT NULL,
                credential_prefix TEXT NOT NULL,
                schema_did TEXT NOT NULL,
                schema_suffix TEXT NOT NULL,
                schema_prefix TEXT NOT NULL,
                issuer_did TEXT NOT NULL,
                subject_did TEXT NOT NULL,
                revealed BOOLEAN,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (holder_did, credential_suffix)
            );

            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema
                ON published_credentials (schema_did);

            CREATE INDEX IF NOT EXISTS idx_published_credentials_suffixes
                ON published_credentials (credential_suffix, schema_suffix);

            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema_issuer
                ON published_credentials (schema_did, issuer_did);

            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema_subject
                ON published_credentials (schema_did, subject_did);

            CREATE TABLE IF NOT EXISTS did_prefix_references (
                source_did TEXT NOT NULL,
                suffix TEXT NOT NULL,
                prefix TEXT NOT NULL,
                PRIMARY KEY (source_did, suffix, prefix)
            );

            CREATE INDEX IF NOT EXISTS idx_did_prefix_references_suffix_prefix
                ON did_prefix_references (suffix, prefix);

            CREATE OR REPLACE VIEW did_reference_prefixes AS
                SELECT suffix,
                       CASE WHEN MIN(prefix) = MAX(prefix)
                           THEN MIN(prefix)
                           ELSE '${AMBIGUOUS_DID_PREFIX}'
                       END AS prefix
                FROM did_prefix_references
                GROUP BY suffix;

            CREATE OR REPLACE VIEW did_classifications_effective AS
                SELECT dc.suffix,
                       dc.did,
                       CASE WHEN dc.prefix_authoritative OR dc.is_agent THEN dc.prefix
                           ELSE COALESCE(rp.prefix, '${AMBIGUOUS_DID_PREFIX}')
                       END AS prefix
                FROM did_classifications dc
                LEFT JOIN did_reference_prefixes rp ON rp.suffix = dc.suffix;

            CREATE OR REPLACE VIEW published_credentials_classified AS
                SELECT pc.*,
                       CASE WHEN cc.prefix_authoritative OR cc.is_agent THEN cc.prefix ELSE cr.prefix END AS credential_effective_prefix,
                       CASE WHEN sc.prefix_authoritative OR sc.is_agent THEN sc.prefix ELSE sr.prefix END AS schema_effective_prefix
                FROM published_credentials pc
                LEFT JOIN did_classifications cc ON cc.suffix = pc.credential_suffix
                LEFT JOIN did_classifications sc ON sc.suffix = pc.schema_suffix
                JOIN did_reference_prefixes cr ON cr.suffix = pc.credential_suffix
                JOIN did_reference_prefixes sr ON sr.suffix = pc.schema_suffix;

            CREATE TABLE IF NOT EXISTS challenge_receipts (
                receipt_did TEXT PRIMARY KEY,
                attester_did TEXT NOT NULL,
                attester_suffix TEXT NOT NULL,
                schema_did TEXT NOT NULL,
                schema_suffix TEXT NOT NULL,
                requester_did TEXT NOT NULL,
                requester_suffix TEXT NOT NULL,
                response_commitment TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_attester
                ON challenge_receipts (attester_suffix);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_schema
                ON challenge_receipts (schema_suffix);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_requester
                ON challenge_receipts (requester_suffix);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_commitment
                ON challenge_receipts (response_commitment);

            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS network_metric_snapshots (
                snapshot_date TEXT PRIMARY KEY,
                did_count INTEGER NOT NULL CHECK (did_count >= 0),
                did_counts_by_prefix JSONB NOT NULL DEFAULT '{}'::jsonb,
                agent_did_count INTEGER NOT NULL CHECK (agent_did_count >= 0),
                agent_did_counts_by_prefix JSONB NOT NULL DEFAULT '{}'::jsonb,
                credential_count INTEGER NOT NULL CHECK (credential_count >= 0),
                credential_did_counts_by_prefix JSONB NOT NULL DEFAULT '{}'::jsonb,
                schema_counts JSONB NOT NULL DEFAULT '[]'::jsonb,
                rebuilt_at TEXT NOT NULL
            );
        `);

        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema_revealed
                ON published_credentials (schema_did, revealed)
        `);
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    async loadSyncState(key: string): Promise<string | null> {
        const pool = this.getPool();
        const result = await pool.query<SyncStateRow>(
            'SELECT value FROM sync_state WHERE key = $1 LIMIT 1',
            [key]
        );

        if (result.rowCount === 0) {
            return null;
        }

        return result.rows[0].value;
    }

    async saveSyncState(key: string, value: string | null): Promise<void> {
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
    }

    async getDIDEvents(did: string): Promise<GatekeeperEvent[]> {
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
    }

    async findDIDBySuffix(suffix: string, didPrefix?: string): Promise<string | null> {
        const prefixFilter = didPrefix ? 'AND prefix = $2' : '';
        const result = await this.getPool().query<DidRow>(
            `SELECT did FROM did_classifications_effective
             WHERE suffix = $1 ${prefixFilter}
             LIMIT 1`,
            didPrefix ? [suffix, didPrefix] : [suffix]
        );
        return result.rows[0]?.did ?? null;
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
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
    }

    async applyIndexPage(page: ApplyIndexPageOptions): Promise<ApplyIndexPageResult> {
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

        const pool = this.getPool();
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

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

                await client.query(
                    `INSERT INTO blocks (registry, hash, height, time, block)
                     VALUES ($1, $2, $3, $4, $5::jsonb)
                     ON CONFLICT (registry, hash) DO UPDATE SET
                        height = EXCLUDED.height,
                        time = EXCLUDED.time,
                        block = EXCLUDED.block`,
                    [registry, block.hash, block.height, block.time, JSON.stringify(block)]
                );
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
                    await client.query('DELETE FROM did_prefix_references WHERE source_did = $1', [record.did]);
                    await client.query('DELETE FROM challenge_receipts WHERE receipt_did = $1', [record.did]);
                    await client.query('DELETE FROM did_classifications WHERE suffix = $1', [suffix]);
                    result.removedDids += 1;
                    continue;
                }

                const classification = classifyDIDPrefix(record.events);
                await client.query(
                    `INSERT INTO did_classifications (suffix, did, prefix, prefix_authoritative, is_agent) VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (suffix) DO UPDATE SET
                        did = EXCLUDED.did,
                        prefix = EXCLUDED.prefix,
                        prefix_authoritative = EXCLUDED.prefix_authoritative,
                        is_agent = EXCLUDED.is_agent`,
                    [suffix, record.did, classification.prefix, classification.authoritative, isAgentDID(record.events)]
                );

                for (const [index, event] of record.events.entries()) {
                    await client.query(
                        'INSERT INTO did_events (did, event_index, registry, time, event) VALUES ($1, $2, $3, $4, $5::jsonb)',
                        [record.did, index, event.registry, getEventDisplayTime(event), JSON.stringify(event)]
                    );
                }

                if (record.doc) {
                    await client.query(
                        `INSERT INTO did_docs (did, doc) VALUES ($1, $2::jsonb)
                         ON CONFLICT (did) DO UPDATE SET doc = EXCLUDED.doc`,
                        [record.did, JSON.stringify(record.doc)]
                    );
                }

                await this.replacePublishedCredentialsWithClient(
                    client,
                    record.did,
                    record.publishedCredentials ?? []
                );
                await this.replaceDIDPrefixReferencesWithClient(
                    client,
                    record.did,
                    record.didPrefixReferences ?? [],
                    record.publishedCredentials ?? []
                );
                await this.replaceChallengeReceiptsWithClient(
                    client,
                    record.did,
                    record.challengeReceipts ?? []
                );
            }

            for (const [key, value] of Object.entries(page.syncStateUpdates ?? {})) {
                if (value === null) {
                    await client.query('DELETE FROM sync_state WHERE key = $1', [key]);
                    continue;
                }

                await client.query(
                    `INSERT INTO sync_state (key, value) VALUES ($1, $2)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    [key, value]
                );
            }

            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }

    async getDID(did: string): Promise<object | null> {
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
    }

    async getPublishedCredentialCountsBySchema(didPrefix?: string): Promise<PublishedCredentialSchemaCount[]> {
        const pool = this.getPool();
        const result = await pool.query<PublishedCredentialSchemaCount>(
            `SELECT pc.schema_effective_prefix || ':' || pc.schema_suffix AS "schemaDid",
                    COUNT(*)::int AS count
             FROM published_credentials_classified pc
             ${didPrefix ? `WHERE pc.credential_effective_prefix = $1
                AND pc.schema_effective_prefix = $1` : ''}
             GROUP BY "schemaDid"
             ORDER BY count DESC, "schemaDid" ASC`,
            didPrefix ? [didPrefix] : []
        );

        return result.rows;
    }

    async listPublishedCredentials(
        options: PublishedCredentialListOptions = {}
    ): Promise<PublishedCredentialListResult> {
        const pool = this.getPool();
        const {
            didPrefix,
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
            clauses.push(`pc.credential_effective_prefix = $${index++}`);
            params.push(didPrefix);
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
        const result = await pool.query<PublishedCredentialRecord>(
            `SELECT
                pc.holder_did AS "holderDid",
                pc.credential_effective_prefix || ':' || pc.credential_suffix AS "credentialDid",
                pc.schema_effective_prefix || ':' || pc.schema_suffix AS "schemaDid",
                pc.issuer_did AS "issuerDid",
                pc.subject_did AS "subjectDid",
                pc.revealed AS "revealed",
                pc.updated_at AS "updatedAt"
             FROM published_credentials_classified pc
             ${where}
             ORDER BY pc.updated_at DESC, "credentialDid" ASC
             LIMIT ${limitParam} OFFSET ${offsetParam}`,
            pageParams
        );

        return {
            total: totalResult.rows[0]?.total ?? 0,
            credentials: result.rows,
        };
    }

    async listChallengeReceipts(
        options: ChallengeReceiptListOptions = {}
    ): Promise<ChallengeReceiptListResult> {
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
        const result = await pool.query<ChallengeReceiptRecord>(
            `SELECT
                dc.prefix || ':' || dc.suffix AS "receiptDid",
                cr.attester_did AS "attesterDid",
                cr.schema_did AS "schemaDid",
                cr.requester_did AS "requesterDid",
                cr.response_commitment AS "responseCommitment",
                cr.updated_at AS "updatedAt"
             FROM challenge_receipts cr
             JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
             ${where}
             ORDER BY cr.updated_at DESC, "receiptDid" ASC
             LIMIT ${limitParam} OFFSET ${offsetParam}`,
            pageParams
        );

        return {
            total: totalResult.rows[0]?.total ?? 0,
            receipts: result.rows,
        };
    }

    async getChallengeReceiptUsage(
        options: ChallengeReceiptUsageOptions = {}
    ): Promise<ChallengeReceiptUsageResult> {
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
    }

    async listEvents(options: DIDEventListOptions = {}): Promise<DIDEventListResult> {
        const pool = this.getPool();
        const {
            didPrefix,
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
            clauses.push(`dc.prefix = $${index++}`);
            params.push(didPrefix);
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
        }>(
            `SELECT dc.prefix || ':' || dc.suffix AS did,
                    e.registry,
                    e.time,
                    e.event
             FROM did_events e
             JOIN did_classifications_effective dc ON dc.did = e.did
             ${where}
             ORDER BY e.time DESC, did ASC, e.event_index ASC
             LIMIT ${limitParam} OFFSET ${offsetParam}`,
            pageParams
        );

        return {
            total: totalResult.rows[0]?.total ?? 0,
            events: result.rows.map(row => ({
                did: row.did,
                registry: row.registry,
                time: row.time,
                event: typeof row.event === 'string'
                    ? JSON.parse(row.event) as GatekeeperEvent
                    : row.event,
            })),
        };
    }

    async *iterateDIDEventHistories(pageSize = 500): AsyncIterable<DIDEventHistory> {
        const pool = this.getPool();
        const limit = Math.max(1, pageSize);
        let cursorDid: string | null = null;
        let cursorIndex = -1;
        let currentDid: string | null = null;
        let currentEvents: GatekeeperEvent[] = [];

        while (true) {
            const result: { rows: HistoryEventRow[] } = cursorDid === null
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
        const client = await this.getPool().connect();
        try {
            await client.query('BEGIN');
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
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }

    async getNetworkMetricSnapshot(date: string): Promise<NetworkMetricSnapshot | null> {
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
    }

    async searchDocs(q: string, didPrefix?: string): Promise<string[]> {
        const pool = this.getPool();
        const result = await pool.query<DidRow>(
            `SELECT dc.prefix || ':' || dc.suffix AS did
             FROM did_docs d
             JOIN did_classifications_effective dc ON dc.did = d.did
             WHERE d.doc::text LIKE '%' || $1 || '%'
             ${didPrefix ? 'AND dc.prefix = $2' : ''}`,
            didPrefix ? [q, didPrefix] : [q]
        );

        return result.rows.map(row => row.did);
    }

    async queryDocs(where: Record<string, unknown>, didPrefix?: string): Promise<string[]> {
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

        return this.effectiveDIDs(result.rows.map(row => row.did), didPrefix);
    }

    async wipeDb(): Promise<void> {
        const pool = this.getPool();
        await pool.query('DELETE FROM did_docs');
        await pool.query('DELETE FROM did_events');
        await pool.query('DELETE FROM did_classifications');
        await pool.query('DELETE FROM blocks');
        await pool.query('DELETE FROM published_credentials');
        await pool.query('DELETE FROM did_prefix_references');
        await pool.query('DELETE FROM challenge_receipts');
        await pool.query('DELETE FROM network_metric_snapshots');
        await pool.query('DELETE FROM sync_state');
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error('Postgres DB not connected');
        }

        return this.pool;
    }

    private async effectiveDIDs(dids: string[], didPrefix?: string): Promise<string[]> {
        const result = await this.getPool().query<EffectiveDidRow>(
            `SELECT did AS "storedDid", prefix || ':' || suffix AS did
             FROM did_classifications_effective
             WHERE did = ANY($1::text[])
             ${didPrefix ? 'AND prefix = $2' : ''}`,
            didPrefix ? [dids, didPrefix] : [dids]
        );
        const effectiveByStored = new Map(result.rows.map(row => [row.storedDid, row.did]));
        return dids.flatMap(did => {
            const effectiveDid = effectiveByStored.get(did);
            return effectiveDid ? [effectiveDid] : [];
        });
    }

    protected createPool(): Pool {
        return new Pool({ connectionString: this.url });
    }

    private async replacePublishedCredentialsWithClient(
        client: PoolClient,
        holderDid: string,
        records: PublishedCredentialRecord[]
    ): Promise<void> {
        await client.query(
            'DELETE FROM published_credentials WHERE holder_did = $1',
            [holderDid]
        );

        for (const record of deduplicatePublishedCredentials(records)) {
            await client.query(
                `INSERT INTO published_credentials (
                    holder_did,
                    credential_did,
                    credential_suffix,
                    credential_prefix,
                    schema_did,
                    schema_suffix,
                    schema_prefix,
                    issuer_did,
                    subject_did,
                    revealed,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (holder_did, credential_suffix) DO UPDATE SET
                    credential_did = EXCLUDED.credential_did,
                    credential_suffix = EXCLUDED.credential_suffix,
                    credential_prefix = EXCLUDED.credential_prefix,
                    schema_did = EXCLUDED.schema_did,
                    schema_suffix = EXCLUDED.schema_suffix,
                    schema_prefix = EXCLUDED.schema_prefix,
                    issuer_did = EXCLUDED.issuer_did,
                    subject_did = EXCLUDED.subject_did,
                    revealed = EXCLUDED.revealed,
                    updated_at = EXCLUDED.updated_at`,
                [
                    record.holderDid,
                    record.credentialDid,
                    getDIDSuffix(record.credentialDid),
                    getDIDPrefix(record.credentialDid),
                    record.schemaDid,
                    getDIDSuffix(record.schemaDid),
                    getDIDPrefix(record.schemaDid),
                    record.issuerDid,
                    record.subjectDid,
                    record.revealed,
                    record.updatedAt,
                ]
            );
        }
    }

    private async replaceDIDPrefixReferencesWithClient(
        client: PoolClient,
        sourceDid: string,
        references: string[],
        publishedCredentials: PublishedCredentialRecord[]
    ): Promise<void> {
        await client.query('DELETE FROM did_prefix_references WHERE source_did = $1', [sourceDid]);

        for (const did of deduplicateDIDPrefixReferences(references, publishedCredentials)) {
            await client.query(
                'INSERT INTO did_prefix_references (source_did, suffix, prefix) VALUES ($1, $2, $3)',
                [sourceDid, getDIDSuffix(did), getDIDPrefix(did)]
            );
        }
    }

    private async replaceChallengeReceiptsWithClient(
        client: PoolClient,
        receiptDid: string,
        records: ChallengeReceiptRecord[]
    ): Promise<void> {
        await client.query(
            'DELETE FROM challenge_receipts WHERE receipt_did = $1',
            [receiptDid]
        );

        for (const record of records) {
            await client.query(
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
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (receipt_did) DO UPDATE SET
                    attester_did = EXCLUDED.attester_did,
                    attester_suffix = EXCLUDED.attester_suffix,
                    schema_did = EXCLUDED.schema_did,
                    schema_suffix = EXCLUDED.schema_suffix,
                    requester_did = EXCLUDED.requester_did,
                    requester_suffix = EXCLUDED.requester_suffix,
                    response_commitment = EXCLUDED.response_commitment,
                    updated_at = EXCLUDED.updated_at`,
                [
                    record.receiptDid,
                    record.attesterDid,
                    getDIDSuffix(record.attesterDid),
                    record.schemaDid,
                    getDIDSuffix(record.schemaDid),
                    record.requesterDid,
                    getDIDSuffix(record.requesterDid),
                    record.responseCommitment,
                    record.updatedAt,
                ]
            );
        }
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
            clauses.push(`dc.prefix = $${index++}`);
            params.push(options.didPrefix);
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
