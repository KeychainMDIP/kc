import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, Pool } from 'pg';
import { jest } from '@jest/globals';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import { SEARCH_SCHEMA_SQL } from '../../services/search-server/src/db/postgres-schema.ts';
import {
    IndexOwnershipLostError, SearchUnavailableError,
    SEARCH_LOCK_NAMESPACE, SEARCH_WRITER_LOCK, SEARCH_SCHEMA_LOCK,
} from '../../services/search-server/src/db/coordination.ts';
import { readDatabase } from '../../services/search-server/src/db/db-utils.ts';
import { findDIDReadTarget } from '../../services/search-server/src/did-aliases.ts';
import { getSearchStatus } from '../../services/search-server/src/index-helpers.ts';
import { createSeedEvent } from './db-seed.ts';

const seedDID = 'did:test:z3v8AuacR4diTuCgtbEfLDo2LzQNEDHgqBSNLMs5Szuq3WHcQdB';
let fixtureEvent: ReturnType<typeof createSeedEvent>;
const fixtureURL = process.env.KC_SEARCH_TEST_POSTGRES_URL;
if (process.env.CI && !fixtureURL) throw new Error('KC_SEARCH_TEST_POSTGRES_URL is required in CI');
const describePostgres = fixtureURL ? describe : describe.skip;

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

