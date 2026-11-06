import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { jest } from '@jest/globals';
import DbMongo from '@mdip/gatekeeper/db/mongo.ts';
import DbPostgres from '@mdip/gatekeeper/db/postgres.ts';
import DbRedis from '@mdip/gatekeeper/db/redis.ts';
import DbSqlite from '@mdip/gatekeeper/db/sqlite.ts';
import type { GatekeeperDb, GatekeeperEvent, LifecycleMetadata } from '@mdip/gatekeeper/types';

const cutoff = Date.parse('2026-01-01T00:00:00.000Z');
const expiry = new Date(cutoff - 1000).toISOString();
const future = new Date(cutoff + 1000).toISOString();
const did = (suffix: string) => `did:test:${suffix}`;

function createEvent(suffix: string, validUntil = expiry, type: 'agent' | 'asset' = 'agent', controller = 'zController'): GatekeeperEvent {
    return {
        did: did(suffix), registry: 'local', time: '2025-01-01T00:00:00.000Z', operation: {
            type: 'create', created: '2025-01-01T00:00:00.000Z',
            mdip: { version: 1, type, registry: 'local', ...(validUntil && { validUntil }) },
            ...(type === 'asset' && { controller: did(controller) }),
        },
    };
}

function updateEvent(suffix: string, validUntil?: string, controller?: string): GatekeeperEvent {
    return {
        did: did(suffix), registry: 'local', time: '2025-01-01T00:00:01.000Z', operation: {
            type: 'update', did: did(suffix), doc: {
                didDocument: { id: did(suffix), ...(controller && { controller: did(controller) }) },
                didDocumentData: {}, mdip: {
                    version: 1, type: controller ? 'asset' : 'agent', registry: 'local',
                    ...(validUntil && { validUntil }),
                },
            },
        },
    };
}

type Kind = 'sqlite' | 'postgres' | 'mongo' | 'redis';
interface Fixture {
    db: GatekeeperDb;
    close(): Promise<void>;
    rawEvent(suffix: string, event: GatekeeperEvent): Promise<void>;
    removeLifecycleStructure(): Promise<void>;
    getMetadata(): Promise<LifecycleMetadata>;
    setMetadata(value: unknown): Promise<void>;
}

