import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import {
    DIDsDb,
    PublishedCredentialListOptions,
    PublishedCredentialListResult,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
} from "../types.js";

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
            CREATE TABLE IF NOT EXISTS did_docs (
                                                    did TEXT PRIMARY KEY,
                                                    doc TEXT NOT NULL
            );

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

            CREATE TABLE IF NOT EXISTS config (
                                                  key TEXT PRIMARY KEY,
                                                  value TEXT NOT NULL
            );
        `);

        const columns = await this.db.all<{ name: string }[]>(
            `PRAGMA table_info('published_credentials')`
        );
        const hasRevealed = columns.some(column => column.name === 'revealed');

        if (!hasRevealed) {
            await this.db.exec(`
                ALTER TABLE published_credentials
                ADD COLUMN revealed INTEGER
            `);
        }

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

    async loadUpdatedAfter(): Promise<string | null> {
        if (!this.db) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new Error('DB not connected');
        }
        const row = await this.db.get('SELECT value FROM config WHERE key = ?', ['updated_after']);
        if (!row) {
            return null;
        }
        return row.value;
    }

    async saveUpdatedAfter(timestamp: string): Promise<void> {
        if (!this.db) {
            throw new Error('DB not connected');
        }
        await this.db.run(`
            INSERT INTO config (key, value) VALUES ('updated_after', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `, [timestamp]);
    }

    async storeDID(did: string, doc: object): Promise<void> {
        if (!this.db) {
            throw new Error('DB not connected');
        }
        const docString = JSON.stringify(doc);
        await this.db.run(`
            INSERT INTO did_docs (did, doc) VALUES (?, ?)
                ON CONFLICT(did) DO UPDATE SET doc=excluded.doc
        `, [did, docString]);
    }

    async replacePublishedCredentials(holderDid: string, records: PublishedCredentialRecord[]): Promise<void> {
        if (!this.db) {
            throw new Error('DB not connected');
        }

        await this.db.exec('BEGIN');

        try {
            await this.db.run(
                'DELETE FROM published_credentials WHERE holder_did = ?',
                [holderDid]
            );

            for (const record of records) {
                await this.db.run(`
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

            await this.db.exec('COMMIT');
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
            DELETE FROM published_credentials;
            DELETE FROM config;
        `);
    }
}
