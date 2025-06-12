import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export interface DIDsDb {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    loadUpdatedAfter(): Promise<string | null>;
    saveUpdatedAfter(timestamp: string): Promise<void>;

    storeDID(did: string, doc: object): Promise<void>;
    getDID(did: string): Promise<object | null>;
    searchDocs(q: string): Promise<string[]>;
    wipeDb(): Promise<void>;
}

export default class Sqlite implements DIDsDb {
    private readonly dbFile: string;
    private db: Database | null = null;

    static async create(dbFileName: string = 'dids.db', dataFolder: string = 'data'): Promise<Sqlite> {
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

        let sql: string;
        let params: unknown[];

        if (isKeyWildcard) {
            const basePath = '$.' + rawPath.slice(0, -2);
            sql = `
                SELECT did
                FROM   did_docs,
                       json_each(json_extract(doc, ?)) AS m
                WHERE  m.key IN (${list.map(() => '?').join(',')})
            `;
            params = [basePath, ...list];

        } else if (isValueWildcard) {
            const [prefix, suffix] = rawPath.split('.*.');
            const basePath = '$.' + prefix;
            sql = `
                  SELECT did
                  FROM   did_docs,
                         json_each(json_extract(doc, ?)) AS m
                  WHERE  json_extract(m.value, ?) IN (${list.map(() => '?').join(',')})
                `;
            params = [basePath, '$.' + suffix, ...list];

        } else {
            sql = `
                  SELECT did
                  FROM   did_docs
                  WHERE  json_extract(doc, ?) IN (${list.map(() => '?').join(',')})
                `;
            params = ['$.'.concat(rawPath), ...list];
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
