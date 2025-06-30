import { DatabaseSync, SupportedValueType } from "node:sqlite";

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
    private db: DatabaseSync | null = null;
    private static readonly ARRAY_WILDCARD_END = /\[\*]$/;
    private static readonly ARRAY_WILDCARD_MID = /\[\*]\./;

    private get conn(): DatabaseSync {
        if (!this.db) {
            throw new Error("DB not connected");
        }
        return this.db;
    }

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

        this.db = new DatabaseSync(this.dbFile);

        this.db.exec(`
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
            this.db.close();
            this.db = null;
        }
    }

    async loadUpdatedAfter(): Promise<string | null> {
        const stmt = this.conn.prepare(
            `SELECT value FROM config WHERE key = 'updated_after'`,
        );
        const row = stmt.get() as { value?: string } | undefined;
        return row?.value ?? null;
    }

    async saveUpdatedAfter(timestamp: string): Promise<void> {
        const stmt = this.conn.prepare(`
          INSERT INTO config (key, value) VALUES ('updated_after', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        stmt.run(timestamp);
    }

    async storeDID(did: string, doc: object): Promise<void> {
        const stmt = this.conn.prepare(`
          INSERT INTO did_docs (did, doc) VALUES (?, ?)
          ON CONFLICT(did) DO UPDATE SET doc = excluded.doc
        `);
        stmt.run(did, JSON.stringify(doc));
    }

    async getDID(did: string): Promise<object | null> {
        const stmt = this.conn.prepare(
            `SELECT doc FROM did_docs WHERE did = ?`,
        );
        const row = stmt.get(did) as { doc?: string } | undefined;
        return row && row.doc ? JSON.parse(row.doc) : null;
    }

    async searchDocs(q: string): Promise<string[]> {
        const stmt = this.conn.prepare(
            `SELECT did FROM did_docs WHERE doc LIKE '%' || ? || '%'`,
        );
        const rows = stmt.all(q) as { did: string }[];
        return rows.map((r) => r.did);
    }

    async queryDocs(where: Record<string, unknown>): Promise<string[]> {
        const db = this.conn;

        const [rawPath, cond] = Object.entries(where)[0] as [string, any];
        if (typeof cond !== 'object' || !Array.isArray(cond.$in))
            throw new Error('Only {$in:[…]} supported');

        const list = cond.$in as SupportedValueType[];

        const isKeyWildcard   = rawPath.endsWith('.*');
        const isValueWildcard = rawPath.includes('.*.');
        const isArrayTail     = Sqlite.ARRAY_WILDCARD_END.test(rawPath);
        const isArrayMid      = Sqlite.ARRAY_WILDCARD_MID.test(rawPath);

        let sql: string;
        let params: SupportedValueType[];

        if (isArrayTail) {
            const basePath = '$.' + rawPath.replace(Sqlite.ARRAY_WILDCARD_END, '');
            sql = `
                SELECT did
                FROM   did_docs,
                       json_each(json_extract(doc, ?)) AS elem
                WHERE  elem.value IN (${list.map(() => '?').join(',')})
            `;
            params = [basePath, ...list];
        } else if (isArrayMid) {
            const [prefix, suffix] = rawPath.split('[*].');
            const basePath = '$.' + prefix;
            sql = `
                SELECT did
                FROM   did_docs,
                       json_each(json_extract(doc, ?)) AS elem
                WHERE  json_extract(elem.value, ?) IN (${list.map(() => '?').join(',')})
            `;
            params = [basePath, '$.' + suffix, ...list];
        } else if (isKeyWildcard) {
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

        const stmt = db.prepare(sql);
        const rows = stmt.all(...params) as { did: string }[];
        return rows.map((r) => r.did);
    }

    async wipeDb(): Promise<void> {
        this.conn.exec(`
            DELETE FROM did_docs;
            DELETE FROM config;
        `);
    }
}
