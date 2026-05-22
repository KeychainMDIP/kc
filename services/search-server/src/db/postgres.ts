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
    DIDEventListOptions,
    DIDEventListResult,
    PublishedCredentialListOptions,
    PublishedCredentialListResult,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
    GatekeeperEvent,
} from '../types.js';
import { stableStringify } from './db-utils.js';

interface SyncStateRow {
    value: string;
}

interface DocRow {
    doc: object | string;
}

interface DidRow {
    did: string;
}

interface EventRow {
    event: GatekeeperEvent | string;
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
                schema_did TEXT NOT NULL,
                issuer_did TEXT NOT NULL,
                subject_did TEXT NOT NULL,
                revealed BOOLEAN,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (holder_did, credential_did)
            );

            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema
                ON published_credentials (schema_did);

            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema_issuer
                ON published_credentials (schema_did, issuer_did);

            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema_subject
                ON published_credentials (schema_did, subject_did);

            CREATE TABLE IF NOT EXISTS challenge_receipts (
                receipt_did TEXT PRIMARY KEY,
                attester_did TEXT NOT NULL,
                schema_did TEXT NOT NULL,
                requester_did TEXT NOT NULL,
                verified_at TEXT NOT NULL,
                response_commitment TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_attester
                ON challenge_receipts (attester_did);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_schema
                ON challenge_receipts (schema_did);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_requester
                ON challenge_receipts (requester_did);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_verified
                ON challenge_receipts (verified_at);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_commitment
                ON challenge_receipts (response_commitment);

            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
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
                    if ((deletion.rowCount ?? 0) > 0) {
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
                const changed = eventChanges.get(record.did) ?? false;

                if (!changed && !record.removed) {
                    continue;
                }

                result.changedDids.push(record.did);
                await client.query('DELETE FROM did_events WHERE did = $1', [record.did]);

                if (record.removed) {
                    await client.query('DELETE FROM did_docs WHERE did = $1', [record.did]);
                    await client.query('DELETE FROM published_credentials WHERE holder_did = $1', [record.did]);
                    await client.query('DELETE FROM challenge_receipts WHERE receipt_did = $1', [record.did]);
                    result.removedDids += 1;
                    continue;
                }

                for (const [index, event] of record.events.entries()) {
                    await client.query(
                        'INSERT INTO did_events (did, event_index, registry, time, event) VALUES ($1, $2, $3, $4, $5::jsonb)',
                        [record.did, index, event.registry, event.time, JSON.stringify(event)]
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

    async getPublishedCredentialCountsBySchema(): Promise<PublishedCredentialSchemaCount[]> {
        const pool = this.getPool();
        const result = await pool.query<PublishedCredentialSchemaCount>(
            `SELECT schema_did AS "schemaDid", COUNT(*)::int AS count
             FROM published_credentials
             GROUP BY schema_did
             ORDER BY count DESC, "schemaDid" ASC`
        );

        return result.rows;
    }

    async listPublishedCredentials(
        options: PublishedCredentialListOptions = {}
    ): Promise<PublishedCredentialListResult> {
        const pool = this.getPool();
        const {
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

        if (credentialDid) {
            clauses.push(`credential_did = $${index++}`);
            params.push(credentialDid);
        }

        if (schemaDid) {
            clauses.push(`schema_did = $${index++}`);
            params.push(schemaDid);
        }

        if (issuerDid) {
            clauses.push(`issuer_did = $${index++}`);
            params.push(issuerDid);
        }

        if (subjectDid) {
            clauses.push(`subject_did = $${index++}`);
            params.push(subjectDid);
        }

        if (typeof revealed === 'boolean') {
            clauses.push(`revealed = $${index++}`);
            params.push(revealed);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const totalResult = await pool.query<CountRow>(
            `SELECT COUNT(*)::int AS total
             FROM published_credentials
             ${where}`,
            params
        );

        const pageParams = [...params, Math.max(0, limit), Math.max(0, offset)];
        const limitParam = `$${pageParams.length - 1}`;
        const offsetParam = `$${pageParams.length}`;
        const result = await pool.query<PublishedCredentialRecord>(
            `SELECT
                holder_did AS "holderDid",
                credential_did AS "credentialDid",
                schema_did AS "schemaDid",
                issuer_did AS "issuerDid",
                subject_did AS "subjectDid",
                revealed AS "revealed",
                updated_at AS "updatedAt"
             FROM published_credentials
             ${where}
             ORDER BY updated_at DESC, credential_did ASC
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
             FROM challenge_receipts
             ${where}`,
            params
        );
        const pageParams = [...params, Math.max(0, limit), Math.max(0, offset)];
        const limitParam = `$${pageParams.length - 1}`;
        const offsetParam = `$${pageParams.length}`;
        const result = await pool.query<ChallengeReceiptRecord>(
            `SELECT
                receipt_did AS "receiptDid",
                attester_did AS "attesterDid",
                schema_did AS "schemaDid",
                requester_did AS "requesterDid",
                verified_at AS "verifiedAt",
                response_commitment AS "responseCommitment",
                updated_at AS "updatedAt"
             FROM challenge_receipts
             ${where}
             ORDER BY verified_at DESC, receipt_did ASC
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
                FROM challenge_receipts
                ${where}
                GROUP BY attester_did, schema_did, requester_did
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
            firstVerifiedAt: string;
            lastVerifiedAt: string;
        }>(
            `SELECT
                attester_did AS "attesterDid",
                schema_did AS "schemaDid",
                requester_did AS "requesterDid",
                COUNT(DISTINCT response_commitment)::int AS count,
                MIN(verified_at) AS "firstVerifiedAt",
                MAX(verified_at) AS "lastVerifiedAt"
             FROM challenge_receipts
             ${where}
             GROUP BY attester_did, schema_did, requester_did
             ORDER BY count DESC, schema_did ASC, requester_did ASC
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
            registry,
            updatedAfter,
            updatedBefore,
            limit = 50,
            offset = 0,
        } = options;
        const clauses: string[] = [];
        const params: unknown[] = [];
        let index = 1;

        if (registry) {
            clauses.push(`registry = $${index++}`);
            params.push(registry);
        }

        if (updatedAfter) {
            clauses.push(`time > $${index++}`);
            params.push(updatedAfter);
        }

        if (updatedBefore) {
            clauses.push(`time < $${index++}`);
            params.push(updatedBefore);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const totalResult = await pool.query<CountRow>(
            `SELECT COUNT(*)::int AS total FROM did_events ${where}`,
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
            `SELECT did, registry, time, event
             FROM did_events
             ${where}
             ORDER BY time DESC, did ASC, event_index ASC
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

    async searchDocs(q: string): Promise<string[]> {
        const pool = this.getPool();
        const result = await pool.query<DidRow>(
            `SELECT did
             FROM did_docs
             WHERE doc::text LIKE '%' || $1 || '%'`,
            [q]
        );

        return result.rows.map(row => row.did);
    }

    async queryDocs(where: Record<string, unknown>): Promise<string[]> {
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

        return result.rows.map(row => row.did);
    }

    async wipeDb(): Promise<void> {
        const pool = this.getPool();
        await pool.query('DELETE FROM did_docs');
        await pool.query('DELETE FROM did_events');
        await pool.query('DELETE FROM blocks');
        await pool.query('DELETE FROM published_credentials');
        await pool.query('DELETE FROM challenge_receipts');
        await pool.query('DELETE FROM sync_state');
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error('Postgres DB not connected');
        }

        return this.pool;
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

        for (const record of records) {
            await client.query(
                `INSERT INTO published_credentials (
                    holder_did,
                    credential_did,
                    schema_did,
                    issuer_did,
                    subject_did,
                    revealed,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (holder_did, credential_did) DO UPDATE SET
                    schema_did = EXCLUDED.schema_did,
                    issuer_did = EXCLUDED.issuer_did,
                    subject_did = EXCLUDED.subject_did,
                    revealed = EXCLUDED.revealed,
                    updated_at = EXCLUDED.updated_at`,
                [
                    record.holderDid,
                    record.credentialDid,
                    record.schemaDid,
                    record.issuerDid,
                    record.subjectDid,
                    record.revealed,
                    record.updatedAt,
                ]
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
                    schema_did,
                    requester_did,
                    verified_at,
                    response_commitment,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (receipt_did) DO UPDATE SET
                    attester_did = EXCLUDED.attester_did,
                    schema_did = EXCLUDED.schema_did,
                    requester_did = EXCLUDED.requester_did,
                    verified_at = EXCLUDED.verified_at,
                    response_commitment = EXCLUDED.response_commitment,
                    updated_at = EXCLUDED.updated_at`,
                [
                    record.receiptDid,
                    record.attesterDid,
                    record.schemaDid,
                    record.requesterDid,
                    record.verifiedAt,
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

        if (receiptDid) {
            clauses.push(`receipt_did = $${index++}`);
            params.push(receiptDid);
        }

        if (options.attesterDid) {
            clauses.push(`attester_did = $${index++}`);
            params.push(options.attesterDid);
        }

        if (options.schemaDid) {
            clauses.push(`schema_did = $${index++}`);
            params.push(options.schemaDid);
        }

        if (options.requesterDid) {
            clauses.push(`requester_did = $${index++}`);
            params.push(options.requesterDid);
        }

        if (responseCommitment) {
            clauses.push(`response_commitment = $${index++}`);
            params.push(responseCommitment);
        }

        if (options.verifiedAfter) {
            clauses.push(`verified_at >= $${index++}`);
            params.push(options.verifiedAfter);
        }

        if (options.verifiedBefore) {
            clauses.push(`verified_at <= $${index++}`);
            params.push(options.verifiedBefore);
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
