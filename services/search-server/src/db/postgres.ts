import { Pool } from 'pg';
import { DIDsDb } from '../types.js';

interface ConfigRow {
    value: string;
}

interface DocRow {
    doc: object | string;
}

interface DidRow {
    did: string;
}

export default class Postgres implements DIDsDb {
    private readonly url: string;
    private pool: Pool | null = null;
    private static readonly ARRAY_WILDCARD_END = /\[\*]$/;
    private static readonly ARRAY_WILDCARD_MID = /\[\*]\./;

    static async create(url: string): Promise<DIDsDb> {
        const db = new Postgres(url);
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

        this.pool = new Pool({ connectionString: this.url });

        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS did_docs (
                did TEXT PRIMARY KEY,
                doc JSONB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    async loadUpdatedAfter(): Promise<string | null> {
        const pool = this.getPool();
        const result = await pool.query<ConfigRow>(
            'SELECT value FROM config WHERE key = $1 LIMIT 1',
            ['updated_after']
        );

        if (result.rowCount === 0) {
            return null;
        }

        return result.rows[0].value;
    }

    async saveUpdatedAfter(timestamp: string): Promise<void> {
        const pool = this.getPool();
        await pool.query(
            `INSERT INTO config (key, value) VALUES ('updated_after', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [timestamp]
        );
    }

    async storeDID(did: string, doc: object): Promise<void> {
        const pool = this.getPool();
        await pool.query(
            `INSERT INTO did_docs (did, doc) VALUES ($1, $2::jsonb)
             ON CONFLICT (did) DO UPDATE SET doc = EXCLUDED.doc`,
            [did, JSON.stringify(doc)]
        );
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
        await pool.query('DELETE FROM config');
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error('Postgres DB not connected');
        }

        return this.pool;
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
            } else if (match[2]) {
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