async function createFixture(kind: Kind): Promise<Fixture> {
    const namespace = `lifecycle_${randomUUID().replaceAll('-', '')}`;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-native-lifecycle-'));
    const envNames = { postgres: 'KC_POSTGRES_URL', mongo: 'KC_MONGODB_URL', redis: 'KC_REDIS_URL' } as const;
    const testNames = {
        postgres: 'KC_LIFECYCLE_POSTGRES_TEST_URL', mongo: 'KC_LIFECYCLE_MONGO_TEST_URL', redis: 'KC_LIFECYCLE_REDIS_TEST_URL',
    } as const;
    const previous = kind === 'sqlite' ? undefined : process.env[envNames[kind]];
    let admin: Pool | undefined;
    if (kind !== 'sqlite') process.env[envNames[kind]] = process.env[testNames[kind]];
    if (kind === 'postgres') {
        admin = new Pool({ connectionString: process.env[testNames.postgres] });
        // The schema name contains only this test's fixed prefix and a generated hexadecimal UUID.
        // eslint-disable-next-line sonarjs/sql-queries
        await admin.query(`CREATE SCHEMA "${namespace}"`);
        const url = new URL(process.env[testNames.postgres]!);
        url.searchParams.set('options', `-c search_path=${namespace}`);
        process.env.KC_POSTGRES_URL = url.toString();
    }
    const db: GatekeeperDb = kind === 'sqlite' ? new DbSqlite(namespace, folder)
        : kind === 'postgres' ? new DbPostgres(namespace)
            : kind === 'mongo' ? new DbMongo(namespace) : new DbRedis(namespace);
    try {
        await db.start();
    } catch (error) {
        await db.stop();
        if (admin) {
            // eslint-disable-next-line sonarjs/sql-queries
            await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
            await admin.end();
        }
        fs.rmSync(folder, { recursive: true, force: true });
        if (kind !== 'sqlite') {
            if (previous === undefined) delete process.env[envNames[kind]];
            else process.env[envNames[kind]] = previous;
        }
        throw error;
    }
    const handle = db as any;
    async function setMetadata(value: unknown) {
        const serialized = JSON.stringify(value);
        if (kind === 'sqlite') await handle.db.run("UPDATE metadata SET value = ? WHERE key = 'lifecycle'", serialized);
        if (kind === 'postgres') await handle.pool.query("UPDATE gatekeeper_metadata SET value = $2 WHERE namespace = $1 AND key = 'lifecycle'", [namespace, serialized]);
        if (kind === 'mongo') await handle.db.collection('metadata').updateOne({ id: 'lifecycle' }, { $set: { value: serialized } });
        if (kind === 'redis') await handle.redis.set(`${namespace}/lifecycle/metadata`, serialized);
    }
    return {
        db,
        getMetadata: () => db.getLifecycleMetadata(),
        setMetadata,
        async close() {
            try {
                if (kind === 'mongo') await handle.db.dropDatabase();
                else await db.resetDb();
            } finally {
                await db.stop();
                if (admin) {
                    // eslint-disable-next-line sonarjs/sql-queries
                    await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
                    await admin.end();
                }
                fs.rmSync(folder, { recursive: true, force: true });
                if (kind !== 'sqlite') {
                    if (previous === undefined) delete process.env[envNames[kind]];
                    else process.env[envNames[kind]] = previous;
                }
            }
        },
        async rawEvent(suffix, event) {
            const serialized = JSON.stringify(event);
            if (kind === 'sqlite') {
                await handle.db.run('INSERT OR REPLACE INTO dids(id, events) VALUES (?, ?)', suffix, JSON.stringify([event]));
                await handle.db.run("INSERT INTO index_changes(kind, did, event) VALUES ('did', ?, ?)", did(suffix), serialized);
            }
            if (kind === 'postgres') {
                await handle.pool.query('DELETE FROM gatekeeper_events WHERE namespace = $1 AND id = $2', [namespace, suffix]);
                await handle.pool.query('INSERT INTO gatekeeper_events(namespace, id, seq, event) VALUES ($1, $2, 0, $3)', [namespace, suffix, serialized]);
                await handle.pool.query("INSERT INTO gatekeeper_index_changes(namespace, kind, did, event) VALUES ($1, 'did', $2, $3)", [namespace, did(suffix), serialized]);
            }
            if (kind === 'mongo') {
                await handle.db.collection('dids').updateOne({ id: suffix }, { $set: { events: [event] } }, { upsert: true });
                const seq = await handle.nextIndexSeq(undefined);
                await handle.db.collection('index_changes').insertOne({ seq, kind: 'did', did: did(suffix), event });
            }
            if (kind === 'redis') {
                await handle.redis.del(`${namespace}/dids/${suffix}`);
                await handle.redis.rpush(`${namespace}/dids/${suffix}`, serialized);
                await handle.redis.zadd(`${namespace}/index/dids`, 0, suffix);
                const seq = await handle.redis.incr(`${namespace}/index/seq`);
                await handle.redis.zadd(`${namespace}/index/changes/zset`, seq, JSON.stringify({ seq, kind: 'did', did: did(suffix), event }));
            }
        },
        async removeLifecycleStructure() {
            if (kind === 'sqlite') await handle.db.exec('DROP TABLE lifecycle');
            if (kind === 'postgres') await handle.pool.query('DROP TABLE gatekeeper_lifecycle');
            if (kind === 'mongo') await handle.db.collection('lifecycle').drop();
            if (kind === 'redis') await handle.redis.del(`${namespace}/lifecycle/rows`);
        },
    };
}

const kinds: Kind[] = ['sqlite'];
if (process.env.KC_LIFECYCLE_POSTGRES_TEST_URL) kinds.push('postgres');
if (process.env.KC_LIFECYCLE_MONGO_TEST_URL) kinds.push('mongo');
if (process.env.KC_LIFECYCLE_REDIS_TEST_URL) kinds.push('redis');

