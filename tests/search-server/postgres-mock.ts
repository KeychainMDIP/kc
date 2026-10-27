import { jest } from '@jest/globals';

// Legacy SQL-unit fixtures mock coordination. Real concurrency is tested in multi-instance.test.ts.
export function mockPostgresPool(db: unknown, pool: any, unlockError?: Error): any {
    let owner = (db as { owner: string }).owner;
    const wrap = (query: (...args: any[]) => Promise<any>) => jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('pg_try_advisory_')) return { rows: [{ acquired: true }], rowCount: 1 };
        if (sql.includes('pg_advisory_lock(') || sql.startsWith('SET lock_timeout')
            || sql === 'RESET lock_timeout') return { rows: [], rowCount: 1 };
        if (sql.includes('pg_advisory_unlock') && unlockError) throw unlockError;
        if (sql.includes('pg_advisory_unlock')) return { rows: [{ released: true }], rowCount: 1 };
        if (sql.includes("to_regclass('search_index_control')")) return { rows: [{ control: null }], rowCount: 1 };
        if (sql.includes("'columns', (SELECT jsonb_agg")) {
            return { rows: [{ layout: { columns: null, constraints: null, views: null } }], rowCount: 1 };
        }
        if (sql.includes('FROM search_index_control')) {
            return { rows: [{ owner, protocol_version: 1, schema_version: 1 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO search_index_control')) {
            owner = String(params?.[0]);
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes('CREATE TABLE IF NOT EXISTS search_index_control')) return { rows: [], rowCount: 0 };
        const statement = sql === 'BEGIN ISOLATION LEVEL READ COMMITTED' ? 'BEGIN' : sql;
        return params === undefined ? query(statement) : query(statement, params);
    });
    const connect = pool.connect ? pool.connect.bind(pool) : async () => ({ query: pool.query, release: jest.fn() });
    const result = {
        ...pool,
        connect: jest.fn(async () => {
            const client = await connect();
            return { ...client, query: wrap(client.query.bind(client)) };
        }),
    };
    return result;
}
