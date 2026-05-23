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
    DIDEventListOptions,
    DIDEventListResult,
    PublishedCredentialListOptions,
    PublishedCredentialListResult,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
    GatekeeperEvent,
} from "../types.js";
import { stableStringify } from './db-utils.js';

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
                credential_did TEXT NOT NULL,
                schema_did TEXT NOT NULL,
                issuer_did TEXT NOT NULL,
                subject_did TEXT NOT NULL,
                revealed INTEGER,
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
                response_commitment TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_attester
                ON challenge_receipts (attester_did);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_schema
                ON challenge_receipts (schema_did);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_requester
                ON challenge_receipts (requester_did);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_commitment
                ON challenge_receipts (response_commitment);

            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_published_credentials_schema_revealed
                ON published_credentials (schema_did, revealed)
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
                    if ((deletion.changes ?? 0) > 0) {
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
                const changed = eventChanges.get(record.did) ?? false;

                if (!changed && !record.removed) {
                    continue;
                }

                result.changedDids.push(record.did);
                await this.db.run('DELETE FROM did_events WHERE did = ?', [record.did]);

                if (record.removed) {
                    await this.db.run('DELETE FROM did_docs WHERE did = ?', [record.did]);
                    await this.db.run('DELETE FROM published_credentials WHERE holder_did = ?', [record.did]);
                    await this.db.run('DELETE FROM challenge_receipts WHERE receipt_did = ?', [record.did]);
                    result.removedDids += 1;
                    continue;
                }

                for (const [index, event] of record.events.entries()) {
                    await this.db.run(
                        'INSERT INTO did_events (did, event_index, registry, time, event) VALUES (?, ?, ?, ?, ?)',
                        [record.did, index, event.registry, event.time, JSON.stringify(event)]
                    );
                }

                if (record.doc) {
                    await this.db.run(`
                        INSERT INTO did_docs (did, doc) VALUES (?, ?)
                            ON CONFLICT(did) DO UPDATE SET doc=excluded.doc
                    `, [record.did, JSON.stringify(record.doc)]);
                }

                await this.replacePublishedCredentialsInTx(record.did, record.publishedCredentials ?? []);
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

    async getPublishedCredentialCountsBySchema(): Promise<PublishedCredentialSchemaCount[]> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        const rows = await this.db.all<PublishedCredentialSchemaCount[]>(`
            SELECT schema_did AS schemaDid, COUNT(*) AS count
            FROM published_credentials
            GROUP BY schema_did
            ORDER BY count DESC, schemaDid ASC
        `);

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

        if (credentialDid) {
            clauses.push('credential_did = ?');
            params.push(credentialDid);
        }

        if (schemaDid) {
            clauses.push('schema_did = ?');
            params.push(schemaDid);
        }

        if (issuerDid) {
            clauses.push('issuer_did = ?');
            params.push(issuerDid);
        }

        if (subjectDid) {
            clauses.push('subject_did = ?');
            params.push(subjectDid);
        }

        if (typeof revealed === 'boolean') {
            clauses.push('revealed = ?');
            params.push(revealed ? 1 : 0);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

        const totalRow = await this.db.get<{ total: number | string }>(
            `SELECT COUNT(*) AS total FROM published_credentials ${where}`,
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
                holder_did AS holderDid,
                credential_did AS credentialDid,
                schema_did AS schemaDid,
                issuer_did AS issuerDid,
                subject_did AS subjectDid,
                revealed AS revealed,
                updated_at AS updatedAt
             FROM published_credentials
             ${where}
             ORDER BY updated_at DESC, credential_did ASC
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
            `SELECT COUNT(*) AS total FROM challenge_receipts ${where}`,
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
                receipt_did AS receiptDid,
                attester_did AS attesterDid,
                schema_did AS schemaDid,
                requester_did AS requesterDid,
                response_commitment AS responseCommitment,
                updated_at AS updatedAt
             FROM challenge_receipts
             ${where}
             ORDER BY updated_at DESC, receipt_did ASC
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
                FROM challenge_receipts
                ${where}
                GROUP BY attester_did, schema_did, requester_did
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
                attester_did AS attesterDid,
                schema_did AS schemaDid,
                requester_did AS requesterDid,
                COUNT(DISTINCT response_commitment) AS count,
                MIN(updated_at) AS firstUpdatedAt,
                MAX(updated_at) AS lastUpdatedAt
             FROM challenge_receipts
             ${where}
             GROUP BY attester_did, schema_did, requester_did
             ORDER BY count DESC, schema_did ASC, requester_did ASC
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
            registry,
            updatedAfter,
            updatedBefore,
            limit = 50,
            offset = 0,
        } = options;
        const clauses: string[] = [];
        const params: unknown[] = [];

        if (registry) {
            clauses.push('registry = ?');
            params.push(registry);
        }

        if (updatedAfter) {
            clauses.push('time > ?');
            params.push(updatedAfter);
        }

        if (updatedBefore) {
            clauses.push('time < ?');
            params.push(updatedBefore);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const totalRow = await this.db.get<{ total: number | string }>(
            `SELECT COUNT(*) AS total FROM did_events ${where}`,
            params
        );
        const rows = await this.db.all<{
            did: string;
            registry: string;
            time: string;
            event: string;
        }[]>(
            `SELECT did, registry, time, event
             FROM did_events
             ${where}
             ORDER BY time DESC, did ASC, event_index ASC
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

    async searchDocs(q: string): Promise<string[]> {
        if (!this.db) {
            throw new Error('DB not connected');
        }
        const rows = await this.db.all<{ did: string }[]>(
            `SELECT did FROM did_docs WHERE doc LIKE '%' || ? || '%'`,
            [q]
        );

        return rows.map(row => row.did);
    }

    async queryDocs(where: Record<string, unknown>): Promise<string[]> {
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
            DELETE FROM blocks;
            DELETE FROM published_credentials;
            DELETE FROM challenge_receipts;
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

        if (receiptDid) {
            clauses.push('receipt_did = ?');
            params.push(receiptDid);
        }

        if (options.attesterDid) {
            clauses.push('attester_did = ?');
            params.push(options.attesterDid);
        }

        if (options.schemaDid) {
            clauses.push('schema_did = ?');
            params.push(options.schemaDid);
        }

        if (options.requesterDid) {
            clauses.push('requester_did = ?');
            params.push(options.requesterDid);
        }

        if (responseCommitment) {
            clauses.push('response_commitment = ?');
            params.push(responseCommitment);
        }

        if (options.updatedAfter) {
            clauses.push('updated_at >= ?');
            params.push(options.updatedAfter);
        }

        if (options.updatedBefore) {
            clauses.push('updated_at <= ?');
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
                    credential_did,
                    schema_did,
                    issuer_did,
                    subject_did,
                    revealed,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(holder_did, credential_did) DO UPDATE SET
                    schema_did = excluded.schema_did,
                    issuer_did = excluded.issuer_did,
                    subject_did = excluded.subject_did,
                    revealed = excluded.revealed,
                    updated_at = excluded.updated_at
            `, [
                record.holderDid,
                record.credentialDid,
                record.schemaDid,
                record.issuerDid,
                record.subjectDid,
                record.revealed ? 1 : 0,
                record.updatedAt,
            ]);
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
                    schema_did,
                    requester_did,
                    response_commitment,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(receipt_did) DO UPDATE SET
                    attester_did = excluded.attester_did,
                    schema_did = excluded.schema_did,
                    requester_did = excluded.requester_did,
                    response_commitment = excluded.response_commitment,
                    updated_at = excluded.updated_at
            `, [
                record.receiptDid,
                record.attesterDid,
                record.schemaDid,
                record.requesterDid,
                record.responseCommitment,
                record.updatedAt,
            ]);
        }
    }
}