describe.each(kinds)('%s native lifecycle persistence', kind => {
    let fixture: Fixture;
    beforeEach(async () => {
        fixture = undefined as unknown as Fixture;
        fixture = await createFixture(kind);
    });
    afterEach(async () => { await fixture?.close(); });

    it('commits expiry metadata with an event and publication queues', async () => {
        const event = createEvent('zAgent');
        await fixture.db.addEventAndQueue(event.did!, event, ['hyperswarm']);
        expect(await fixture.db.getEvents(event.did!)).toEqual([event]);
        expect(await fixture.db.getQueue('hyperswarm')).toEqual([event.operation]);
        expect(await fixture.db.getDueDIDs(cutoff, 10)).toMatchObject([{ suffix: 'zAgent', expiresAt: cutoff - 1000, type: 'agent' }]);
    });

    it('uses exact due boundaries and keyset pages for equal expirations', async () => {
        for (const suffix of ['zC', 'zA', 'zB']) await fixture.db.addEvent(did(suffix), createEvent(suffix));
        await fixture.db.addEvent(did('zEqual'), createEvent('zEqual', new Date(cutoff).toISOString()));
        await fixture.db.addEvent(did('zFuture'), createEvent('zFuture', future));
        const first = await fixture.db.getDueDIDs(cutoff, 2);
        expect(first.map(row => row.suffix)).toEqual(['zA', 'zB']);
        expect((await fixture.db.getDueDIDs(cutoff, 2, { expiresAt: first[1].expiresAt!, suffix: first[1].suffix })).map(row => row.suffix)).toEqual(['zC']);
    });

    it('indexes a new first create after replacing an existing history with an empty array', async () => {
        await fixture.db.addEvent(did('zRecreated'), createEvent('zRecreated'));
        const original = (await fixture.db.getLifecycle('zRecreated'))!;
        await fixture.db.saveExpirationJob(original.suffix, original);
        await fixture.db.setEvents(did('zRecreated'), []);
        const recreated = createEvent('zRecreated', future, 'asset', 'zNewController');
        await fixture.db.addEvent(recreated.did!, recreated);
        expect(await fixture.db.getLifecycle('zRecreated')).toMatchObject({
            type: 'asset', controller: 'zNewController', expiresAt: cutoff + 1000,
        });
        expect((await fixture.db.getControlledDIDs('zNewController', 10)).map(row => row.suffix)).toEqual(['zRecreated']);
        expect(await fixture.db.getExpirationJob('zRecreated')).toBeNull();
        expect(await fixture.db.getDueDIDs(cutoff, 10)).toEqual([]);
    });

    it('projects a delete from the state current at its atomic append boundary', async () => {
        if (kind !== 'postgres') return;
        await fixture.db.addEvent(did('zRenewed'), createEvent('zRenewed'));
        const pool = (fixture.db as any).pool;
        const query = pool.query.bind(pool);
        // Bypass the public writer lock to test the append statement's own projection boundary.
        const renew = () => (fixture.db as any).addEventStrict(pool, did('zRenewed'), 'zRenewed', updateEvent('zRenewed', future));
        let injected = false;
        const spy = jest.spyOn(pool, 'query').mockImplementation(async (text: unknown, ...args: unknown[]) => {
            const sql = typeof text === 'string' ? text : '';
            if (!injected) {
                injected = true;
                if (sql.startsWith('SELECT record FROM gatekeeper_lifecycle')) {
                    const stale = await query(text, ...args);
                    await renew();
                    return stale;
                }
                await renew();
            }
            return query(text, ...args);
        });
        try {
            await fixture.db.addEvent(did('zRenewed'), {
                did: did('zRenewed'), registry: 'local', time: '2025-01-01T00:00:02Z',
                operation: { type: 'delete', did: did('zRenewed') },
            });
        } finally {
            spy.mockRestore();
        }
        expect(await fixture.db.getEvents(did('zRenewed'))).toHaveLength(3);
        expect(await fixture.db.getLifecycle('zRenewed')).toMatchObject({ expiresAt: cutoff + 1000 });
        expect(await fixture.db.getDueDIDs(cutoff, 10)).toEqual([]);
    });

    it('serializes history replacement and repeated-create appends before their database snapshots', async () => {
        if (kind !== 'postgres') return;
        const db = fixture.db as any;
        const target = did('zSerialized');
        await fixture.db.setEvents(target, [
            createEvent('zSerialized', '', 'asset', 'zOld'),
            updateEvent('zSerialized', undefined, 'zOld'),
            updateEvent('zSerialized', undefined, 'zOld'),
        ]);
        let started: () => void = () => undefined;
        let release: () => void = () => undefined;
        const paused = new Promise<void>(resolve => { started = resolve; });
        const hold = new Promise<void>(resolve => { release = resolve; });
        const write = db.writeLifecycle.bind(db);
        const projection = jest.spyOn(db, 'writeLifecycle').mockImplementationOnce(async (...args: unknown[]) => {
            await write(...args);
            started();
            await hold;
        });
        const query = jest.spyOn(db.pool, 'query');
        let replacement: Promise<number | void> | undefined;
        let append: Promise<number | void> | undefined;
        try {
            replacement = fixture.db.setEvents(target, [createEvent('zSerialized', '', 'asset', 'zNew')]);
            await paused;
            query.mockClear();
            append = fixture.db.addEvent(target, createEvent('zSerialized', '', 'asset', 'zOld'));
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(query).not.toHaveBeenCalled();
            release();
            await Promise.all([replacement, append]);
            expect((await fixture.db.getEvents(target)).map(event => event.operation.type)).toEqual(['create', 'create']);
            expect(await fixture.db.getLifecycle(target)).toMatchObject({ controller: 'zNew' });
            expect(await fixture.db.getControlledDIDs('zOld', 10)).toEqual([]);
            expect((await fixture.db.getControlledDIDs('zNew', 10)).map(row => row.suffix)).toEqual(['zSerialized']);
        } finally {
            release();
            await Promise.allSettled([replacement, append]);
            projection.mockRestore();
            query.mockRestore();
        }
    });

    it('clears omitted fields from full replacements and moves reverse membership', async () => {
        await fixture.db.addEvent(did('zAsset'), createEvent('zAsset', '', 'asset', 'zOld'));
        await fixture.db.addEvent(did('zAsset'), updateEvent('zAsset', undefined, 'zNew'));
        expect(await fixture.db.getControlledDIDs(did('zOld'), 10)).toEqual([]);
        expect((await fixture.db.getControlledDIDs('zNew', 10)).map(row => row.suffix)).toEqual(['zAsset']);
        await fixture.db.addEvent(did('zAsset'), updateEvent('zAsset'));
        expect(await fixture.db.getLifecycle(did('zAsset'))).toBeNull();
        expect(await fixture.db.getControlledDIDs('zNew', 10)).toEqual([]);
    });

    it('retains expiry and removes controller membership on signed deletion', async () => {
        await fixture.db.addEvent(did('zAsset'), createEvent('zAsset', expiry, 'asset'));
        const event: GatekeeperEvent = { did: did('zAsset'), registry: 'local', time: '2025-01-01T00:00:02Z', operation: { type: 'delete', did: did('zAsset') } };
        await fixture.db.addEvent(did('zAsset'), event);
        expect(await fixture.db.getControlledDIDs('zController', 10)).toEqual([]);
        expect(await fixture.db.getLifecycle(did('zAsset'))).toMatchObject({ expiresAt: cutoff - 1000 });
        expect((await fixture.db.getLifecycle(did('zAsset')))?.controller).toBeUndefined();
    });

    it('keeps exact expiry values across delete serialization throughout the Date range', async () => {
        const extreme = 8_640_000_000_000_000 - 1;
        await fixture.db.addEvent(did('zAsset'), createEvent('zAsset', new Date(extreme).toISOString(), 'asset'));
        await fixture.db.addEvent(did('zAsset'), { did: did('zAsset'), registry: 'local', time: '2025-01-01T00:00:02Z', operation: { type: 'delete', did: did('zAsset') } });
        expect((await fixture.db.getLifecycle(did('zAsset')))?.expiresAt).toBe(extreme);
        expect((await fixture.db.getDueDIDs(extreme + 1, 10)).map(row => row.suffix)).toEqual(['zAsset']);
    });

    it('restores due selection after deletion clears an ambiguous legacy controller', async () => {
        const extreme = 8_640_000_000_000_000 - 1;
        for (const [suffix, expiresAt] of [['zPast', cutoff - 1000], ['zExtreme', extreme]] as const) {
            await fixture.db.addEvent(did(suffix), createEvent(suffix, new Date(expiresAt).toISOString(), 'asset'));
            const malformed = updateEvent(suffix, new Date(expiresAt).toISOString(), 'zController');
            malformed.operation.doc!.didDocument!.controller = {} as string;
            await fixture.db.addEvent(did(suffix), malformed);
            expect((await fixture.db.getLifecycle(suffix))?.controllerUnknown).toBe(true);
            expect((await fixture.db.getDueDIDs(expiresAt + 1, 10)).some(row => row.suffix === suffix)).toBe(false);
            await fixture.db.addEvent(did(suffix), { did: did(suffix), registry: 'local', time: '2025-01-01T00:00:02Z', operation: { type: 'delete', did: did(suffix) } });
            expect(await fixture.db.getLifecycle(suffix)).toMatchObject({ expiresAt });
            expect((await fixture.db.getLifecycle(suffix))?.unresolved).toBeUndefined();
            expect((await fixture.db.getDueDIDs(expiresAt + 1, 10)).some(row => row.suffix === suffix)).toBe(true);
        }
    });

    it('preserves interrupted jobs during manual removal and restart', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        const row = (await fixture.db.getLifecycle('zAgent'))!;
        await fixture.db.saveExpirationJob(row.suffix, { ...row, dependentCursor: 'zChild' });
        await fixture.db.deleteEvents(did('zAgent'));
        await fixture.db.stop();
        await fixture.db.start();
        expect(await fixture.db.getExpirationJob('zAgent')).toMatchObject({ dependentCursor: 'zChild' });
        expect((await fixture.db.getExpirationJobs(10)).map(job => job.suffix)).toEqual(['zAgent']);
    });

    it('preserves interrupted jobs when direct history replacement removes the agent', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        const row = (await fixture.db.getLifecycle('zAgent'))!;
        await fixture.db.saveExpirationJob(row.suffix, { ...row, dependentCursor: 'zChild' });
        await fixture.db.setEvents(did('zAgent'), []);
        expect(await fixture.db.getLifecycle('zAgent')).toBeNull();
        expect(await fixture.db.getExpirationJob('zAgent')).toMatchObject({ dependentCursor: 'zChild' });
    });

    it('keeps direct create appends consistent with the existing resolved state', async () => {
        await fixture.db.addEvent(did('zAsset'), createEvent('zAsset', expiry, 'asset', 'zCurrent'));
        const later = createEvent('zAsset', future, 'asset', 'zOther');
        await fixture.db.addEvent(did('zAsset'), later);
        expect(await fixture.db.getLifecycle('zAsset')).toMatchObject({ controller: 'zCurrent', expiresAt: cutoff - 1000 });
        expect(await fixture.db.getControlledDIDs('zOther', 10)).toEqual([]);
        await fixture.db.addEvent(did('zSparse'), createEvent('zSparse', ''));
        await fixture.db.addEvent(did('zSparse'), createEvent('zSparse', expiry, 'asset', 'zOther'));
        expect(await fixture.db.getLifecycle('zSparse')).toBeNull();
    });

    it('preserves progress for payload updates and cancels it on renewal', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        const row = (await fixture.db.getLifecycle('zAgent'))!;
        await fixture.db.saveExpirationJob(row.suffix, { ...row, dependentCursor: 'zChild' });
        await fixture.db.addEvent(did('zAgent'), updateEvent('zAgent', expiry));
        expect(await fixture.db.getExpirationJob('zAgent')).toMatchObject({ dependentCursor: 'zChild' });
        expect((await fixture.db.getLifecycle('zAgent'))?.revision).not.toBe(row.revision);
        await fixture.db.addEvent(did('zAgent'), updateEvent('zAgent', future));
        expect(await fixture.db.getExpirationJob('zAgent')).toBeNull();
    });

    it('rejects stale revision and epoch deletion preconditions', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        const state = await fixture.db.getLifecycleMetadata();
        const old = (await fixture.db.getLifecycle('zAgent'))!;
        await fixture.db.addEvent(did('zAgent'), updateEvent('zAgent', future));
        expect(await fixture.db.deleteEvents(did('zAgent'), { epoch: state.epoch, revision: old.revision })).toBe(0);
        const current = (await fixture.db.getLifecycle('zAgent'))!;
        expect(await fixture.db.deleteEvents(did('zAgent'), { epoch: randomUUID(), revision: current.revision })).toBe(0);
        expect((await fixture.db.getEvents(did('zAgent')))).toHaveLength(2);
        expect(await fixture.db.deleteEvents(did('zAgent'), { epoch: state.epoch, revision: current.revision })).toBeGreaterThan(0);
    });

    it('rebuilds metadata after an older writer changes an already indexed DID', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        await fixture.db.initializeLifecycleIndex();
        const epoch = (await fixture.getMetadata()).epoch;
        await fixture.rawEvent('zAgent', createEvent('zAgent', future));
        await fixture.db.initializeLifecycleIndex();
        expect(await fixture.db.getDueDIDs(cutoff, 10)).toEqual([]);
        expect((await fixture.db.getLifecycle('zAgent'))?.expiresAt).toBe(cutoff + 1000);
        expect((await fixture.getMetadata()).epoch).toBe(epoch);
    });

    it('uses the stored key rather than a mismatched envelope during backfill', async () => {
        const event = createEvent('zOther');
        await fixture.rawEvent('zStored', event);
        await fixture.db.initializeLifecycleIndex();
        expect(await fixture.db.getLifecycle('zOther')).toBeNull();
        expect((await fixture.db.getLifecycle('zStored'))?.suffix).toBe('zStored');
    });

    it('detects a lost lifecycle structure rather than trusting its complete marker', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        await fixture.db.initializeLifecycleIndex();
        await fixture.removeLifecycleStructure();
        await fixture.db.stop();
        await fixture.db.start();
        expect((await fixture.db.getDueDIDs(cutoff, 10)).map(row => row.suffix)).toEqual(['zAgent']);
    });

    it('rejects malformed lifecycle metadata without removing accepted events', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        const state = await fixture.getMetadata();
        await fixture.setMetadata({ ...state, complete: 'yes' });
        await expect(fixture.db.initializeLifecycleIndex()).rejects.toThrow('lifecycle');
        await expect(fixture.db.getLifecycleMetadata()).rejects.toThrow('Lifecycle');
        await expect(fixture.db.deleteEvents(did('zAgent'), { epoch: state.epoch, revision: (await fixture.db.getLifecycle('zAgent'))!.revision })).rejects.toThrow('Lifecycle');
        expect(await fixture.db.getEvents(did('zAgent'))).toHaveLength(1);
    });

    it('restarts incomplete backfill after an older writer changes an earlier key', async () => {
        await fixture.db.addEvent(did('zA'), createEvent('zA'));
        await fixture.db.addEvent(did('zZ'), createEvent('zZ'));
        await fixture.db.initializeLifecycleIndex();
        const state = await fixture.getMetadata();
        await fixture.setMetadata({ ...state, complete: false, backfillCursor: 'zM' });
        await fixture.rawEvent('zA', createEvent('zA', future));
        await fixture.db.initializeLifecycleIndex();
        expect((await fixture.db.getLifecycle('zA'))?.expiresAt).toBe(cutoff + 1000);
        expect((await fixture.db.getDueDIDs(cutoff, 10)).map(row => row.suffix)).toEqual(['zZ']);
    });

    it('resumes from the last durable backfill page after a failure', async () => {
        for (let i = 0; i < 105; i += 1) {
            const suffix = `z${String(i).padStart(3, '0')}`;
            await fixture.rawEvent(suffix, createEvent(suffix));
        }
        const handle = fixture.db as any;
        const target = kind === 'redis' ? handle.redis : handle;
        const method = kind === 'redis' ? 'set' : 'saveLifecycleMetadata';
        const original = target[method].bind(target);
        const save = jest.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
            const state = kind === 'redis' ? (String(args[0]).endsWith('/metadata') ? JSON.parse(String(args[1])) : undefined)
                : kind === 'postgres' ? args[1] as LifecycleMetadata : args[0] as LifecycleMetadata;
            if (state?.backfillCursor === 'z104') throw new Error('backfill persistence failed');
            return original(...args);
        });
        try {
            await expect(fixture.db.initializeLifecycleIndex()).rejects.toThrow('backfill persistence failed');
        } finally {
            save.mockRestore();
        }
        let raw: string;
        if (kind === 'sqlite') raw = (await handle.db.get("SELECT value FROM metadata WHERE key = 'lifecycle'")).value;
        else if (kind === 'postgres') raw = (await handle.pool.query("SELECT value FROM gatekeeper_metadata WHERE namespace = $1 AND key = 'lifecycle'", [handle.dbName])).rows[0].value;
        else if (kind === 'mongo') raw = (await handle.db.collection('metadata').findOne({ id: 'lifecycle' })).value;
        else raw = await handle.redis.get(`${handle.dbName}/lifecycle/metadata`);
        expect(JSON.parse(raw)).toMatchObject({ complete: false, backfillCursor: 'z099' });
        await expect(fixture.db.getLifecycleMetadata()).rejects.toThrow('Lifecycle');
        await fixture.db.initializeLifecycleIndex();
        expect((await fixture.db.getLifecycleMetadata()).complete).toBe(true);
        expect(await fixture.db.getDueDIDs(cutoff, 1000)).toHaveLength(105);
    }, 30_000);

    it('preserves partial cleanup jobs when a same-epoch projection rebuild is needed', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        const row = (await fixture.db.getLifecycle('zAgent'))!;
        await fixture.db.saveExpirationJob('zAgent', { ...row, dependentCursor: 'zChild' });
        await fixture.db.deleteEvents(did('zAgent'));
        const state = await fixture.getMetadata();
        await fixture.setMetadata({ ...state, checkedCursor: '9999999' });
        await fixture.db.initializeLifecycleIndex();
        expect(await fixture.db.getExpirationJob('zAgent')).toMatchObject({ dependentCursor: 'zChild' });
    });

    it('does not allow cleanup against a failed reset', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        const row = (await fixture.db.getLifecycle('zAgent'))!;
        await fixture.db.saveExpirationJob('zAgent', { ...row, dependentCursor: 'zChild' });
        const state = await fixture.db.getLifecycleMetadata();
        const handle = fixture.db as any;
        let restore: () => Promise<void>;
        if (kind === 'sqlite') {
            await handle.db.exec("CREATE TRIGGER reject_reset BEFORE DELETE ON dids BEGIN SELECT RAISE(FAIL, 'reset failed'); END");
            restore = () => handle.db.exec('DROP TRIGGER reject_reset');
        } else if (kind === 'postgres') {
            await handle.pool.query(`CREATE FUNCTION reject_reset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reset failed'; END; $$;
                CREATE TRIGGER reject_reset BEFORE DELETE ON gatekeeper_events FOR EACH ROW EXECUTE FUNCTION reject_reset()`);
            restore = () => handle.pool.query('DROP TRIGGER reject_reset ON gatekeeper_events; DROP FUNCTION reject_reset()');
        } else if (kind === 'mongo') {
            const original = handle.db.collection.bind(handle.db);
            const spy = jest.spyOn(handle.db, 'collection').mockImplementation((...args: unknown[]) => {
                const collection = original(...args);
                if (args[0] === 'dids') return { deleteMany: async () => { throw new Error('reset failed'); } };
                return collection;
            });
            restore = async () => spy.mockRestore();
        } else {
            const spy = jest.spyOn(handle.redis, 'scan').mockRejectedValueOnce(new Error('reset failed'));
            restore = async () => spy.mockRestore();
        }
        try {
            await expect(fixture.db.resetDb()).rejects.toThrow('reset failed');
        } finally {
            await restore();
        }
        expect(await fixture.db.getEvents(did('zAgent'))).toHaveLength(1);
        expect(await fixture.db.getExpirationJob('zAgent')).toMatchObject({ dependentCursor: 'zChild' });
        if (kind === 'redis') {
            await expect(fixture.db.getLifecycleMetadata()).rejects.toThrow('Lifecycle');
            await expect(fixture.db.deleteEvents(did('zAgent'), { epoch: state.epoch, revision: row.revision })).rejects.toThrow('Lifecycle');
            await fixture.db.initializeLifecycleIndex();
        }
        expect((await fixture.db.getLifecycleMetadata()).epoch).toBe(state.epoch);
        expect(await fixture.db.getEvents(did('zAgent'))).toHaveLength(1);
    });

    it('records unknown lifecycle state conservatively and clears it after repair', async () => {
        const event: GatekeeperEvent = { did: did('zBad'), registry: 'local', time: '2025-01-01T00:00:00Z', operation: { type: 'update', doc: {} } };
        await fixture.db.setEvents(did('zBad'), [event]);
        expect(await fixture.db.hasUnresolvedLifecycle()).toBe(true);
        expect(await fixture.db.getDueDIDs(cutoff, 10)).toEqual([]);
        await fixture.db.setEvents(did('zBad'), [createEvent('zBad')]);
        expect(await fixture.db.hasUnresolvedLifecycle()).toBe(false);
    });

    it('does not confuse a malformed expiry with unknown controller coverage', async () => {
        await fixture.db.addEvent(did('zMalformedDate'), createEvent('zMalformedDate', 'not-a-date', 'asset'));
        expect(await fixture.db.hasUnresolvedLifecycle()).toBe(false);
        expect(await fixture.db.getDueDIDs(cutoff, 10)).toEqual([]);
        expect((await fixture.db.getControlledDIDs('zController', 10)).map(row => row.suffix)).toEqual(['zMalformedDate']);
    });

    it('queries only lifecycle indexes with a mostly non-expiring population', async () => {
        const handle = fixture.db as any;
        if (kind === 'sqlite') await handle.db.exec('BEGIN');
        for (let i = 0; i < 500; i += 1) {
            const suffix = `zAsset${String(i).padStart(3, '0')}`;
            await fixture.rawEvent(suffix, createEvent(suffix, '', 'asset', i < 3 ? 'zChosen' : `zOwner${i}`));
        }
        for (let i = 0; i < 3; i += 1) await fixture.rawEvent(`zDue${i}`, createEvent(`zDue${i}`));
        if (kind === 'sqlite') await handle.db.exec('COMMIT');
        await fixture.db.initializeLifecycleIndex();
        const getEvents = jest.spyOn(fixture.db, 'getEvents');
        try {
            expect(await fixture.db.getDueDIDs(cutoff, 10)).toHaveLength(3);
            expect(await fixture.db.getControlledDIDs('zChosen', 10)).toHaveLength(3);
            expect(getEvents).not.toHaveBeenCalled();
            if (kind === 'sqlite') {
                await handle.db.exec('ANALYZE lifecycle');
                const plan = await handle.db.all(`EXPLAIN QUERY PLAN SELECT record FROM lifecycle
                    WHERE kind = 'did' AND unresolved = 0 AND expires_at < ? ORDER BY expires_at, id LIMIT 10`, cutoff);
                expect(JSON.stringify(plan)).toContain('lifecycle_due');
            } else if (kind === 'postgres') {
                await handle.pool.query('ANALYZE gatekeeper_lifecycle');
                const plan = await handle.pool.query(`EXPLAIN (FORMAT JSON) SELECT record FROM gatekeeper_lifecycle
                    WHERE namespace = $1 AND kind = 'did' AND NOT unresolved AND expires_at < $2
                    ORDER BY expires_at, id LIMIT 10`, [handle.dbName, cutoff]);
                expect(JSON.stringify(plan.rows)).toContain('gatekeeper_lifecycle_due');
                const query = jest.spyOn(handle.pool, 'query');
                try {
                    await fixture.db.addEvent(did('zAppend'), createEvent('zAppend'));
                    expect(query).toHaveBeenCalledTimes(1);
                    query.mockClear();
                    await fixture.db.addEvent(did('zAppend'), updateEvent('zAppend', future));
                    expect(query).toHaveBeenCalledTimes(1);
                } finally {
                    query.mockRestore();
                }
            } else if (kind === 'mongo') {
                const plan = await handle.db.collection('lifecycle').find({ kind: 'did', unresolved: false, expiresAt: { $lt: cutoff, $ne: null } })
                    .sort({ expiresAt: 1, id: 1 }).limit(10).explain();
                expect(JSON.stringify(plan)).toContain('lifecycle_due');
            } else {
                expect(await handle.redis.zcard(`${handle.dbName}/lifecycle/due`)).toBe(3);
                expect(await handle.redis.zcard(`${handle.dbName}/lifecycle/controllers`)).toBe(500);
            }
        } finally {
            getEvents.mockRestore();
        }
    }, 30_000);

    it('clears an empty replacement without retaining stale metadata', async () => {
        await fixture.db.addEvent(did('zAgent'), createEvent('zAgent'));
        await fixture.db.setEvents(did('zAgent'), []);
        expect(await fixture.db.getLifecycle('zAgent')).toBeNull();
        expect(await fixture.db.getDueDIDs(cutoff, 10)).toEqual([]);
    });

    it('rolls back history and queue writes when lifecycle persistence fails', async () => {
        const db = fixture.db as any;
        let restore: () => Promise<void> = async () => undefined;
        if (kind === 'sqlite') {
            await db.db.exec("CREATE TRIGGER reject_lifecycle_write BEFORE INSERT ON lifecycle BEGIN SELECT RAISE(FAIL, 'lifecycle write failed'); END");
            restore = () => db.db.exec('DROP TRIGGER reject_lifecycle_write');
        } else if (kind === 'postgres') {
            await db.pool.query(`CREATE OR REPLACE FUNCTION reject_lifecycle_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'lifecycle write failed'; END; $$;
                CREATE TRIGGER reject_lifecycle_write BEFORE INSERT ON gatekeeper_lifecycle FOR EACH ROW EXECUTE FUNCTION reject_lifecycle_write()`);
            restore = () => db.pool.query('DROP TRIGGER reject_lifecycle_write ON gatekeeper_lifecycle; DROP FUNCTION reject_lifecycle_write()');
        } else if (kind === 'mongo') {
            const spy = jest.spyOn(db, 'writeLifecycle').mockRejectedValueOnce(new Error('lifecycle write failed'));
            restore = async () => spy.mockRestore();
        } else {
            await db.redis.set(`${db.dbName}/lifecycle/unknown`, 'wrong type');
            restore = () => db.redis.del(`${db.dbName}/lifecycle/unknown`);
        }
        try {
            const event = createEvent('zAgent');
            await expect(fixture.db.addEventAndQueue(event.did!, event, ['hyperswarm'])).rejects.toThrow();
            expect(await fixture.db.getEvents(event.did!)).toEqual([]);
            expect(await fixture.db.getQueue('hyperswarm')).toEqual([]);
            expect(await fixture.db.getLifecycle('zAgent')).toBeNull();
        } finally {
            await restore();
        }
    });
});
