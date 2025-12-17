import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { DIDsDb } from "../types.js";

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

            CREATE TABLE IF NOT EXISTS config (
                                                  key TEXT PRIMARY KEY,
                                                  value TEXT NOT NULL
            );
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
            DELETE FROM config;
        `);
    }
}
