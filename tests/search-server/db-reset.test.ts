import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import { RESET_SEARCH_SCHEMA_SQL } from '../../services/search-server/src/db/db-utils.ts';
import { seedDID } from './db-seed.ts';

describe('Search Server SQLite startup reset', () => {
    let folder: string;
    beforeEach(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-search-reset-')); });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(folder, { recursive: true, force: true });
    });

    it('keeps an existing index on ordinary startup', async () => {
        const original = await Sqlite.create('search.db', folder);
        await seedDID(original, 'did:test:kept', { doc: { name: 'kept' } });
        await original.saveSyncState('index.changes.cursor', '42');
        await original.disconnect();
        const reopened = await Sqlite.create('search.db', folder);
        try {
            expect(await reopened.getDID('did:test:kept')).toEqual({ name: 'kept' });
            expect(await reopened.loadSyncState('index.changes.cursor')).toBe('42');
        }
        finally { await reopened.disconnect(); }
    });

    it('recreates outdated Search tables and clears checkpoints while preserving unrelated tables', async () => {
        const original = await Sqlite.create('search.db', folder);
        await seedDID(original, 'did:test:old', { doc: { name: 'old' } });
        await original.saveSyncState('index.changes.cursor', '42');
        await (original as any).db.exec(`
            CREATE TABLE gatekeeper_events (marker TEXT);
            INSERT INTO gatekeeper_events VALUES ('retained');
            CREATE TABLE hyperswarm_sync_operations (marker TEXT);
            INSERT INTO hyperswarm_sync_operations VALUES ('retained');
            ALTER TABLE did_classifications DROP COLUMN stats_type;
        `);
        await original.disconnect();

        const reset = await Sqlite.create('search.db', folder, true);
        try {
            expect(await reset.getDID('did:test:old')).toBeNull();
            expect(await reset.loadSyncState('index.changes.cursor')).toBeNull();
            expect(await reset.getStats()).toMatchObject({ dids: { total: 0 }, index: { epoch: null, state: 'snapshot' } });
            for (const table of ['gatekeeper_events', 'hyperswarm_sync_operations']) {
                expect(await (reset as any).db.get(`SELECT marker FROM ${table}`)).toEqual({ marker: 'retained' });
            }
            await seedDID(reset, 'did:test:new', { doc: { mdip: { type: 'agent', registry: 'local' } } });
            expect((await reset.getStats()).dids.total).toBe(1);
        }
        finally { await reset.disconnect(); }
    });

    it('rolls back a failed reset and closes its connection', async () => {
        const original = await Sqlite.create('search.db', folder);
        await original.saveSyncState('index.changes.cursor', '42');
        const prototype = Object.getPrototypeOf((original as any).db);
        const exec = prototype.exec;
        await original.disconnect();
        const close = jest.spyOn(prototype, 'close');
        const executing = jest.spyOn(prototype, 'exec').mockImplementation(async function (this: any, sql: any) {
            if (sql === RESET_SEARCH_SCHEMA_SQL) {
                await exec.call(this, 'DROP TABLE sync_state');
                throw new Error('reset failed');
            }
            return exec.call(this, sql);
        });
        await expect(Sqlite.create('search.db', folder, true)).rejects.toThrow('reset failed');
        expect(executing).toHaveBeenCalledWith('ROLLBACK');
        expect(close).toHaveBeenCalledTimes(1);
        jest.restoreAllMocks();
        const reopened = await Sqlite.create('search.db', folder);
        try { expect(await reopened.loadSyncState('index.changes.cursor')).toBe('42'); }
        finally { await reopened.disconnect(); }
    });
});

describe('Search Server PostgreSQL startup reset', () => {
    function fixture() {
        const client = {
            query: jest.fn(async () => ({ rows: [] })),
            release: jest.fn(),
        };
        const pool = {
            query: jest.fn(async (_sql: string) => ({ rows: [] })),
            connect: jest.fn(async () => client),
            end: jest.fn(async () => {}),
        };
        class TestPostgres extends Postgres {
            protected createPool(): any { return pool; }
        }
        return { TestPostgres, pool };
    }

    it('drops only Search tables before creating their current schema', async () => {
        const { TestPostgres, pool } = fixture();
        const db = await TestPostgres.create('postgresql://fixture', true);
        try {
            expect(pool.query.mock.calls[0][0]).toBe(RESET_SEARCH_SCHEMA_SQL);
            expect(pool.query.mock.calls[1][0]).toContain('CREATE TABLE IF NOT EXISTS did_classifications');
            expect(RESET_SEARCH_SCHEMA_SQL).not.toContain('CASCADE');
            expect(RESET_SEARCH_SCHEMA_SQL).not.toContain('gatekeeper_');
            expect(RESET_SEARCH_SCHEMA_SQL).not.toContain('hyperswarm_');
        }
        finally { await db.disconnect(); }
    });

    it('propagates a reset failure and closes the pool without initializing tables', async () => {
        const { TestPostgres, pool } = fixture();
        pool.query.mockRejectedValueOnce(new Error('reset denied'));
        await expect(TestPostgres.create('postgresql://fixture', true)).rejects.toThrow('reset denied');
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.connect).not.toHaveBeenCalled();
        expect(pool.end).toHaveBeenCalledTimes(1);
    });
});
