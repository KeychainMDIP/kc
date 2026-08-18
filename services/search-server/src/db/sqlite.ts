import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
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
} from "../types.js";
import { getEventDisplayTime, stableStringify } from './db-utils.js';
import { deduplicateDIDPrefixReferences } from '../published-credentials.js';
import {
    AMBIGUOUS_DID_PREFIX,
    classifyDIDPrefix,
    getDIDPrefix,
    getDIDSuffix,
    isAgentDID,
} from '../did-aliases.js';

interface HistoryEventRow {
    did: string;
    eventIndex: number;
    event: string;
}

export default class Sqlite implements DIDsDb {
    private readonly dbFile: string;
    private db: Database | null = null;
    private static readonly ARRAY_WILDCARD_END = /\[\*]$/;
    private static readonly ARRAY_WILDCARD_MID = /\[\*]\./;

    static async create(dbFileName: string = 'dids.db', dataFolder: string = 'data'): Promise<DIDsDb> {
        const db = new Sqlite(dbFileName, dataFolder);
        await db.connect();
        return db;
    }

    constructor(dbFileName: string = 'dids.db', dataFolder: string = 'data') {
        this.dbFile = `${dataFolder}/${dbFileName}`;
    }

    async connect(): Promise<void> {
        if (this.db) {
            return;
        }

        this.db = await open({
            filename: this.dbFile,
            driver: sqlite3.Database
        });

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS did_events (
                did TEXT NOT NULL,
                event_index INTEGER NOT NULL,
                registry TEXT NOT NULL,
                time TEXT NOT NULL,
                event TEXT NOT NULL,
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
                prefix_authoritative INTEGER NOT NULL,
                is_agent INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_did_classifications_prefix
                ON did_classifications (prefix);

            CREATE TABLE IF NOT EXISTS did_docs (
                                                    did TEXT PRIMARY KEY,
                                                    doc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blocks (
                registry TEXT NOT NULL,
                hash TEXT NOT NULL,
                height INTEGER NOT NULL,
                time INTEGER NOT NULL,
                block TEXT NOT NULL,
                PRIMARY KEY (registry, hash)
            );

            CREATE INDEX IF NOT EXISTS idx_blocks_registry_height
                ON blocks (registry, height);

            CREATE TABLE IF NOT EXISTS published_credentials (
                holder_did TEXT NOT NULL,
                credential_suffix TEXT NOT NULL,
                schema_suffix TEXT NOT NULL,
                issuer_did TEXT NOT NULL,
                subject_did TEXT NOT NULL,
                revealed INTEGER,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (holder_did, credential_suffix)
            );

            CREATE INDEX IF NOT EXISTS idx_published_credentials_suffixes
                ON published_credentials (credential_suffix, schema_suffix);

            CREATE TABLE IF NOT EXISTS did_prefix_references (
                source_did TEXT NOT NULL,
                suffix TEXT NOT NULL,
                prefix TEXT NOT NULL,
                PRIMARY KEY (source_did, suffix, prefix)
            );

            CREATE INDEX IF NOT EXISTS idx_did_prefix_references_suffix_prefix
                ON did_prefix_references (suffix, prefix);

            CREATE VIEW IF NOT EXISTS did_reference_prefixes AS
                SELECT suffix,
                       CASE WHEN MIN(prefix) = MAX(prefix)
                           THEN MIN(prefix)
                           ELSE '${AMBIGUOUS_DID_PREFIX}'
                       END AS prefix
                FROM did_prefix_references
                GROUP BY suffix;

            CREATE VIEW IF NOT EXISTS did_classifications_effective AS
                SELECT dc.suffix,
                       dc.did,
                       CASE WHEN dc.prefix_authoritative OR dc.is_agent THEN dc.prefix
                           ELSE COALESCE(rp.prefix, '${AMBIGUOUS_DID_PREFIX}')
                       END AS prefix
                FROM did_classifications dc
                LEFT JOIN did_reference_prefixes rp ON rp.suffix = dc.suffix;

            CREATE VIEW IF NOT EXISTS published_credentials_classified AS
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
                did_counts_by_prefix TEXT NOT NULL DEFAULT '{}',
                agent_did_count INTEGER NOT NULL CHECK (agent_did_count >= 0),
                agent_did_counts_by_prefix TEXT NOT NULL DEFAULT '{}',
                credential_count INTEGER NOT NULL CHECK (credential_count >= 0),
                credential_did_counts_by_prefix TEXT NOT NULL DEFAULT '{}',
                schema_counts TEXT NOT NULL DEFAULT '[]',
                rebuilt_at TEXT NOT NULL
            );
        `);
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }

    async loadSyncState(key: string): Promise<string | null> {
        if (!this.db) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new Error('DB not connected');
        }
        const row = await this.db.get<{ value: string }>(
            'SELECT value FROM sync_state WHERE key = ?',
            [key]
        );
        if (!row) {
            return null;
        }
        return row.value;
    }

    async saveSyncState(key: string, value: string | null): Promise<void> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        if (value === null) {
            await this.db.run('DELETE FROM sync_state WHERE key = ?', [key]);
            return;
        }

        await this.db.run(`
            INSERT INTO sync_state (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `, [key, value]);
    }

    async getDIDEvents(did: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const rows = await this.db.all<{ event: string }[]>(
            'SELECT event FROM did_events WHERE did = ? ORDER BY event_index ASC',
            [did]
        );

        return rows.map(row => JSON.parse(row.event) as GatekeeperEvent);
    }

    async findDIDBySuffix(suffix: string, didPrefix?: string): Promise<string | null> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const prefixFilter = didPrefix ? 'AND prefix = ?' : '';
        const row = await this.db.get<{ did: string }>(
            `SELECT did FROM did_classifications_effective
             WHERE suffix = ? ${prefixFilter}
             LIMIT 1`,
            didPrefix ? [suffix, didPrefix] : [suffix]
        );
        return row?.did ?? null;
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        let row: { block: string } | undefined;

        if (blockId === undefined) {
            row = await this.db.get<{ block: string }>(
                'SELECT block FROM blocks WHERE registry = ? ORDER BY height DESC LIMIT 1',
                [registry]
            );
        }
        else if (typeof blockId === 'number') {
            row = await this.db.get<{ block: string }>(
                'SELECT block FROM blocks WHERE registry = ? AND height = ? LIMIT 1',
                [registry, blockId]
            );
        }
        else {
            row = await this.db.get<{ block: string }>(
                'SELECT block FROM blocks WHERE registry = ? AND hash = ? LIMIT 1',
                [registry, blockId]
            );
        }

        return row ? JSON.parse(row.block) as BlockInfo : null;
    }

    async applyIndexPage(page: ApplyIndexPageOptions): Promise<ApplyIndexPageResult> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

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

        await this.db.exec('BEGIN');

        try {
            for (const { registry, block, removed } of page.blocks) {
                if (removed) {
                    const deletion = await this.db.run(
                        'DELETE FROM blocks WHERE registry = ? AND hash = ?',
                        [registry, block.hash]
                    );
                    if (Number(deletion.changes) > 0) {
                        result.removedBlocks += 1;
                    }
                    continue;
                }

                await this.db.run(`
                    INSERT INTO blocks (registry, hash, height, time, block)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(registry, hash) DO UPDATE SET
                        height = excluded.height,
                        time = excluded.time,
                        block = excluded.block
                `, [registry, block.hash, block.height, block.time, JSON.stringify(block)]);
                result.storedBlocks += 1;
            }

            for (const record of page.dids) {
                const suffix = getDIDSuffix(record.did);
                const previous = await this.db.get<{ did: string }>(
                    'SELECT did FROM did_classifications WHERE suffix = ?',
                    [suffix]
                );
                if (previous && previous.did !== record.did) {
                    await this.db.run('DELETE FROM did_events WHERE did = ?', [previous.did]);
                    await this.db.run('DELETE FROM did_docs WHERE did = ?', [previous.did]);
                    await this.db.run('DELETE FROM published_credentials WHERE holder_did = ?', [previous.did]);
                    await this.db.run('DELETE FROM did_prefix_references WHERE source_did = ?', [previous.did]);
                    await this.db.run('DELETE FROM challenge_receipts WHERE receipt_did = ?', [previous.did]);
                    await this.db.run('DELETE FROM did_classifications WHERE suffix = ?', [suffix]);
                }

                const changed = eventChanges.get(record.did) === true;

                if (!changed && !record.removed) {
                    continue;
                }

                result.changedDids.push(record.did);
                await this.db.run('DELETE FROM did_events WHERE did = ?', [record.did]);

                if (record.removed) {
                    await this.db.run('DELETE FROM did_docs WHERE did = ?', [record.did]);
                    await this.db.run('DELETE FROM published_credentials WHERE holder_did = ?', [record.did]);
                    await this.db.run('DELETE FROM did_prefix_references WHERE source_did = ?', [record.did]);
                    await this.db.run('DELETE FROM challenge_receipts WHERE receipt_did = ?', [record.did]);
                    await this.db.run('DELETE FROM did_classifications WHERE suffix = ?', [suffix]);
                    result.removedDids += 1;
                    continue;
                }

                const classification = classifyDIDPrefix(record.events);
                await this.db.run(`
                    INSERT INTO did_classifications (suffix, did, prefix, prefix_authoritative, is_agent) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(suffix) DO UPDATE SET
                        did=excluded.did,
                        prefix=excluded.prefix,
                        prefix_authoritative=excluded.prefix_authoritative,
                        is_agent=excluded.is_agent
                `, [suffix, record.did, classification.prefix, classification.authoritative ? 1 : 0, isAgentDID(record.events) ? 1 : 0]);

                for (const [index, event] of record.events.entries()) {
                    await this.db.run(
                        'INSERT INTO did_events (did, event_index, registry, time, event) VALUES (?, ?, ?, ?, ?)',
                        [record.did, index, event.registry, getEventDisplayTime(event), JSON.stringify(event)]
                    );
                }

                if (record.doc) {
                    await this.db.run(`
                        INSERT INTO did_docs (did, doc) VALUES (?, ?)
                            ON CONFLICT(did) DO UPDATE SET doc=excluded.doc
                    `, [record.did, JSON.stringify(record.doc)]);
                }

                await this.replacePublishedCredentialsInTx(record.did, record.publishedCredentials ?? []);
                await this.replaceDIDPrefixReferencesInTx(
                    record.did,
                    record.didPrefixReferences ?? [],
                    record.publishedCredentials ?? []
                );
                await this.replaceChallengeReceiptsInTx(record.did, record.challengeReceipts ?? []);
            }

            for (const [key, value] of Object.entries(page.syncStateUpdates ?? {})) {
                if (value === null) {
                    await this.db.run('DELETE FROM sync_state WHERE key = ?', [key]);
                    continue;
                }

                await this.db.run(`
                    INSERT INTO sync_state (key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value=excluded.value
                `, [key, value]);
            }

            await this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            await this.db.exec('ROLLBACK');
            throw error;
        }
    }

    async getDID(did: string): Promise<object | null> {
        if (!this.db) {
            throw new Error('DB not connected');
        }
        const row = await this.db.get('SELECT doc FROM did_docs WHERE did = ?', [did]);
        if (!row) {
            return null;
        }
        return JSON.parse(row.doc);
    }

    async getPublishedCredentialCountsBySchema(didPrefix?: string): Promise<PublishedCredentialSchemaCount[]> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const rows = await this.db.all<PublishedCredentialSchemaCount[]>(`
            SELECT pc.schema_effective_prefix || ':' || pc.schema_suffix AS schemaDid,
                   COUNT(*) AS count
            FROM published_credentials_classified pc
            ${didPrefix ? `WHERE pc.credential_effective_prefix = ?
                AND pc.schema_effective_prefix = ?` : ''}
            GROUP BY schemaDid
            ORDER BY count DESC, schemaDid ASC
        `, didPrefix ? [didPrefix, didPrefix] : []);

        return rows.map(row => ({
            schemaDid: row.schemaDid,
            count: Number(row.count),
        }));
    }

    async listPublishedCredentials(
        options: PublishedCredentialListOptions = {}
    ): Promise<PublishedCredentialListResult> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

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

        if (didPrefix) {
            clauses.push('pc.credential_effective_prefix = ?');
            params.push(didPrefix);
        }

        if (credentialDid) {
            clauses.push('pc.credential_suffix = ?');
            params.push(getDIDSuffix(credentialDid));
        }

        if (schemaDid) {
            clauses.push('pc.schema_suffix = ?');
            params.push(getDIDSuffix(schemaDid));
        }

        if (issuerDid) {
            clauses.push("substr(pc.issuer_did, -(length(?) + 1)) = ':' || ?");
            const suffix = getDIDSuffix(issuerDid);
            params.push(suffix, suffix);
        }

        if (subjectDid) {
            clauses.push(`pc.subject_did = (
                SELECT did FROM did_classifications WHERE suffix = ?
            )`);
            params.push(getDIDSuffix(subjectDid));
        }

        if (typeof revealed === 'boolean') {
            clauses.push('pc.revealed = ?');
            params.push(revealed ? 1 : 0);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

        const totalRow = await this.db.get<{ total: number | string }>(
            `SELECT COUNT(*) AS total
             FROM published_credentials_classified pc
             ${where}`,
            params
        );

        const rows = await this.db.all<{
            holderDid: string;
            credentialDid: string;
            schemaDid: string;
            issuerDid: string;
            subjectDid: string;
            revealed: number | null;
            updatedAt: string;
        }[]>(
            `SELECT
                pc.holder_did AS holderDid,
                pc.credential_effective_prefix || ':' || pc.credential_suffix AS credentialDid,
                pc.schema_effective_prefix || ':' || pc.schema_suffix AS schemaDid,
                pc.issuer_did AS issuerDid,
                pc.subject_did AS subjectDid,
                pc.revealed AS revealed,
                pc.updated_at AS updatedAt
             FROM published_credentials_classified pc
             ${where}
             ORDER BY pc.updated_at DESC, credentialDid ASC
             LIMIT ? OFFSET ?`,
            [...params, Math.max(0, limit), Math.max(0, offset)]
        );

        return {
            total: Number(totalRow?.total ?? 0),
            credentials: rows.map(row => ({
                holderDid: row.holderDid,
                credentialDid: row.credentialDid,
                schemaDid: row.schemaDid,
                issuerDid: row.issuerDid,
                subjectDid: row.subjectDid,
                revealed: row.revealed === 1,
                updatedAt: row.updatedAt,
            })),
        };
    }

    async listChallengeReceipts(
        options: ChallengeReceiptListOptions = {}
    ): Promise<ChallengeReceiptListResult> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const {
            limit = 50,
            offset = 0,
        } = options;
        const { where, params } = this.buildChallengeReceiptWhere(options);
        const totalRow = await this.db.get<{ total: number | string }>(
            `SELECT COUNT(*) AS total
             FROM challenge_receipts cr
             JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
             ${where}`,
            params
        );
        const rows = await this.db.all<{
            receiptDid: string;
            attesterDid: string;
            schemaDid: string;
            requesterDid: string;
            responseCommitment: string;
            updatedAt: string;
        }[]>(
            `SELECT
                dc.prefix || ':' || dc.suffix AS receiptDid,
                cr.attester_did AS attesterDid,
                cr.schema_did AS schemaDid,
                cr.requester_did AS requesterDid,
                cr.response_commitment AS responseCommitment,
                cr.updated_at AS updatedAt
             FROM challenge_receipts cr
             JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
             ${where}
             ORDER BY cr.updated_at DESC, receiptDid ASC
             LIMIT ? OFFSET ?`,
            [...params, Math.max(0, limit), Math.max(0, offset)]
        );

        return {
            total: Number(totalRow?.total ?? 0),
            receipts: rows.map(row => ({
                receiptDid: row.receiptDid,
                attesterDid: row.attesterDid,
                schemaDid: row.schemaDid,
                requesterDid: row.requesterDid,
                responseCommitment: row.responseCommitment,
                updatedAt: row.updatedAt,
            })),
        };
    }

    async getChallengeReceiptUsage(
        options: ChallengeReceiptUsageOptions = {}
    ): Promise<ChallengeReceiptUsageResult> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const {
            limit = 50,
            offset = 0,
        } = options;
        const { where, params } = this.buildChallengeReceiptWhere(options);
        const totalRow = await this.db.get<{ total: number | string }>(
            `SELECT COUNT(*) AS total
             FROM (
                SELECT 1
                FROM challenge_receipts cr
                JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
                ${where}
                GROUP BY cr.attester_suffix, cr.schema_suffix, cr.requester_suffix
             )`,
            params
        );
        const rows = await this.db.all<{
            attesterDid: string;
            schemaDid: string;
            requesterDid: string;
            count: number | string;
            firstUpdatedAt: string;
            lastUpdatedAt: string;
        }[]>(
            `SELECT
                MIN(cr.attester_did) AS attesterDid,
                MIN(cr.schema_did) AS schemaDid,
                MIN(cr.requester_did) AS requesterDid,
                COUNT(DISTINCT cr.response_commitment) AS count,
                MIN(cr.updated_at) AS firstUpdatedAt,
                MAX(cr.updated_at) AS lastUpdatedAt
             FROM challenge_receipts cr
             JOIN did_classifications_effective dc ON dc.did = cr.receipt_did
             ${where}
             GROUP BY cr.attester_suffix, cr.schema_suffix, cr.requester_suffix
             ORDER BY count DESC, schemaDid ASC, requesterDid ASC
             LIMIT ? OFFSET ?`,
            [...params, Math.max(0, limit), Math.max(0, offset)]
        );

        return {
            total: Number(totalRow?.total ?? 0),
            usage: rows.map(row => ({
                ...row,
                count: Number(row.count),
            })),
        };
    }

    async listEvents(options: DIDEventListOptions = {}): Promise<DIDEventListResult> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

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

        if (didPrefix) {
            clauses.push('dc.prefix = ?');
            params.push(didPrefix);
        }

        if (registry) {
            clauses.push('e.registry = ?');
            params.push(registry);
        }

        if (updatedAfter) {
            clauses.push('e.time > ?');
            params.push(updatedAfter);
        }

        if (updatedBefore) {
            clauses.push('e.time < ?');
            params.push(updatedBefore);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const totalRow = await this.db.get<{ total: number | string }>(
            `SELECT COUNT(*) AS total
             FROM did_events e
             JOIN did_classifications_effective dc ON dc.did = e.did
             ${where}`,
            params
        );
        const rows = await this.db.all<{
            did: string;
            registry: string;
            time: string;
            event: string;
        }[]>(
            `SELECT dc.prefix || ':' || dc.suffix AS did,
                    e.registry,
                    e.time,
                    e.event
             FROM did_events e
             JOIN did_classifications_effective dc ON dc.did = e.did
             ${where}
             ORDER BY e.time DESC, did ASC, e.event_index ASC
             LIMIT ? OFFSET ?`,
            [...params, Math.max(0, limit), Math.max(0, offset)]
        );

        return {
            total: Number(totalRow?.total ?? 0),
            events: rows.map(row => ({
                did: row.did,
                registry: row.registry,
                time: row.time,
                event: JSON.parse(row.event) as GatekeeperEvent,
            })),
        };
    }

    async *iterateDIDEventHistories(pageSize = 500): AsyncIterable<DIDEventHistory> {
        const db = this.db;
        if (!db) {
            throw new Error('DB not connected');
        }

        const limit = Math.max(1, pageSize);
        let cursorDid: string | null = null;
        let cursorIndex = -1;
        let currentDid: string | null = null;
        let currentEvents: GatekeeperEvent[] = [];

        while (true) {
            const rows: HistoryEventRow[] = cursorDid === null
                ? await db.all<HistoryEventRow[]>(
                    `SELECT did, event_index AS eventIndex, event
                     FROM did_events
                     ORDER BY did ASC, event_index ASC
                     LIMIT ?`,
                    [limit]
                )
                : await db.all<HistoryEventRow[]>(
                    `SELECT did, event_index AS eventIndex, event
                     FROM did_events
                     WHERE did > ? OR (did = ? AND event_index > ?)
                     ORDER BY did ASC, event_index ASC
                     LIMIT ?`,
                    [cursorDid, cursorDid, cursorIndex, limit]
                );

            if (rows.length === 0) {
                break;
            }

            for (const row of rows) {
                if (currentDid !== null && row.did !== currentDid) {
                    yield { did: currentDid, events: currentEvents };
                    currentEvents = [];
                }

                currentDid = row.did;
                currentEvents.push(JSON.parse(row.event) as GatekeeperEvent);
            }

            const last: HistoryEventRow = rows[rows.length - 1];
            cursorDid = last.did;
            cursorIndex = last.eventIndex;

            if (rows.length < limit) {
                break;
            }
        }

        if (currentDid !== null) {
            yield { did: currentDid, events: currentEvents };
        }
    }

    async replaceNetworkMetricSnapshots(snapshots: NetworkMetricSnapshot[]): Promise<void> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        await this.db.exec('BEGIN');
        try {
            await this.db.run('DELETE FROM network_metric_snapshots');
            for (const snapshot of snapshots) {
                await this.db.run(
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
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            await this.db.exec('COMMIT');
        }
        catch (error) {
            await this.db.exec('ROLLBACK');
            throw error;
        }
    }

    async getNetworkMetricSnapshot(date: string): Promise<NetworkMetricSnapshot | null> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const row = await this.db.get<{
            date: string;
            didCount: number | string;
            didCountsByPrefix: string;
            agentDidCount: number | string;
            agentDidCountsByPrefix: string;
            credentialCount: number | string;
            credentialDidCountsByPrefix: string;
            schemaCounts: string;
            rebuiltAt: string;
        }>(
            `SELECT
                snapshot_date AS date,
                did_count AS didCount,
                did_counts_by_prefix AS didCountsByPrefix,
                agent_did_count AS agentDidCount,
                agent_did_counts_by_prefix AS agentDidCountsByPrefix,
                credential_count AS credentialCount,
                credential_did_counts_by_prefix AS credentialDidCountsByPrefix,
                schema_counts AS schemaCounts,
                rebuilt_at AS rebuiltAt
             FROM network_metric_snapshots
             WHERE snapshot_date = ?`,
            [date]
        );

        return row ? {
            date: row.date,
            didCount: Number(row.didCount),
            didCountsByPrefix: JSON.parse(row.didCountsByPrefix) as Record<string, number>,
            agentDidCount: Number(row.agentDidCount),
            agentDidCountsByPrefix: JSON.parse(row.agentDidCountsByPrefix) as Record<string, number>,
            credentialCount: Number(row.credentialCount),
            credentialDidCountsByPrefix: JSON.parse(row.credentialDidCountsByPrefix) as Record<string, number>,
            schemas: JSON.parse(row.schemaCounts) as PublishedCredentialSchemaCount[],
            rebuiltAt: row.rebuiltAt,
        } : null;
    }

    async searchDocs(q: string, didPrefix?: string): Promise<string[]> {
        if (!this.db) {
            throw new Error('DB not connected');
        }
        const rows = await this.db.all<{ did: string }[]>(
            `SELECT dc.prefix || ':' || dc.suffix AS did
             FROM did_docs d
             JOIN did_classifications_effective dc ON dc.did = d.did
             WHERE d.doc LIKE '%' || ? || '%'
             ${didPrefix ? 'AND dc.prefix = ?' : ''}`,
            didPrefix ? [q, didPrefix] : [q]
        );

        return rows.map(row => row.did);
    }

    async queryDocs(where: Record<string, unknown>, didPrefix?: string): Promise<string[]> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const [rawPath, cond] = Object.entries(where)[0] as [string, any];
        if (typeof cond !== 'object' || !Array.isArray(cond.$in))
            throw new Error('Only {$in:[…]} supported');

        const list = cond.$in as unknown[];

        const isKeyWildcard   = rawPath.endsWith('.*');
        const isValueWildcard = rawPath.includes('.*.');
        const isArrayTail     = Sqlite.ARRAY_WILDCARD_END.test(rawPath);
        const isArrayMid      = Sqlite.ARRAY_WILDCARD_MID.test(rawPath);

        let sql: string;
        let params: unknown[];

        const toJsonPath = (p: string) =>
            p.startsWith("$.") ? p : p.startsWith("$") ? `$${p.slice(1)}` : `$.${p}`;

        if (isArrayTail) {
            const basePath = toJsonPath(rawPath.replace(Sqlite.ARRAY_WILDCARD_END, ""));
            sql = `
                SELECT DISTINCT did
                FROM did_docs,
                     json_each(did_docs.doc, ?) AS elem
                WHERE json_valid(did_docs.doc) = 1
                  AND elem.value IN (${list.map(() => "?").join(",")})
            `;
            params = [basePath, ...list];

        } else if (isArrayMid) {
            const [prefix, suffix] = rawPath.split("[*].");
            const basePath = toJsonPath(prefix);
            sql = `
                SELECT DISTINCT did
                FROM did_docs,
                     json_each(did_docs.doc, ?) AS elem
                WHERE json_valid(did_docs.doc) = 1
                  AND json_extract(elem.value, ?) IN (${list.map(() => "?").join(",")})
            `;
            params = [basePath, toJsonPath(suffix), ...list];

        } else if (isKeyWildcard) {
            const basePath = toJsonPath(rawPath.slice(0, -2)); // strip .*
            sql = `
                SELECT DISTINCT did
                FROM did_docs,
                     json_each(did_docs.doc, ?) AS m
                WHERE json_valid(did_docs.doc) = 1
                  AND m.key IN (${list.map(() => "?").join(",")})
            `;
            params = [basePath, ...list];

        } else if (isValueWildcard) {
            const [prefix, suffix] = rawPath.split(".*.");
            const basePath = toJsonPath(prefix);
            sql = `
                SELECT DISTINCT did
                FROM did_docs,
                     json_each(did_docs.doc, ?) AS m
                WHERE json_valid(did_docs.doc) = 1
                  AND json_extract(m.value, ?) IN (${list.map(() => "?").join(",")})
            `;
            params = [basePath, toJsonPath(suffix), ...list];

        } else {
            const path = toJsonPath(rawPath);
            sql = `
                SELECT DISTINCT did
                FROM did_docs
                WHERE json_valid(doc) = 1
                  AND json_extract(doc, ?) IN (${list.map(() => "?").join(",")})
            `;
            params = [path, ...list];
        }

        sql = `SELECT dc.prefix || ':' || dc.suffix AS did
               FROM (${sql}) matches
               JOIN did_classifications_effective dc ON dc.did = matches.did
               ${didPrefix ? 'WHERE dc.prefix = ?' : ''}`;
        if (didPrefix) params.push(didPrefix);

        const rows = await this.db.all<{ did: string }[]>(sql, params);
        return rows.map(r => r.did);
    }

    async wipeDb(): Promise<void> {
        if (!this.db) {
            throw new Error('DB not connected');
        }
        await this.db.exec(`
            DELETE FROM did_docs;
            DELETE FROM did_events;
            DELETE FROM did_classifications;
            DELETE FROM blocks;
            DELETE FROM published_credentials;
            DELETE FROM did_prefix_references;
            DELETE FROM challenge_receipts;
            DELETE FROM network_metric_snapshots;
            DELETE FROM sync_state;
        `);
    }

    private buildChallengeReceiptWhere(
        options: ChallengeReceiptListOptions | ChallengeReceiptUsageOptions
    ): { where: string; params: unknown[] } {
        const clauses: string[] = [];
        const params: unknown[] = [];
        const receiptDid = 'receiptDid' in options ? options.receiptDid : undefined;
        const responseCommitment = 'responseCommitment' in options ? options.responseCommitment : undefined;

        if (options.didPrefix) {
            clauses.push('dc.prefix = ?');
            params.push(options.didPrefix);
        }

        if (receiptDid) {
            clauses.push('dc.suffix = ?');
            params.push(getDIDSuffix(receiptDid));
        }

        if (options.attesterDid) {
            clauses.push('cr.attester_suffix = ?');
            params.push(getDIDSuffix(options.attesterDid));
        }

        if (options.schemaDid) {
            clauses.push('cr.schema_suffix = ?');
            params.push(getDIDSuffix(options.schemaDid));
        }

        if (options.requesterDid) {
            clauses.push('cr.requester_suffix = ?');
            params.push(getDIDSuffix(options.requesterDid));
        }

        if (responseCommitment) {
            clauses.push('cr.response_commitment = ?');
            params.push(responseCommitment);
        }

        if (options.updatedAfter) {
            clauses.push('cr.updated_at >= ?');
            params.push(options.updatedAfter);
        }

        if (options.updatedBefore) {
            clauses.push('cr.updated_at <= ?');
            params.push(options.updatedBefore);
        }

        return {
            where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
            params,
        };
    }

    private async replacePublishedCredentialsInTx(
        holderDid: string,
        records: PublishedCredentialRecord[]
    ): Promise<void> {
        await this.db!.run(
            'DELETE FROM published_credentials WHERE holder_did = ?',
            [holderDid]
        );

        for (const record of records) {
            await this.db!.run(`
                INSERT INTO published_credentials (
                    holder_did,
                    credential_suffix,
                    schema_suffix,
                    issuer_did,
                    subject_did,
                    revealed,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(holder_did, credential_suffix) DO UPDATE SET
                    schema_suffix = excluded.schema_suffix,
                    issuer_did = excluded.issuer_did,
                    subject_did = excluded.subject_did,
                    revealed = excluded.revealed,
                    updated_at = excluded.updated_at
            `, [
                record.holderDid,
                getDIDSuffix(record.credentialDid),
                getDIDSuffix(record.schemaDid),
                record.issuerDid,
                record.subjectDid,
                record.revealed ? 1 : 0,
                record.updatedAt,
            ]);
        }
    }

    private async replaceDIDPrefixReferencesInTx(
        sourceDid: string,
        references: string[],
        publishedCredentials: PublishedCredentialRecord[]
    ): Promise<void> {
        await this.db!.run('DELETE FROM did_prefix_references WHERE source_did = ?', [sourceDid]);

        for (const did of deduplicateDIDPrefixReferences(references, publishedCredentials)) {
            await this.db!.run(
                'INSERT INTO did_prefix_references (source_did, suffix, prefix) VALUES (?, ?, ?)',
                [sourceDid, getDIDSuffix(did), getDIDPrefix(did)]
            );
        }
    }

    private async replaceChallengeReceiptsInTx(
        receiptDid: string,
        records: ChallengeReceiptRecord[]
    ): Promise<void> {
        await this.db!.run(
            'DELETE FROM challenge_receipts WHERE receipt_did = ?',
            [receiptDid]
        );

        for (const record of records) {
            await this.db!.run(`
                INSERT INTO challenge_receipts (
                    receipt_did,
                    attester_did,
                    attester_suffix,
                    schema_did,
                    schema_suffix,
                    requester_did,
                    requester_suffix,
                    response_commitment,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(receipt_did) DO UPDATE SET
                    attester_did = excluded.attester_did,
                    attester_suffix = excluded.attester_suffix,
                    schema_did = excluded.schema_did,
                    schema_suffix = excluded.schema_suffix,
                    requester_did = excluded.requester_did,
                    requester_suffix = excluded.requester_suffix,
                    response_commitment = excluded.response_commitment,
                    updated_at = excluded.updated_at
            `, [
                record.receiptDid,
                record.attesterDid,
                getDIDSuffix(record.attesterDid),
                record.schemaDid,
                getDIDSuffix(record.schemaDid),
                record.requesterDid,
                getDIDSuffix(record.requesterDid),
                record.responseCommitment,
                record.updatedAt,
            ]);
        }
    }
}
