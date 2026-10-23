import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import Memory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import { projectStatistics, sampleGatekeeperStatus, summarizeStatistics } from '../../services/search-server/src/statistics.ts';
import { INDEX_SYNC_STATE_KEYS as keys } from '../../services/search-server/src/sync-state.ts';
import type { DIDsDb } from '../../services/search-server/src/types.ts';
import type { GetStatusResult } from '@mdip/gatekeeper/types';
import { createSeedEvent, seedDID } from './db-seed.ts';

const operational: GetStatusResult = {
    uptimeSeconds: 120,
    eventsQueue: { staged: 2, pending: 3, processing: 1, total: 6, active: true },
    memoryUsage: { rss: 1000, heapTotal: 800, heapUsed: 600, external: 100, arrayBuffers: 50 },
};

describe.each(['memory', 'sqlite'])('%s current DID statistics', backend => {
    let db: DIDsDb;
    let folder: string;
    beforeEach(async () => {
        folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-statistics-'));
        db = backend === 'memory' ? new Memory() : await Sqlite.create('stats.db', folder);
    });
    afterEach(async () => {
        await db.disconnect();
        fs.rmSync(folder, { recursive: true, force: true });
    });

    async function put(did: string, doc: object, prefix: string | null = did.split(':', 2).join(':')) {
        const event = createSeedEvent(did);
        event.operation.mdip!.prefix = prefix ?? undefined;
        await seedDID(db, did, { doc, events: [event] });
    }

    it('returns an empty partial index without inventing completeness', async () => {
        expect(await db.getStats()).toMatchObject({
            dids: { total: 0, byRegistry: {}, byVersion: {}, byType: { invalid: 0, confirmed: 0 } },
            index: { epoch: null, snapshotComplete: false, state: 'snapshot', appliedAt: null },
        });
    });

    it('counts and deduplicates an existing stored DID whose history is empty', async () => {
        const page = {
            dids: [{ did: 'did:test:empty-history', events: [], doc: { didResolutionMetadata: { error: 'notFound' } } }],
            blocks: [],
        };
        await db.applyIndexPage(page);
        await db.applyIndexPage(page);
        expect((await db.getStats()).dids).toMatchObject({ total: 1, byType: { invalid: 1, unconfirmed: 0 } });
        await db.applyIndexPage({ ...page, dids: [{ ...page.dids[0], removed: true }] });
        expect((await db.getStats()).dids.total).toBe(0);
    });

    it('counts current metadata, invalid resolutions, scope, aliases, and physical removals', async () => {
        await put('did:test:asset', {
            mdip: { type: 'asset', registry: 'local', validUntil: '2020-01-01T00:00:00Z' },
            didDocumentMetadata: { confirmed: true, version: '7', deactivated: true },
        });
        await put('did:test:agent', {
            mdip: { type: 'agent', registry: 'hyperswarm' },
            didDocumentMetadata: { confirmed: false, version: '2' },
        });
        await put('did:test:invalid', { didResolutionMetadata: { error: 'notFound' } });
        await put('did:mdip:other', { mdip: { type: 'asset', registry: 'TFTC' }, didDocumentMetadata: { version: '1' } });
        expect((await db.getStats()).dids).toEqual({
            total: 4,
            byType: { agents: 1, assets: 2, confirmed: 1, unconfirmed: 2, ephemeral: 1, invalid: 1 },
            byRegistry: { local: 1, hyperswarm: 1, TFTC: 1 },
            byVersion: { '7': 1, '2': 1, '1': 1 },
        });
        expect((await db.getStats({ didPrefix: 'did:test' })).dids.total).toBe(3);
        await put('did:mdip:asset', { mdip: { type: 'agent', registry: 'local' } });
        expect((await db.getStats()).dids.total).toBe(4);
        expect((await db.getStats({ didPrefix: 'did:test' })).dids.total).toBe(2);
        await seedDID(db, 'did:mdip:asset', { removed: true });
        expect((await db.getStats()).dids.total).toBe(3);
        await db.wipeDb();
        expect((await db.getStats()).dids.total).toBe(0);
    });

    it('includes ambiguous suffixes only according to the established scope rules', async () => {
        await put('did:test:ambiguous', { mdip: { type: 'agent', registry: 'local' } }, null);
        expect((await db.getStats({ didPrefix: 'did:mdip' })).dids.total).toBe(0);
        expect((await db.getStats({ didPrefix: 'did:mdip', includeAmbiguous: true })).dids.total).toBe(1);
        expect((await db.getStats({ didPrefix: 'did:test' })).dids.total).toBe(1);
    });

    it('reads page counts and their committed freshness together, including replay', async () => {
        const did = 'did:test:fresh';
        const event = createSeedEvent(did);
        const page = {
            dids: [{ did, events: [event], doc: { mdip: { type: 'asset', registry: 'local' } } }],
            blocks: [],
            syncStateUpdates: {
                [keys.epoch]: 'epoch-a', [keys.snapshotComplete]: 'true', [keys.changesCursor]: '9',
                [keys.appliedAt]: '2026-10-23T10:00:00.000Z',
            },
        };
        await db.applyIndexPage(page);
        expect(await db.getStats()).toMatchObject({ dids: { total: 1 }, index: { changesCursor: '9', state: 'catching_up' } });
        await db.applyIndexPage({ ...page, syncStateUpdates: {
            ...page.syncStateUpdates, [keys.caughtUpCursor]: '9', [keys.caughtUpAt]: '2026-10-23T10:01:00.000Z',
        } });
        expect(await db.getStats()).toMatchObject({ dids: { total: 1 }, index: { epoch: 'epoch-a', state: 'caught_up' } });
    });
});