// All destructive operations below target a fresh, uniquely named fixture database.
describePostgres('Search Server PostgreSQL multi-instance coordination', () => {
    let admin: Client;
    let url: string;
    let database: string;
    let raw: Client;
    const adapters: Postgres[] = [];

    beforeAll(async () => {
        admin = new Client({ connectionString: fixtureURL });
        await admin.connect();
    });
    beforeEach(async () => {
        fixtureEvent = createSeedEvent(seedDID);
        database = `search_multi_${randomUUID().replaceAll('-', '')}`;
        // eslint-disable-next-line sonarjs/sql-queries -- database is a generated UUID identifier
        await admin.query(`CREATE DATABASE "${database}"`);
        const target = new URL(fixtureURL!);
        target.pathname = `/${database}`;
        url = target.toString();
        raw = new Client({ connectionString: url });
        await raw.connect();
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await raw.end();
        await Promise.all(adapters.splice(0).map(db => db.disconnect()));
        for (let attempt = 0; attempt < 100; attempt++) {
            const result = await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [database]);
            if (result.rows[0].n === 0) break;
            await delay(10);
        }
        // eslint-disable-next-line sonarjs/sql-queries -- only this test's generated database is removed
        await admin.query(`DROP DATABASE "${database}"`);
    });
    afterAll(async () => { await admin.end(); });

    async function open() {
        const db = new Postgres(url);
        adapters.push(db);
        await db.connect();
        return db;
    }
    function page() {
        return { dids: [{ did: seedDID, events: [fixtureEvent], doc: { value: 'kept' } }], blocks: [],
            syncStateUpdates: { cursor: '7' } };
    }
    async function lock(key: string) {
        await raw.query('SELECT pg_advisory_lock(hashtext($1), hashtext($2))', [SEARCH_LOCK_NAMESPACE, key]);
    }
    async function unlock(key: string) {
        await raw.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [SEARCH_LOCK_NAMESPACE, key]);
    }

    it('hands over one writer, preserving histories, documents and cursors for both HTTP readers', async () => {
        const a = await open();
        await a.applyIndexPage(page());
        const b = await open();
        expect(await a.getRole()).toBe('reader');
        expect(await b.getRole()).toBe('writer');
        expect(await a.getDID(seedDID)).toEqual({ value: 'kept' });
        expect(await b.getDIDEvents(seedDID)).toEqual([fixtureEvent]);
        expect(await b.loadSyncState('cursor')).toBe('7');
        await expect(a.applyIndexPage(page())).rejects.toBeInstanceOf(IndexOwnershipLostError);
        await expect(b.applyIndexPage(page())).resolves.toMatchObject({ changedDids: [] });
        expect((await raw.query('SELECT count(*)::int AS n FROM did_events')).rows[0].n).toBe(1);
    });

    it('waits for an active mutation before claiming ownership', async () => {
        const a = await open();
        const entered = deferred();
        const resume = deferred();
        const original = a.getDIDEvents.bind(a);
        jest.spyOn(a, 'getDIDEvents').mockImplementationOnce(async did => {
            entered.resolve();
            await resume.promise;
            return original(did);
        });
        const write = a.applyIndexPage(page());
        await entered.promise;
        const b = new Postgres(url);
        adapters.push(b);
        let claimed = false;
        const takeover = b.connect().then(() => { claimed = true; });
        await raw.query('SELECT 1');
        expect(claimed).toBe(false);
        resume.resolve();
        await write;
        await takeover;
        expect(await b.getDIDEvents(seedDID)).toHaveLength(1);
        await expect(a.saveSyncState('cursor', 'stale')).rejects.toBeInstanceOf(IndexOwnershipLostError);
    });

    it('fences every stale mutation including error state, metrics and epoch wipes', async () => {
        const a = await open();
        await a.applyIndexPage(page());
        const b = await open();
        for (const mutation of [
            () => a.saveSyncState('index.lastSyncError', 'stale'),
            () => a.saveSyncState('cursor', null),
            () => a.replaceNetworkMetricSnapshots([]),
            () => a.wipeDb(),
        ]) await expect(mutation()).rejects.toBeInstanceOf(IndexOwnershipLostError);
        expect(await b.loadSyncState('cursor')).toBe('7');
        expect(await b.getDID(seedDID)).toEqual({ value: 'kept' });
        await b.wipeDb();
        expect(await b.getRole()).toBe('writer');
        expect(await b.getDID(seedDID)).toBeNull();
    });

    it('selects one writer across three overlapping starts', async () => {
        const all = Array.from({ length: 3 }, () => new Postgres(url));
        adapters.push(...all);
        await Promise.all(all.map(db => db.connect()));
        expect((await Promise.all(all.map(db => db.getRole()))).filter(role => role === 'writer')).toHaveLength(1);
    });

    it('adopts the exact unversioned main schema without rebuilding data', async () => {
        await raw.query(SEARCH_SCHEMA_SQL);
        await raw.query("INSERT INTO sync_state VALUES ('cursor','legacy')");
        const db = await open();
        expect(await db.loadSyncState('cursor')).toBe('legacy');
    });

    it('rejects incompatible unversioned layouts without creating control state or deleting data', async () => {
        await raw.query(SEARCH_SCHEMA_SQL);
        await raw.query('ALTER TABLE did_docs ADD COLUMN incompatible TEXT');
        await raw.query("INSERT INTO sync_state VALUES ('cursor','legacy')");
        await expect(open()).rejects.toBeInstanceOf(SearchUnavailableError);
        expect((await raw.query("SELECT value FROM sync_state WHERE key='cursor'")).rows[0].value).toBe('legacy');
        expect((await raw.query("SELECT to_regclass('search_index_control') AS control")).rows[0].control).toBeNull();
    });

    it('rejects a zero-column Search table instead of treating the database as empty', async () => {
        await raw.query('CREATE TABLE sync_state ()');
        await expect(open()).rejects.toBeInstanceOf(SearchUnavailableError);
        expect((await raw.query("SELECT to_regclass('search_index_control') AS control")).rows[0].control).toBeNull();
        expect((await raw.query("SELECT to_regclass('did_events') AS events")).rows[0].events).toBeNull();
    });

    it.each(['DELETE FROM search_index_control',
        'UPDATE search_index_control SET protocol_version=2',
        'UPDATE search_index_control SET schema_version=2',
        "UPDATE search_index_control SET owner=''"])(
        'fails closed for damaged or unsupported metadata: %s', async sql => {
            const db = await open();
            await raw.query(sql);
            await expect(open()).rejects.toBeInstanceOf(SearchUnavailableError);
            await expect(db.getRole()).rejects.toBeInstanceOf(SearchUnavailableError);
        });

    it('keeps grouped and nested reads on one pool client', async () => {
        class SingleConnection extends Postgres {
            protected createPool() { return new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 200 }); }
        }
        const db = new SingleConnection(url);
        adapters.push(db);
        await db.connect();
        await db.applyIndexPage(page());
        await readDatabase(db, async () => {
            expect((await findDIDReadTarget(db, seedDID)).events).toHaveLength(1);
            expect((await getSearchStatus(db, 'postgres')).role).toBe('writer');
            await expect(db.saveSyncState('bad', 'value')).rejects.toThrow('Cannot write');
        });
    });

    async function waitForSchemaWaiter(): Promise<void> {
        for (let attempt = 0; attempt < 200; attempt++) {
            const result = await raw.query(`SELECT EXISTS (
                SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE a.datname = $1 AND l.locktype = 'advisory'
                  AND l.mode = 'ExclusiveLock' AND NOT l.granted
            ) AS waiting`, [database]);
            if (result.rows[0].waiting) return;
            await delay(5);
        }
        throw new Error('Startup did not queue for the schema lock');
    }

    it('queues takeover behind active readers and stops admitting overlapping new readers', async () => {
        const a = await open();
        const entered = deferred();
        const releaseReader = deferred();
        const activeRead = a.withRead(async () => {
            entered.resolve();
            await releaseReader.promise;
        });
        await entered.promise;
        const b = new Postgres(url);
        adapters.push(b);
        const takeover = b.connect();
        const blocked = deferred();
        const originalTryLock = (a as any).tryLock.bind(a);
        jest.spyOn(a as any, 'tryLock').mockImplementation(async (...args: unknown[]) => {
            const acquired = await originalTryLock(...args);
            if (args[1] === SEARCH_SCHEMA_LOCK && !acquired) blocked.resolve();
            return acquired;
        });
        try {
            await waitForSchemaWaiter();
            const laterRead = a.getRole();
            await blocked.promise;
            releaseReader.resolve();
            await activeRead;
            await takeover;
            expect(await laterRead).toBe('reader');
            expect(await b.getRole()).toBe('writer');
        } finally {
            releaseReader.resolve();
            await activeRead;
            await takeover;
        }
    });

    it.each(['signal', 'disconnect'])('cancels queued schema acquisition through %s without fencing the current writer', async cancellation => {
        const a = await open();
        await raw.query('SELECT pg_advisory_lock_shared(hashtext($1), hashtext($2))',
            [SEARCH_LOCK_NAMESPACE, SEARCH_SCHEMA_LOCK]);
        const b = new Postgres(url);
        adapters.push(b);
        const abort = new AbortController();
        const takeover = b.connect(abort.signal).catch(error => error);
        try {
            await waitForSchemaWaiter();
            if (cancellation === 'signal') abort.abort();
            else await b.disconnect();
            expect(await takeover).toBeInstanceOf(Error);
        } finally {
            await raw.query('SELECT pg_advisory_unlock_shared(hashtext($1), hashtext($2))',
                [SEARCH_LOCK_NAMESPACE, SEARCH_SCHEMA_LOCK]);
        }
        expect(await a.getRole()).toBe('writer');
    });

    it('does not reuse a released read transaction from escaped asynchronous work', async () => {
        const db = await open();
        const resume = deferred();
        let escaped!: Promise<object | null>;
        await db.withRead(async () => {
            escaped = resume.promise.then(() => db.getDID(seedDID));
        });
        resume.resolve();
        await expect(escaped).rejects.toThrow('Search transaction has ended');
        expect(await db.getRole()).toBe('writer');
    });

    it('rolls back a mutation refused admission by an exclusive schema guard', async () => {
        const db = await open();
        await lock(SEARCH_SCHEMA_LOCK);
        try {
            await expect(db.saveSyncState('blocked', 'value')).rejects.toThrow('Search schema is busy');
        } finally {
            await unlock(SEARCH_SCHEMA_LOCK);
        }
        expect(await db.loadSyncState('blocked')).toBeNull();
        await db.saveSyncState('unblocked', 'value');
    });

    it('does not retain a pre-takeover repeatable-read snapshot while waiting for the schema guard', async () => {
        const db = await open();
        await db.saveSyncState('cursor', 'before');
        await lock(SEARCH_SCHEMA_LOCK);
        await raw.query('BEGIN');
        await raw.query("UPDATE sync_state SET value='after' WHERE key='cursor'");
        const read = db.loadSyncState('cursor');
        await raw.query('COMMIT');
        await unlock(SEARCH_SCHEMA_LOCK);
        expect(await read).toBe('after');
    });

    it('does not deadlock a concurrent trigram build with a contending old writer', async () => {
        const a = await open();
        await raw.query('DROP INDEX CONCURRENTLY idx_did_docs_doc_trgm');
        const b = new Postgres(url);
        adapters.push(b);
        const entered = deferred();
        const resume = deferred();
        const original = (b as any).ensureTextIndex.bind(b);
        jest.spyOn(b as any, 'ensureTextIndex').mockImplementation(async (client: unknown) => {
            entered.resolve();
            await resume.promise;
            return original(client);
        });
        const takeover = b.connect();
        await entered.promise;
        const attempted = deferred();
        const tryLock = (a as any).tryLock.bind(a);
        jest.spyOn(a as any, 'tryLock').mockImplementation(async (...args: unknown[]) => {
            const acquired = await tryLock(...args);
            if (!acquired) attempted.resolve();
            return acquired;
        });
        const write = a.saveSyncState('stale', 'no').catch(error => error);
        await attempted.promise;
        resume.resolve();
        await takeover;
        expect(await write).toBeInstanceOf(IndexOwnershipLostError);
        expect((await raw.query("SELECT indisvalid FROM pg_index WHERE indexrelid='idx_did_docs_doc_trgm'::regclass")).rows[0].indisvalid).toBe(true);
    });

    it('bounds schema-lock waits without losing the connection or leaking a lock', async () => {
        const previous = process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS;
        process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS = '40';
        let db: Postgres;
        try { db = await open(); }
        finally {
            if (previous === undefined) delete process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS;
            else process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS = previous;
        }
        await lock(SEARCH_SCHEMA_LOCK);
        await expect(db!.getDID(seedDID)).rejects.toBeInstanceOf(SearchUnavailableError);
        await unlock(SEARCH_SCHEMA_LOCK);
        expect(await db!.getDID(seedDID)).toBeNull();
    });

    it('cancels startup waiting for the writer lock without claiming ownership', async () => {
        const a = await open();
        await lock(SEARCH_WRITER_LOCK);
        const b = new Postgres(url);
        adapters.push(b);
        const abort = new AbortController();
        const waiting = b.connect(abort.signal).catch(error => error);
        abort.abort();
        expect((await waiting).name).toMatch(/Abort/);
        await unlock(SEARCH_WRITER_LOCK);
        expect(await a.getRole()).toBe('writer');
    });

    it('releases iterator guards before yielding and rejects stale metric scans on the next page', async () => {
        const a = await open();
        await a.applyIndexPage({ dids: Array.from({ length: 3 }, (_, n) => ({ did: `${seedDID}${n}`, events: [fixtureEvent] })), blocks: [] });
        const iterator = a.iterateDIDEventHistories(1)[Symbol.asyncIterator]();
        expect((await iterator.next()).done).toBe(false);
        const b = await open();
        expect(await b.getRole()).toBe('writer');
        await expect(iterator.next()).rejects.toBeInstanceOf(IndexOwnershipLostError);
    });

    it('rolls back a failed takeover without changing data, ownership or leaving locks', async () => {
        const a = await open();
        await a.applyIndexPage(page());
        await raw.query(`CREATE FUNCTION reject_search_owner() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture takeover failure'; END $$;
            CREATE TRIGGER reject_search_owner BEFORE UPDATE ON search_index_control
            FOR EACH ROW EXECUTE FUNCTION reject_search_owner()`);
        await expect(open()).rejects.toThrow('fixture takeover failure');
        expect(await a.getRole()).toBe('writer');
        expect(await a.getDID(seedDID)).toEqual({ value: 'kept' });
        await a.saveSyncState('after-failure', 'written');
        expect(await a.loadSyncState('after-failure')).toBe('written');
    });

    it('keeps the old owner fenced if initialization fails after ownership commits', async () => {
        const a = await open();
        const b = new Postgres(url);
        adapters.push(b);
        jest.spyOn(b as any, 'ensureTextIndex').mockRejectedValue(new Error('fixture index build failure') as never);
        await expect(b.connect()).rejects.toThrow('fixture index build failure');
        await expect(a.saveSyncState('stale', 'no')).rejects.toBeInstanceOf(IndexOwnershipLostError);
        const c = await open();
        await c.saveSyncState('recovered', 'yes');
        expect(await a.loadSyncState('recovered')).toBe('yes');
    });

    it('does not restore the previous owner when a commit reply is lost', async () => {
        const a = await open();
        const b = new Postgres(url);
        adapters.push(b);
        const checkout = (b as any).checkout.bind(b);
        jest.spyOn(b as any, 'checkout').mockImplementation(async (...args: unknown[]) => {
            const lease = await checkout(...args);
            const query = lease.client.query.bind(lease.client);
            jest.spyOn(lease.client, 'query').mockImplementation(async (...params: unknown[]) => {
                const result = await query(...params);
                if (params[0] === 'COMMIT') throw new Error('fixture lost commit reply');
                return result;
            });
            return lease;
        });
        await expect(b.connect()).rejects.toThrow('fixture lost commit reply');
        await expect(a.saveSyncState('stale', 'no')).rejects.toBeInstanceOf(IndexOwnershipLostError);
        expect(await a.getRole()).toBe('reader');
    });

    it('does not reclaim ownership when an initialized adapter reconnects', async () => {
        const a = await open();
        const b = await open();
        await (a as any).pool.end();
        (a as any).pool = new Pool({ connectionString: url });
        await a.connect();
        expect(await a.getRole()).toBe('reader');
        await expect(a.saveSyncState('stale', 'no')).rejects.toBeInstanceOf(IndexOwnershipLostError);
        expect(await b.getRole()).toBe('writer');
    });

    it('fails closed when the control table is missing instead of creating metadata through a read', async () => {
        const a = await open();
        await raw.query('DROP TABLE search_index_control');
        await expect(a.getRole()).rejects.toBeInstanceOf(SearchUnavailableError);
        await expect(a.saveSyncState('stale', 'no')).rejects.toBeInstanceOf(SearchUnavailableError);
        expect((await raw.query("SELECT to_regclass('search_index_control') AS control")).rows[0].control).toBeNull();
    });


    it('cancels an initialized adapter validation with the caller signal', async () => {
        const previous = process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS;
        process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS = '50';
        let db: Postgres;
        try { db = await open(); }
        finally {
            if (previous === undefined) delete process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS;
            else process.env.KC_SEARCH_SERVER_SEARCH_TIMEOUT_MS = previous;
        }
        await lock(SEARCH_SCHEMA_LOCK);
        const attempted = deferred();
        const originalTryLock = (db! as any).tryLock.bind(db!);
        jest.spyOn(db! as any, 'tryLock').mockImplementation(async (...args: unknown[]) => {
            const acquired = await originalTryLock(...args);
            if (!acquired) attempted.resolve();
            return acquired;
        });
        const abort = new AbortController();
        const validation = db!.connect(abort.signal).catch(error => error);
        try {
            await attempted.promise;
            abort.abort();
            expect((await validation).name).toBe('AbortError');
        } finally {
            await unlock(SEARCH_SCHEMA_LOCK);
        }
        expect(await db!.getRole()).toBe('writer');
    });

    it('keeps metric replacement and later owned mutations in the same rollback boundary', async () => {
        const db = await open();
        const snapshot = {
            date: '2026-04-01', didCount: 1, didCountsByPrefix: { 'did:test': 1 },
            agentDidCount: 0, agentDidCountsByPrefix: {}, credentialCount: 0,
            credentialDidCountsByPrefix: {}, schemas: [], rebuiltAt: '2026-04-02T00:00:00.000Z',
        };
        await db.replaceNetworkMetricSnapshots([snapshot]);
        const failure = new Error('fixture later mutation failed');
        await expect((db as any).withWrite(async () => {
            await db.replaceNetworkMetricSnapshots([{ ...snapshot, didCount: 2 }]);
            await db.saveSyncState('inside-transaction', 'not committed');
            throw failure;
        })).rejects.toBe(failure);
        expect(await db.getNetworkMetricSnapshot(snapshot.date)).toEqual(snapshot);
        expect(await db.loadSyncState('inside-transaction')).toBeNull();
    });

});