describe('statistics projection and live sampling', () => {
    it('does not count invalid document metadata or credential validity as DID validity', () => {
        expect(projectStatistics({
            didResolutionMetadata: { error: 'invalidDid' }, mdip: { type: 'agent', registry: 'local' },
            didDocumentMetadata: { confirmed: true, version: '9' },
        })).toEqual({ type: null, registry: null, version: null, confirmed: false, ephemeral: false, invalid: true });
        expect(projectStatistics({ validUntil: '2020-01-01', didDocumentMetadata: { version: '2junk' } })).toMatchObject({
            version: null, ephemeral: false, invalid: false,
        });
    });

    it('does not let registry keys alter the aggregate prototype', () => {
        const result = summarizeStatistics([{ ...projectStatistics({ mdip: { registry: '__proto__' } }), count: 1 }], {});
        expect(Object.hasOwn(result.dids.byRegistry, '__proto__')).toBe(true);
        expect(result.dids.byRegistry.__proto__).toBe(1);
    });

    it('samples only allowed operational fields with an independent deadline and response bound', async () => {
        const getStatus = jest.fn(async () => ({ ...operational, privateData: 'omit' }));
        const signal = new AbortController().signal;
        expect(await sampleGatekeeperStatus({ getStatus }, signal)).toEqual({
            available: true, sampledAt: expect.any(String), status: operational,
        });
        expect(getStatus).toHaveBeenCalledWith({ timeoutMs: 5000, maxResponseBytes: 65536, signal });
    });

    it.each([
        { uptimeSeconds: 10, dids: { eventsQueue: [] } },
        { ...operational, eventsQueue: { ...operational.eventsQueue, total: 99 } },
        { ...operational, memoryUsage: { ...operational.memoryUsage, rss: -1 } },
        null,
    ])('rejects unsupported or malformed operational samples', async value => {
        expect(await sampleGatekeeperStatus({ getStatus: jest.fn(async () => value as GetStatusResult) })).toMatchObject({
            available: false, reason: 'unsupported_status',
        });
    });

    it('does not expose dependency errors or turn a failed sample into zero-valued measurements', async () => {
        const getStatus = jest.fn<() => Promise<GetStatusResult>>().mockRejectedValue(new Error('private URL and credentials'));
        expect(await sampleGatekeeperStatus({ getStatus })).toEqual({
            available: false, sampledAt: expect.any(String), reason: 'unavailable',
        });
    });
});

describe('SQLite statistics transaction isolation', () => {
    it('does not roll back a successful diagnostic write with a failed statistics transaction', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-statistics-state-lock-'));
        const db = await Sqlite.create('stats.db', folder);
        const connection = (db as any).db;
        const all = connection.all.bind(connection);
        let release!: () => void;
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const resumed = new Promise<void>(resolve => { release = resolve; });
        jest.spyOn(connection, 'all').mockImplementation(async (sql: any, ...args: any[]) => {
            if (sql.includes('COUNT(*)')) {
                entered();
                await resumed;
                throw new Error('statistics read failed');
            }
            return all(sql, ...args);
        });
        const reading = db.getStats();
        reading.catch(() => {});
        let saving: Promise<void> | undefined;
        try {
            await ready;
            let saved = false;
            saving = db.saveSyncState('diagnostic', 'committed').then(() => { saved = true; });
            await new Promise(resolve => setImmediate(resolve));
            expect(saved).toBe(false);
            release();
            await expect(reading).rejects.toThrow('statistics read failed');
            await saving;
            expect(await db.loadSyncState('diagnostic')).toBe('committed');
        }
        finally {
            release();
            await Promise.allSettled([reading, saving]);
            jest.restoreAllMocks();
            await db.disconnect();
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });

    it('rolls back a failed reset without mixing old counters and deleted documents', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-statistics-rollback-'));
        const db = await Sqlite.create('stats.db', folder);
        try {
            await seedDID(db, 'did:test:retained', { doc: { mdip: { type: 'agent', registry: 'local' } } });
            await db.saveSyncState(keys.epoch, 'original');
            await (db as any).db.exec(`CREATE TRIGGER fail_reset BEFORE DELETE ON did_classifications
                BEGIN SELECT RAISE(ABORT, 'simulated reset failure'); END`);
            await expect(db.wipeDb()).rejects.toThrow('simulated reset failure');
            expect(await db.getDID('did:test:retained')).not.toBeNull();
            expect(await db.getStats()).toMatchObject({ dids: { total: 1 }, index: { epoch: 'original' } });
        }
        finally {
            await db.disconnect();
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });

    it('makes metric replacement wait for the statistics read transaction', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-statistics-lock-'));
        const db = await Sqlite.create('stats.db', folder);
        const connection = (db as any).db;
        const all = connection.all.bind(connection);
        const exec = jest.spyOn(connection, 'exec');
        let release!: () => void;
        let entered!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const resumed = new Promise<void>(resolve => { release = resolve; });
        jest.spyOn(connection, 'all').mockImplementation(async (sql: any, ...args: any[]) => {
            if (sql.includes('COUNT(*)')) { entered(); await resumed; }
            return all(sql, ...args);
        });
        const reading = db.getStats();
        let replacement: Promise<void> | undefined;
        try {
            await ready;
            replacement = db.replaceNetworkMetricSnapshots([]);
            replacement.catch(() => {});
            await new Promise(resolve => setImmediate(resolve));
            expect(exec.mock.calls.filter(([sql]) => sql === 'BEGIN')).toHaveLength(1);
            release();
            await reading;
            await replacement;
        }
        finally {
            release();
            await Promise.allSettled([reading, replacement]);
            jest.restoreAllMocks();
            await db.disconnect();
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });
});

describe('PostgreSQL statistics snapshot', () => {
    it('rolls back a failed reset and releases its connection', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql === 'DELETE FROM did_classifications') throw new Error('simulated reset failure');
            return { rows: [] };
        });
        const release = jest.fn();
        const db = new Postgres('postgresql://fixture');
        (db as any).pool = { connect: async () => ({ query, release }) };
        await expect(db.wipeDb()).rejects.toThrow('simulated reset failure');
        expect(query.mock.calls[0][0]).toBe('BEGIN');
        expect(query.mock.calls.at(-1)![0]).toBe('ROLLBACK');
        expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('persists invalid statistics for a newly observed empty history instead of skipping it', async () => {
        const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
        const db = new Postgres('postgresql://fixture');
        (db as any).pool = { query, connect: async () => ({ query, release: jest.fn() }) };
        await db.applyIndexPage({
            dids: [{ did: 'did:test:empty-history', events: [], doc: { didResolutionMetadata: { error: 'notFound' } } }],
            blocks: [],
        });
        const classifications = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO did_classifications'));
        expect(classifications).toHaveLength(1);
        expect(classifications[0][1]).toEqual([
            'empty-history', 'did:test:empty-history', 'did:test', false, false,
            null, null, null, false, false, true,
        ]);
    });

    it('uses one repeatable-read connection for aggregate data and its watermark', async () => {
        const query = jest.fn(async (sql: string) => ({ rows: sql.includes('COUNT(*)')
            ? [{ ...projectStatistics({ mdip: { type: 'agent', registry: 'local' } }), count: '2' }]
            : sql.includes('SELECT key, value') ? [{ key: keys.epoch, value: 'pg-epoch' }] : [] }));
        const release = jest.fn();
        const db = new Postgres('postgresql://fixture');
        (db as any).pool = { connect: async () => ({ query, release }) };
        expect(await db.getStats({ didPrefix: 'did:mdip', includeAmbiguous: true })).toMatchObject({
            dids: { total: 2, byType: { agents: 2 } }, index: { epoch: 'pg-epoch' },
        });
        expect(query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        expect(query.mock.calls.at(-1)![0]).toBe('COMMIT');
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases the connection rather than reporting fake empty statistics', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('COUNT(*)')) throw new Error('storage unavailable');
            return { rows: [] };
        });
        const release = jest.fn();
        const db = new Postgres('postgresql://fixture');
        (db as any).pool = { connect: async () => ({ query, release }) };
        await expect(db.getStats()).rejects.toThrow('storage unavailable');
        expect(query.mock.calls.at(-1)![0]).toBe('ROLLBACK');
        expect(release).toHaveBeenCalledTimes(1);
    });
});
