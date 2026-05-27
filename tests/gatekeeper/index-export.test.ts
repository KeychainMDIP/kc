import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import DbMongo from '@mdip/gatekeeper/db/mongo.ts';
import DbPostgres from '@mdip/gatekeeper/db/postgres.ts';
import DbRedis from '@mdip/gatekeeper/db/redis.ts';
import DbSqlite from '@mdip/gatekeeper/db/sqlite.ts';
import {
    BlockInfo,
    GatekeeperDb,
    GatekeeperEvent,
    IndexChangeRecord,
} from '@mdip/gatekeeper/types';
import {
    buildIndexSnapshotResponseFromPageKeys,
    exportIndexSnapshotFromAllKeysForLocalDb,
    normalizeIndexExportLimit,
    parseIndexExportCursor,
} from '@mdip/gatekeeper/db/index-export.ts';
import { parseIndexExportRequest } from '../../services/gatekeeper/server/src/helpers.ts';

function createEvent(did: string, time: string, type: 'create' | 'update' = 'create'): GatekeeperEvent {
    return {
        registry: 'local',
        time,
        ordinal: [0],
        did,
        operation: {
            type,
            ...(type === 'update' && { did }),
        },
    };
}

const didA = 'did:test:z1';
const didB = 'did:test:z2';
const eventA = createEvent(didA, '2026-01-01T00:00:01.000Z');
const eventB = createEvent(didB, '2026-01-01T00:00:02.000Z');
const block: BlockInfo = {
    height: 7,
    hash: 'block-7',
    time: 1775037600,
};

interface AdapterFixture {
    db: GatekeeperDb;
    cleanup?: () => Promise<void> | void;
}

function parseStoredEvent(value: unknown): GatekeeperEvent {
    return typeof value === 'string'
        ? JSON.parse(value) as GatekeeperEvent
        : value as GatekeeperEvent;
}

function cloneJSONMap<T>(source: Map<string, T>): Map<string, T> {
    return new Map(Array.from(source.entries()).map(([key, value]) => [
        key,
        JSON.parse(JSON.stringify(value)) as T,
    ]));
}

function requireActiveMap<T>(source: Map<string, T> | null, label: string): Map<string, T> {
    if (!source) {
        throw new Error(`Expected active ${label} transaction`);
    }

    return source;
}

function fixtureBlockKey(registry: string, hash: string): string {
    return `${registry}\u0000${hash}`;
}

async function createMemoryFixture(): Promise<AdapterFixture> {
    const db = new DbJsonMemory('index-export-memory');
    await db.resetDb();
    await seedAdapter(db);

    return { db };
}

async function createSqliteFixture(): Promise<AdapterFixture> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-index-export-'));
    const db = new DbSqlite('sqlite', tempDir);
    await db.start();
    await db.resetDb();
    await seedAdapter(db);

    return {
        db,
        cleanup: async () => {
            await db.stop();
            fs.rmSync(tempDir, { recursive: true, force: true });
        },
    };
}

function createPostgresFixture(): AdapterFixture {
    const db = new DbPostgres('index-export-postgres');
    const eventsByKey = new Map<string, GatekeeperEvent[]>([
        ['z1', [eventA]],
        ['z2', [eventB]],
    ]);
    const changes = createIndexChanges();
    let nextChangeSeq = changes.length;

    function recordChange(params: unknown[]) {
        nextChangeSeq += 1;
        changes.push({
            seq: nextChangeSeq,
            kind: params[1] === 'block' ? 'block' : 'did',
            did: typeof params[2] === 'string' ? params[2] : undefined,
            registry: typeof params[3] === 'string' ? params[3] : undefined,
            block: params[4]
                ? JSON.parse(params[4] as string) as BlockInfo
                : undefined,
            removed: params[5] === true,
        });
    }

    const query = async (sql: string, params: unknown[] = []) => {
        const text = String(sql);

        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
            return { rows: [], rowCount: 0 };
        }

        if (text.includes('SELECT DISTINCT id')) {
            const cursor = typeof params[1] === 'string' ? params[1] : null;
            const limit = Number.isFinite(Number(params[2])) ? Number(params[2]) : Infinity;

            return {
                rows: Array.from(eventsByKey.keys())
                    .sort()
                    .filter(id => !cursor || id > cursor)
                    .slice(0, limit)
                    .map(id => ({ id })),
            };
        }

        if (text.includes('FROM gatekeeper_index_changes') && text.includes('SELECT COALESCE(MAX(seq)')) {
            return { rows: [{ seq: nextChangeSeq }], rowCount: 1 };
        }

        if (text.includes('SELECT COALESCE(MAX(seq)')) {
            const id = String(params[1]);
            return { rows: [{ seq: eventsByKey.get(id)?.length ?? 0 }] };
        }

        if (text.includes('DELETE FROM gatekeeper_events')) {
            const id = String(params[1]);
            const existed = eventsByKey.has(id);
            eventsByKey.delete(id);
            return { rows: [], rowCount: existed ? 1 : 0 };
        }

        if (text.includes('DELETE FROM gatekeeper_meta') ||
            text.includes('DELETE FROM gatekeeper_dids') ||
            text.includes('DELETE FROM gatekeeper_queue') ||
            text.includes('DELETE FROM gatekeeper_blocks') ||
            text.includes('DELETE FROM gatekeeper_index_changes')) {
            return { rows: [], rowCount: 1 };
        }

        if (text.includes('INSERT INTO gatekeeper_events')) {
            for (let i = 0; i < params.length; i += 4) {
                const id = String(params[i + 1]);
                const seq = Number(params[i + 2]);
                const events = eventsByKey.get(id) ?? [];
                events[seq] = parseStoredEvent(params[i + 3]);
                eventsByKey.set(id, events);
            }

            return { rows: [], rowCount: params.length / 4 };
        }

        if (text.includes('INSERT INTO gatekeeper_index_changes')) {
            recordChange(params);
            return { rows: [], rowCount: 1 };
        }

        if (text.includes('INSERT INTO gatekeeper_blocks')) {
            return { rows: [], rowCount: 1 };
        }

        if (text.includes('FROM gatekeeper_events')) {
            const id = String(params[1]);
            return {
                rows: (eventsByKey.get(id) ?? []).map(event => ({ event })),
            };
        }

        if (text.includes('FROM gatekeeper_index_changes')) {
            const afterSeq = Number(params[1]);
            const limit = Number(params[2]);
            return {
                rows: changes
                    .filter(change => change.seq > afterSeq)
                    .slice(0, limit),
            };
        }

        throw new Error(`Unexpected postgres query: ${text}`);
    };

    (db as any).pool = {
        query,
        connect: async () => ({
            query,
            release: () => undefined,
        }),
        end: async () => undefined,
    };

    return { db };
}

function createRedisFixture(): AdapterFixture {
    const dbName = 'index-export-redis';
    const db = new DbRedis(dbName);
    const indexSeqKey = `${dbName}/index/seq`;
    const indexChangesKey = `${dbName}/index/changes/zset`;
    const didIndexKey = `${dbName}/index/dids`;
    const lists = new Map<string, string[]>([
        [`${dbName}/dids/z1`, [JSON.stringify(eventA)]],
        [`${dbName}/dids/z2`, [JSON.stringify(eventB)]],
    ]);
    const strings = new Map<string, string>([
        [indexSeqKey, createIndexChanges().length.toString()],
    ]);
    const hashes = new Map<string, Map<string, string>>();
    const zsets = new Map<string, Map<string, number>>([
        [indexChangesKey, new Map(createIndexChanges().map(change => [
            JSON.stringify(change),
            change.seq,
        ]))],
        [didIndexKey, new Map([
            ['z1', 0],
            ['z2', 0],
        ])],
    ]);

    function rpush(key: string, ...values: string[]): number {
        const list = lists.get(key) ?? [];
        list.push(...values);
        lists.set(key, list);
        return list.length;
    }

    function del(...keys: string[]): number {
        let count = 0;

        for (const key of keys) {
            if (lists.delete(key)) {
                count += 1;
            }
            if (strings.delete(key)) {
                count += 1;
            }
            if (hashes.delete(key)) {
                count += 1;
            }
            if (zsets.delete(key)) {
                count += 1;
            }
        }

        return count;
    }

    function zadd(key: string, score: number | string, member: string): number {
        const zset = zsets.get(key) ?? new Map<string, number>();
        const existed = zset.has(member);
        zset.set(member, Number(score));
        zsets.set(key, zset);
        return existed ? 0 : 1;
    }

    function recordChange(change: Omit<IndexChangeRecord, 'seq'>): IndexChangeRecord {
        const seq = Number(strings.get(indexSeqKey) ?? '0') + 1;
        strings.set(indexSeqKey, seq.toString());
        const record = { seq, ...change };
        zadd(indexChangesKey, seq, JSON.stringify(record));
        return record;
    }

    function type(key: string): string {
        if (lists.has(key)) {
            return 'list';
        }
        if (strings.has(key)) {
            return 'string';
        }
        if (hashes.has(key)) {
            return 'hash';
        }
        if (zsets.has(key)) {
            return 'zset';
        }
        return 'none';
    }

    function setString(key: string, value: string | number) {
        strings.set(key, String(value));
        return 'OK';
    }

    function createMulti() {
        const ops: Array<() => unknown> = [];

        return {
            del(key: string) {
                ops.push(() => del(key));
                return this;
            },
            hset(key: string, field: string, value: string) {
                ops.push(() => {
                    const hash = hashes.get(key) ?? new Map<string, string>();
                    hash.set(field, value);
                    hashes.set(key, hash);
                    return 1;
                });
                return this;
            },
            rpush(key: string, ...values: string[]) {
                ops.push(() => rpush(key, ...values));
                return this;
            },
            set(key: string, value: string | number) {
                ops.push(() => setString(key, value));
                return this;
            },
            exec: async () => ops.map(op => [null, op()]),
        };
    }

    (db as any).redis = {
        del,
        get: async (key: string) => strings.get(key) ?? null,
        hset: async (key: string, field: string, value: string) => {
            const hash = hashes.get(key) ?? new Map<string, string>();
            hash.set(field, value);
            hashes.set(key, hash);
            return 1;
        },
        incr: async (key: string) => {
            const next = Number(strings.get(key) ?? '0') + 1;
            strings.set(key, next.toString());
            return next;
        },
        keys: async () => {
            throw new Error('Redis KEYS must not be called by index export');
        },
        lrange: async (key: string) => lists.get(key) ?? [],
        scan: async () => ['0', Array.from(lists.keys())],
        type: async (key: string) => type(key),
        multi: () => createMulti(),
        rpush,
        set: async (key: string, value: string | number) => setString(key, value),
        zadd: async (key: string, score: number | string, member: string) => zadd(key, score, member),
        zrangebylex: async (
            key: string,
            min: string,
            _max: string,
            _limit?: string,
            offset = 0,
            count = Infinity
        ) => {
            const after = min.startsWith('(') ? min.slice(1) : null;

            return Array.from(zsets.get(key)?.keys() ?? [])
                .filter(member => !after || member > after)
                .sort()
                .slice(offset, offset + count);
        },
        zrangebyscore: async (
            key: string,
            min: string,
            _max: string,
            _limit: string,
            offset: number,
            count: number
        ) => {
            const afterSeq = Number(min.startsWith('(') ? min.slice(1) : min);
            return Array.from(zsets.get(key)?.entries() ?? [])
                .filter(([, score]) => score > afterSeq)
                .sort((a, b) => a[1] - b[1])
                .slice(offset, offset + count)
                .map(([member]) => member);
        },
        eval: async (_script: string, keyCount: number, ...values: string[]) => {
            const keys = values.slice(0, keyCount);
            const args = values.slice(keyCount);

            if (keyCount === 4 && args.length === 3 && !/^\d+$/.test(args[0])) {
                const count = rpush(keys[0], args[0]);
                recordChange(JSON.parse(args[1]) as Omit<IndexChangeRecord, 'seq'>);
                zadd(keys[3], 0, args[2]);
                return count;
            }

            if (keyCount === 4 && args.length >= 3 && /^\d+$/.test(args[0])) {
                const count = Number(args[0]);
                del(keys[0]);
                if (count > 0) {
                    rpush(keys[0], ...args.slice(1, 1 + count));
                }
                recordChange(JSON.parse(args[count + 1]) as Omit<IndexChangeRecord, 'seq'>);
                zadd(keys[3], 0, args[count + 2]);
                return count;
            }

            if (keyCount === 4 && args.length === 2) {
                const removed = del(keys[0]);
                zsets.get(keys[3])?.delete(args[1]);
                if (removed > 0) {
                    recordChange(JSON.parse(args[0]) as Omit<IndexChangeRecord, 'seq'>);
                }
                return removed;
            }

            if (keyCount === 5) {
                const blockInfo = JSON.parse(args[0]) as BlockInfo;
                const height = Number(args[1]);
                const hash = args[2];
                setString(keys[0], JSON.stringify(blockInfo));
                const heightMap = hashes.get(keys[1]) ?? new Map<string, string>();
                heightMap.set(args[1], hash);
                hashes.set(keys[1], heightMap);
                const currentMaxHeight = Number(strings.get(keys[2]) ?? '-1');
                if (height > currentMaxHeight) {
                    setString(keys[2], args[1]);
                }
                recordChange(JSON.parse(args[3]) as Omit<IndexChangeRecord, 'seq'>);
                return 1;
            }

            throw new Error(`Unexpected Redis eval call: ${keyCount} keys, ${args.length} args`);
        },
        quit: async () => undefined,
    };

    return { db };
}

function createRedisIndexChangeFailureFixture(): DbRedis {
    const dbName = 'index-change-failure-redis';
    const db = new DbRedis(dbName);
    const lists = new Map<string, string[]>([
        [`${dbName}/dids/z1`, [JSON.stringify(eventA)]],
        [`${dbName}/dids/z2`, [JSON.stringify(eventB)]],
    ]);

    (db as any).redis = {
        eval: async () => {
            throw new Error('index change insert failed');
        },
        get: async () => null,
        hget: async () => null,
        lrange: async (key: string) => lists.get(key) ?? [],
    };

    return db;
}

type MongoTransactionCallback = () => Promise<unknown>;

function createMongoTransactionClient(
    runTransaction: (callback: MongoTransactionCallback) => Promise<unknown> = callback => callback()
) {
    return {
        startSession: () => ({
            withTransaction: (callback: MongoTransactionCallback) => runTransaction(callback),
            endSession: async () => undefined,
        }),
    };
}

function createMongoFixture(): AdapterFixture {
    const db = new DbMongo('index-export-mongo');
    const eventsByKey = new Map<string, GatekeeperEvent[]>([
        ['z1', [eventA]],
        ['z2', [eventB]],
    ]);
    const changes = createIndexChanges();
    let nextChangeSeq = changes.length;

    (db as any).client = createMongoTransactionClient();
    (db as any).db = {
        collection: (name: string) => {
            if (name === 'dids') {
                return {
                    find: (query: { id?: { $gt?: string } } = {}) => {
                        let limit = Infinity;
                        const cursor = query.id?.$gt ?? null;
                        const chain = {
                            sort: () => chain,
                            limit: (nextLimit: number) => {
                                limit = nextLimit;
                                return chain;
                            },
                            toArray: async () => Array.from(eventsByKey.keys())
                                .sort()
                                .filter(id => !cursor || id > cursor)
                                .slice(0, limit)
                                .map(id => ({ id, events: eventsByKey.get(id) })),
                        };

                        return chain;
                    },
                    findOne: async ({ id }: { id: string }) => ({
                        id,
                        events: eventsByKey.get(id) ?? [],
                    }),
                    updateOne: async (
                        { id }: { id: string },
                        update: {
                            $push?: { events: { $each: GatekeeperEvent[] } };
                            $set?: { events: GatekeeperEvent[] };
                        }
                    ) => {
                        const existed = eventsByKey.has(id);
                        if (update.$push) {
                            eventsByKey.set(id, [
                                ...(eventsByKey.get(id) ?? []),
                                ...update.$push.events.$each,
                            ]);
                        }
                        if (update.$set) {
                            eventsByKey.set(id, update.$set.events);
                        }

                        return {
                            modifiedCount: existed ? 1 : 0,
                            upsertedCount: existed ? 0 : 1,
                        };
                    },
                    deleteOne: async ({ id }: { id: string }) => {
                        const deletedCount = eventsByKey.delete(id) ? 1 : 0;
                        return { deletedCount };
                    },
                };
            }

            if (name === 'blocks') {
                return {
                    updateOne: async () => ({ modifiedCount: 1, upsertedCount: 0 }),
                };
            }

            if (name === 'counters') {
                return {
                    findOneAndUpdate: async () => {
                        nextChangeSeq += 1;
                        return { value: nextChangeSeq };
                    },
                };
            }

            if (name === 'index_changes') {
                return {
                    find: (query?: { seq: { $gt: number } }) => ({
                        sort: () => ({
                            limit: (limit: number) => ({
                                next: async () => changes
                                    .slice()
                                    .sort((a, b) => b.seq - a.seq)[0] ?? null,
                                toArray: async () => changes
                                    .filter(change => change.seq > (query?.seq.$gt ?? 0))
                                    .slice(0, limit),
                            }),
                        }),
                    }),
                    insertOne: async (change: IndexChangeRecord) => {
                        changes.push(change);
                        return { insertedId: change.seq };
                    },
                };
            }

            throw new Error(`Unexpected mongo collection: ${name}`);
        },
    };

    return { db };
}

function createMongoIndexChangeFailureFixture(): DbMongo {
    const db = new DbMongo('index-change-failure-mongo');
    let committedEvents = new Map<string, GatekeeperEvent[]>([
        ['z1', [eventA]],
        ['z2', [eventB]],
    ]);
    let committedBlocks = new Map<string, BlockInfo>();
    let transactionEvents: Map<string, GatekeeperEvent[]> | null = null;
    let transactionBlocks: Map<string, BlockInfo> | null = null;

    (db as any).client = createMongoTransactionClient(async callback => {
        transactionEvents = cloneJSONMap(committedEvents);
        transactionBlocks = cloneJSONMap(committedBlocks);

        try {
            const result = await callback();
            committedEvents = requireActiveMap(transactionEvents, 'Mongo events');
            committedBlocks = requireActiveMap(transactionBlocks, 'Mongo blocks');
            return result;
        }
        finally {
            transactionEvents = null;
            transactionBlocks = null;
        }
    });

    (db as any).db = {
        collection: (name: string) => {
            if (name === 'dids') {
                return {
                    findOne: async ({ id }: { id: string }) => ({
                        id,
                        events: committedEvents.get(id) ?? [],
                    }),
                    updateOne: async (
                        { id }: { id: string },
                        update: {
                            $push?: { events: { $each: GatekeeperEvent[] } };
                            $set?: { events: GatekeeperEvent[] };
                        }
                    ) => {
                        const events = requireActiveMap(transactionEvents, 'Mongo events');
                        const existed = events.has(id);

                        if (update.$push) {
                            events.set(id, [
                                ...(events.get(id) ?? []),
                                ...update.$push.events.$each,
                            ]);
                        }
                        if (update.$set) {
                            events.set(id, update.$set.events);
                        }

                        return {
                            modifiedCount: existed ? 1 : 0,
                            upsertedCount: existed ? 0 : 1,
                        };
                    },
                    deleteOne: async ({ id }: { id: string }) => {
                        const events = requireActiveMap(transactionEvents, 'Mongo events');
                        const deletedCount = events.delete(id) ? 1 : 0;
                        return { deletedCount };
                    },
                };
            }

            if (name === 'blocks') {
                return {
                    updateOne: async (
                        { registry, hash }: { registry: string; hash: string },
                        { $set }: { $set: BlockInfo }
                    ) => {
                        const blocks = requireActiveMap(transactionBlocks, 'Mongo blocks');
                        const existed = blocks.has(fixtureBlockKey(registry, hash));
                        blocks.set(fixtureBlockKey(registry, hash), { ...$set });

                        return {
                            modifiedCount: existed ? 1 : 0,
                            upsertedCount: existed ? 0 : 1,
                        };
                    },
                    find: ({ registry }: { registry: string }) => ({
                        sort: () => ({
                            limit: () => ({
                                next: async () => Array.from(committedBlocks.entries())
                                    .filter(([key]) => key.startsWith(`${registry}\u0000`))
                                    .map(([, storedBlock]) => storedBlock)
                                    .sort((a, b) => b.height - a.height)[0] ?? null,
                            }),
                        }),
                    }),
                    findOne: async ({ registry, hash, height }: { registry: string; hash?: string; height?: number }) => {
                        const blocks = Array.from(committedBlocks.entries())
                            .filter(([key]) => key.startsWith(`${registry}\u0000`))
                            .map(([, storedBlock]) => storedBlock);

                        return blocks.find(storedBlock => (
                            hash !== undefined
                                ? storedBlock.hash === hash
                                : storedBlock.height === height
                        )) ?? null;
                    },
                };
            }

            if (name === 'counters') {
                return {
                    findOneAndUpdate: async () => ({ value: 1 }),
                };
            }

            if (name === 'index_changes') {
                return {
                    insertOne: async () => {
                        throw new Error('index change insert failed');
                    },
                };
            }

            throw new Error(`Unexpected mongo collection: ${name}`);
        },
    };

    return db;
}

function createPostgresIndexChangeFailureFixture(): DbPostgres {
    const db = new DbPostgres('index-change-failure-postgres');
    let committedEvents = new Map<string, GatekeeperEvent[]>([
        ['z1', [eventA]],
        ['z2', [eventB]],
    ]);
    let committedBlocks = new Map<string, BlockInfo>();
    let transactionEvents: Map<string, GatekeeperEvent[]> | null = null;
    let transactionBlocks: Map<string, BlockInfo> | null = null;

    async function runQuery(sql: string, params: unknown[] = [], transactional = false) {
        const text = String(sql);

        if (text === 'BEGIN') {
            transactionEvents = cloneJSONMap(committedEvents);
            transactionBlocks = cloneJSONMap(committedBlocks);
            return { rows: [], rowCount: 0 };
        }

        if (text === 'COMMIT') {
            committedEvents = transactionEvents ?? committedEvents;
            committedBlocks = transactionBlocks ?? committedBlocks;
            transactionEvents = null;
            transactionBlocks = null;
            return { rows: [], rowCount: 0 };
        }

        if (text === 'ROLLBACK') {
            transactionEvents = null;
            transactionBlocks = null;
            return { rows: [], rowCount: 0 };
        }

        if (text.includes('SELECT COALESCE(MAX(seq)')) {
            const id = String(params[1]);
            const events = transactional
                ? requireActiveMap(transactionEvents, 'Postgres events')
                : committedEvents;
            return { rows: [{ seq: events.get(id)?.length ?? 0 }], rowCount: 1 };
        }

        if (text.includes('DELETE FROM gatekeeper_events')) {
            const id = String(params[1]);
            const events = requireActiveMap(transactionEvents, 'Postgres events');
            const rowCount = events.get(id)?.length ?? 0;
            events.delete(id);
            return { rows: [], rowCount };
        }

        if (text.includes('INSERT INTO gatekeeper_events')) {
            const events = requireActiveMap(transactionEvents, 'Postgres events');

            for (let i = 0; i < params.length; i += 4) {
                const id = String(params[i + 1]);
                const seq = Number(params[i + 2]);
                const history = events.get(id) ?? [];
                history[seq] = parseStoredEvent(params[i + 3]);
                events.set(id, history);
            }

            return { rows: [], rowCount: params.length / 4 };
        }

        if (text.includes('INSERT INTO gatekeeper_blocks')) {
            const blocks = requireActiveMap(transactionBlocks, 'Postgres blocks');
            const registry = String(params[1]);
            const hash = String(params[2]);

            blocks.set(fixtureBlockKey(registry, hash), {
                hash,
                height: Number(params[3]),
                time: Number(params[4]),
            });
            return { rows: [], rowCount: 1 };
        }

        if (text.includes('INSERT INTO gatekeeper_index_changes')) {
            throw new Error('index change insert failed');
        }

        if (text.includes('FROM gatekeeper_events')) {
            const id = String(params[1]);
            const rows = (committedEvents.get(id) ?? []).map(event => ({ event }));
            return { rows, rowCount: rows.length };
        }

        if (text.includes('FROM gatekeeper_blocks')) {
            const registry = String(params[1]);
            const registryBlocks = Array.from(committedBlocks.entries())
                .filter(([key]) => key.startsWith(`${registry}\u0000`))
                .map(([, storedBlock]) => storedBlock);
            let found: BlockInfo | undefined;

            if (text.includes('ORDER BY height DESC')) {
                found = registryBlocks
                    .sort((a, b) => b.height - a.height)[0];
            }
            else if (text.includes('height = $3')) {
                found = registryBlocks.find(storedBlock => storedBlock.height === Number(params[2]));
            }
            else if (text.includes('hash = $3')) {
                found = registryBlocks.find(storedBlock => storedBlock.hash === params[2]);
            }

            const rows = found ? [found] : [];
            return { rows, rowCount: rows.length };
        }

        throw new Error(`Unexpected postgres query: ${text}`);
    }

    (db as any).pool = {
        query: (sql: string, params: unknown[] = []) => runQuery(sql, params, false),
        connect: async () => ({
            query: (sql: string, params: unknown[] = []) => runQuery(sql, params, true),
            release: () => undefined,
        }),
        end: async () => undefined,
    };

    return db;
}

async function createSqliteIndexChangeFailureFixture(): Promise<AdapterFixture & { db: DbSqlite }> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-index-change-failure-'));
    const db = new DbSqlite('sqlite', tempDir);
    await db.start();
    await db.resetDb();
    await db.addEvent(didA, eventA);
    await db.addEvent(didB, eventB);
    await (db as any).db.exec(`
        CREATE TRIGGER fail_index_changes
        BEFORE INSERT ON index_changes
        BEGIN
            SELECT RAISE(FAIL, 'index change insert failed');
        END;
    `);

    return {
        db,
        cleanup: async () => {
            await db.stop();
            fs.rmSync(tempDir, { recursive: true, force: true });
        },
    };
}

function createIndexChanges(): IndexChangeRecord[] {
    return [
        {
            seq: 1,
            kind: 'did',
            did: didA,
        },
        {
            seq: 2,
            kind: 'did',
            did: didB,
        },
        {
            seq: 3,
            kind: 'block',
            registry: 'local',
            block,
        },
    ];
}

async function seedAdapter(db: GatekeeperDb): Promise<void> {
    await db.addEvent(didA, eventA);
    await db.addEvent(didB, eventB);
    await db.addBlock('local', block);
}

const adapterFactories: Array<[string, () => Promise<AdapterFixture> | AdapterFixture]> = [
    ['json-memory', createMemoryFixture],
    ['sqlite', createSqliteFixture],
    ['postgres', createPostgresFixture],
    ['redis', createRedisFixture],
    ['mongo', createMongoFixture],
];
const productionAdapterFactories = adapterFactories.filter(([name]) => name !== 'json-memory');

describe('Gatekeeper index export request parsing', () => {
    it('normalizes index export limits and numeric cursors', () => {
        expect(normalizeIndexExportLimit()).toBe(500);
        expect(normalizeIndexExportLimit(0)).toBe(500);
        expect(normalizeIndexExportLimit(-1)).toBe(500);
        expect(normalizeIndexExportLimit(25)).toBe(25);
        expect(normalizeIndexExportLimit(5_001)).toBe(5_000);

        expect(parseIndexExportCursor()).toBe(0);
        expect(parseIndexExportCursor(null)).toBe(0);
        expect(parseIndexExportCursor('not-a-number')).toBe(0);
        expect(parseIndexExportCursor('-1')).toBe(0);
        expect(parseIndexExportCursor('42')).toBe(42);
    });

    it('builds snapshot pages from opaque page keys without loading extra keys', async () => {
        const getEvents = jest.fn(async (key: string) => {
            if (key === 'storage-z1') {
                return [{
                    ...eventA,
                    did: undefined,
                    operation: {
                        type: 'update',
                        did: didA,
                    },
                } as GatekeeperEvent];
            }

            return [];
        });

        const page = await buildIndexSnapshotResponseFromPageKeys(
            ['storage-z1', 'storage-z2'],
            getEvents,
            { cursor: 'previous-page', limit: 1 },
            '7'
        );

        expect(page).toMatchObject({
            mode: 'snapshot',
            cursor: 'storage-z1',
            checkpointCursor: '7',
            hasMore: true,
            blocks: [],
        });
        expect(page.dids.map(record => record.did)).toStrictEqual([didA]);
        expect(getEvents).toHaveBeenCalledWith('storage-z1');
        expect(getEvents).not.toHaveBeenCalledWith('storage-z2');

        const emptyPage = await buildIndexSnapshotResponseFromPageKeys(
            [],
            getEvents,
            { cursor: 'previous-page', limit: 1 },
            '7'
        );

        expect(emptyPage.cursor).toBe('previous-page');
        expect(emptyPage.dids).toStrictEqual([]);
    });

    it('keeps the local DB full-scan helper explicitly local and sorted by DID', async () => {
        const snapshot = await exportIndexSnapshotFromAllKeysForLocalDb(
            async () => ['storage-z2', 'storage-z1', 'storage-empty'],
            async (key: string) => {
                if (key === 'storage-z2') {
                    return [{
                        ...eventB,
                        did: undefined,
                        operation: {
                            type: 'update',
                            did: didB,
                        },
                    } as GatekeeperEvent];
                }
                if (key === 'storage-z1') {
                    return [{
                        ...eventA,
                        did: undefined,
                        operation: {
                            type: 'update',
                            did: didB,
                        },
                    } as GatekeeperEvent];
                }

                return [];
            },
            { limit: 10 },
            async () => '3'
        );

        expect(snapshot).toMatchObject({
            mode: 'snapshot',
            cursor: 'storage-empty',
            checkpointCursor: '3',
            hasMore: false,
            blocks: [],
        });
        expect(snapshot.dids.map(record => record.did)).toStrictEqual([didB, didB, 'storage-empty']);
    });

    it('parses snapshot continuation with an opaque cursor and checkpoint cursor', () => {
        expect(parseIndexExportRequest({
            mode: 'snapshot',
            cursor: 'opaque-page-token',
            checkpointCursor: '42',
            limit: 25,
        })).toStrictEqual({
            mode: 'snapshot',
            cursor: 'opaque-page-token',
            checkpointCursor: '42',
            limit: 25,
        });
    });

    it('rejects snapshot continuation without checkpoint cursor', () => {
        expect(() => parseIndexExportRequest({
            mode: 'snapshot',
            cursor: 'opaque-page-token',
        })).toThrow('checkpointCursor is required when continuing a snapshot');
    });

    it('rejects checkpoint cursor on an initial snapshot request', () => {
        expect(() => parseIndexExportRequest({
            mode: 'snapshot',
            checkpointCursor: '42',
        })).toThrow('checkpointCursor is only valid when continuing a snapshot');
    });

});

describe('Gatekeeper DB index snapshot export', () => {
    let db: DbJsonMemory;

    beforeEach(async () => {
        db = new DbJsonMemory('index-export-test');
        await db.resetDb();
    });

    it('returns DID event histories in stable DID order', async () => {
        const didA = 'did:test:z1';
        const didB = 'did:test:z2';

        await db.addEvent(didB, createEvent(didB, '2026-01-01T00:00:02.000Z'));
        await db.addEvent(didA, createEvent(didA, '2026-01-01T00:00:01.000Z'));
        await db.addEvent(didB, createEvent(didB, '2026-01-01T00:00:03.000Z', 'update'));

        const snapshot = await db.exportIndexSnapshot();

        expect(snapshot).toMatchObject({
            mode: 'snapshot',
            cursor: didB,
            hasMore: false,
            blocks: [],
        });
        expect(snapshot.dids.map(record => record.did)).toStrictEqual([didA, didB]);
        expect(snapshot.dids[0].events).toHaveLength(1);
        expect(snapshot.dids[1].events).toHaveLength(2);
    });

    it('pages snapshots with an opaque cursor and limit', async () => {
        const didA = 'did:test:z1';
        const didB = 'did:test:z2';
        const didC = 'did:test:z3';

        await db.addEvent(didA, createEvent(didA, '2026-01-01T00:00:01.000Z'));
        await db.addEvent(didB, createEvent(didB, '2026-01-01T00:00:02.000Z'));
        await db.addEvent(didC, createEvent(didC, '2026-01-01T00:00:03.000Z'));

        const firstPage = await db.exportIndexSnapshot({ limit: 2 });

        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.cursor).toBe(didB);
        expect(firstPage.dids.map(record => record.did)).toStrictEqual([didA, didB]);

        const secondPage = await db.exportIndexSnapshot({
            cursor: firstPage.cursor,
            limit: 2,
        });

        expect(secondPage.hasMore).toBe(false);
        expect(secondPage.cursor).toBe(didC);
        expect(secondPage.dids.map(record => record.did)).toStrictEqual([didC]);
    });

    it('passes snapshot cursor through as the only page token', async () => {
        const didA = 'did:test:z1';
        const didB = 'did:test:z2';

        await db.addEvent(didA, createEvent(didA, '2026-01-01T00:00:01.000Z'));
        await db.addEvent(didB, createEvent(didB, '2026-01-01T00:00:02.000Z'));

        const page = await db.exportIndexSnapshot({ cursor: didA });

        expect(page.cursor).toBe(didB);
        expect(page.dids.map(record => record.did)).toStrictEqual([didB]);
    });

    it('returns a stable snapshot checkpoint cursor', async () => {
        const didA = 'did:test:z1';
        const didB = 'did:test:z2';

        await db.addEvent(didA, createEvent(didA, '2026-01-01T00:00:01.000Z'));

        const firstPage = await db.exportIndexSnapshot({ limit: 1 });
        expect(firstPage.checkpointCursor).toBe('1');

        await db.addEvent(didB, createEvent(didB, '2026-01-01T00:00:02.000Z'));

        const nextPage = await db.exportIndexSnapshot({
            cursor: firstPage.cursor,
            checkpointCursor: firstPage.checkpointCursor,
            limit: 1,
        });

        expect(nextPage.checkpointCursor).toBe('1');
    });

    it('returns changed DID histories and blocks from incremental export', async () => {
        const did = 'did:test:z1';
        const block = {
            height: 1,
            hash: 'block-1',
            time: 1770000000,
        };

        await db.addEvent(did, createEvent(did, '2026-01-01T00:00:01.000Z'));
        await db.addEvent(did, createEvent(did, '2026-01-01T00:00:02.000Z', 'update'));
        await db.addBlock('TFTC', block);

        const changes = await db.exportIndexChanges();

        expect(changes).toMatchObject({
            mode: 'changes',
            cursor: '3',
            hasMore: false,
        });
        expect(changes.dids).toHaveLength(1);
        expect(changes.dids[0].did).toBe(did);
        expect(changes.dids[0]).not.toHaveProperty('removed');
        expect(changes.dids[0].events).toHaveLength(2);
        expect(changes.blocks).toStrictEqual([
            {
                registry: 'TFTC',
                block,
                removed: undefined,
            },
        ]);
    });

    it('pages incremental changes by cursor and limit', async () => {
        const didA = 'did:test:z1';
        const didB = 'did:test:z2';

        await db.addEvent(didA, createEvent(didA, '2026-01-01T00:00:01.000Z'));
        await db.addEvent(didB, createEvent(didB, '2026-01-01T00:00:02.000Z'));

        const firstPage = await db.exportIndexChanges({ limit: 1 });

        expect(firstPage.cursor).toBe('1');
        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.dids.map(record => record.did)).toStrictEqual([didA]);

        const secondPage = await db.exportIndexChanges({
            cursor: firstPage.cursor,
            limit: 1,
        });

        expect(secondPage.cursor).toBe('2');
        expect(secondPage.hasMore).toBe(false);
        expect(secondPage.dids.map(record => record.did)).toStrictEqual([didB]);
    });

    it('marks deleted DID histories as removed in incremental export', async () => {
        const did = 'did:test:z1';

        await db.addEvent(did, createEvent(did, '2026-01-01T00:00:01.000Z'));
        const checkpoint = await db.exportIndexChanges();

        await db.deleteEvents(did);

        const changes = await db.exportIndexChanges({ cursor: checkpoint.cursor });

        expect(changes.dids).toStrictEqual([
            {
                did,
                events: [],
                removed: true,
            },
        ]);
    });
});

describe('Gatekeeper Postgres index change transaction rollback', () => {
    it('rolls back addEvent when index change recording fails', async () => {
        const db = createPostgresIndexChangeFailureFixture();
        const didC = 'did:test:z3';
        const eventC = createEvent(didC, '2026-01-01T00:00:03.000Z');

        await expect(db.addEvent(didC, eventC)).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didC)).toStrictEqual([]);
    });

    it('rolls back setEvents when index change recording fails', async () => {
        const db = createPostgresIndexChangeFailureFixture();
        const eventAUpdate = createEvent(didA, '2026-01-01T00:00:04.000Z', 'update');

        await expect(db.setEvents(didA, [eventA, eventAUpdate])).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back deleteEvents when index change recording fails', async () => {
        const db = createPostgresIndexChangeFailureFixture();

        await expect(db.deleteEvents(didA)).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back addBlock when index change recording fails', async () => {
        const db = createPostgresIndexChangeFailureFixture();
        const block2: BlockInfo = {
            height: 8,
            hash: 'block-8',
            time: 1775037900,
        };

        await expect(db.addBlock('local', block2)).resolves.toBe(false);

        expect(await db.getBlock('local', block2.hash)).toBeNull();
    });
});

describe('Gatekeeper SQLite index change transaction rollback', () => {
    let fixture: AdapterFixture & { db: DbSqlite };

    beforeEach(async () => {
        fixture = await createSqliteIndexChangeFailureFixture();
    });

    afterEach(async () => {
        await fixture.cleanup?.();
    });

    it('rolls back addEvent when index change recording fails', async () => {
        const didC = 'did:test:z3';
        const eventC = createEvent(didC, '2026-01-01T00:00:03.000Z');

        await expect(fixture.db.addEvent(didC, eventC)).rejects.toThrow('index change insert failed');

        expect(await fixture.db.getEvents(didC)).toStrictEqual([]);
    });

    it('rolls back setEvents when index change recording fails', async () => {
        const eventAUpdate = createEvent(didA, '2026-01-01T00:00:04.000Z', 'update');

        await expect(fixture.db.setEvents(didA, [eventA, eventAUpdate])).rejects.toThrow('index change insert failed');

        expect(await fixture.db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back deleteEvents when index change recording fails', async () => {
        await expect(fixture.db.deleteEvents(didA)).rejects.toThrow('index change insert failed');

        expect(await fixture.db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back addBlock when index change recording fails', async () => {
        const block2: BlockInfo = {
            height: 8,
            hash: 'block-8',
            time: 1775037900,
        };

        await expect(fixture.db.addBlock('local', block2)).resolves.toBe(false);

        expect(await fixture.db.getBlock('local', block2.hash)).toBeNull();
    });
});

describe('Gatekeeper Redis index change atomic rollback', () => {
    it('rolls back addEvent when index change recording fails', async () => {
        const db = createRedisIndexChangeFailureFixture();
        const didC = 'did:test:z3';
        const eventC = createEvent(didC, '2026-01-01T00:00:03.000Z');

        await expect(db.addEvent(didC, eventC)).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didC)).toStrictEqual([]);
    });

    it('rolls back setEvents when index change recording fails', async () => {
        const db = createRedisIndexChangeFailureFixture();
        const eventAUpdate = createEvent(didA, '2026-01-01T00:00:04.000Z', 'update');

        await expect(db.setEvents(didA, [eventA, eventAUpdate])).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back deleteEvents when index change recording fails', async () => {
        const db = createRedisIndexChangeFailureFixture();

        await expect(db.deleteEvents(didA)).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back addBlock when index change recording fails', async () => {
        const db = createRedisIndexChangeFailureFixture();
        const block2: BlockInfo = {
            height: 8,
            hash: 'block-8',
            time: 1775037900,
        };

        await expect(db.addBlock('local', block2)).resolves.toBe(false);

        expect(await db.getBlock('local', block2.hash)).toBeNull();
    });
});

describe('Gatekeeper Mongo index change transaction rollback', () => {
    it('rolls back addEvent when index change recording fails', async () => {
        const db = createMongoIndexChangeFailureFixture();
        const didC = 'did:test:z3';
        const eventC = createEvent(didC, '2026-01-01T00:00:03.000Z');

        await expect(db.addEvent(didC, eventC)).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didC)).toStrictEqual([]);
    });

    it('rolls back setEvents when index change recording fails', async () => {
        const db = createMongoIndexChangeFailureFixture();
        const eventAUpdate = createEvent(didA, '2026-01-01T00:00:04.000Z', 'update');

        await expect(db.setEvents(didA, [eventA, eventAUpdate])).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back deleteEvents when index change recording fails', async () => {
        const db = createMongoIndexChangeFailureFixture();

        await expect(db.deleteEvents(didA)).rejects.toThrow('index change insert failed');

        expect(await db.getEvents(didA)).toStrictEqual([eventA]);
    });

    it('rolls back addBlock when index change recording fails', async () => {
        const db = createMongoIndexChangeFailureFixture();
        const block2: BlockInfo = {
            height: 8,
            hash: 'block-8',
            time: 1775037900,
        };

        await expect(db.addBlock('local', block2)).resolves.toBe(false);

        expect(await db.getBlock('local', block2.hash)).toBeNull();
    });
});

describe.each(adapterFactories)('Gatekeeper DB index export adapter: %s', (_name, createFixture) => {
    let fixture: AdapterFixture;

    beforeEach(async () => {
        fixture = await createFixture();
    });

    afterEach(async () => {
        await fixture.cleanup?.();
    });

    it('exports snapshots in stable DID order with cursor paging', async () => {
        const firstPage = await fixture.db.exportIndexSnapshot({ limit: 1 });

        expect(firstPage).toMatchObject({
            mode: 'snapshot',
            hasMore: true,
        });
        expect(firstPage.cursor).toEqual(expect.any(String));
        expect(firstPage.dids).toHaveLength(1);
        expect(firstPage.dids.map(record => record.did)).toStrictEqual([didA]);
        expect(firstPage.dids[0].events).toStrictEqual([eventA]);

        const secondPage = await fixture.db.exportIndexSnapshot({
            cursor: firstPage.cursor,
            limit: 1,
        });

        expect(secondPage).toMatchObject({
            mode: 'snapshot',
            hasMore: false,
        });
        expect(secondPage.cursor).toEqual(expect.any(String));
        expect(secondPage.dids).toHaveLength(1);
        expect(secondPage.dids.map(record => record.did)).toStrictEqual([didB]);
        expect(secondPage.dids[0].events).toStrictEqual([eventB]);
    });

    it('keeps the snapshot checkpoint cursor stable across continuation pages', async () => {
        const firstPage = await fixture.db.exportIndexSnapshot({ limit: 1 });
        const didC = 'did:test:z3';
        const eventC = createEvent(didC, '2026-01-01T00:00:03.000Z');

        await fixture.db.addEvent(didC, eventC);

        const secondPage = await fixture.db.exportIndexSnapshot({
            cursor: firstPage.cursor,
            checkpointCursor: firstPage.checkpointCursor,
            limit: 1,
        });

        expect(secondPage.checkpointCursor).toBe(firstPage.checkpointCursor);
        expect(secondPage.dids.map(record => record.did)).toStrictEqual([didB]);
    });

    it('exports incremental changes after the saved cursor', async () => {
        const firstPage = await fixture.db.exportIndexChanges({
            cursor: '1',
            limit: 1,
        });

        expect(firstPage).toMatchObject({
            mode: 'changes',
            cursor: '2',
            hasMore: true,
        });
        expect(firstPage.dids.map(record => record.did)).toStrictEqual([didB]);
        expect(firstPage.dids[0].events).toStrictEqual([eventB]);

        const secondPage = await fixture.db.exportIndexChanges({
            cursor: firstPage.cursor,
            limit: 2,
        });

        expect(secondPage).toMatchObject({
            mode: 'changes',
            cursor: '3',
            hasMore: false,
        });
        expect(secondPage.dids).toStrictEqual([]);
        expect(secondPage.blocks).toHaveLength(1);
        expect(secondPage.blocks[0]).toMatchObject({
            registry: 'local',
            block,
        });
    });

    it('records index changes for every accepted mutation type', async () => {
        const checkpoint = await fixture.db.exportIndexChanges();
        const didC = 'did:test:z3';
        const eventC = createEvent(didC, '2026-01-01T00:00:03.000Z');
        const eventAUpdate = createEvent(didA, '2026-01-01T00:00:04.000Z', 'update');
        const block2: BlockInfo = {
            height: 8,
            hash: 'block-8',
            time: 1775037900,
        };

        await fixture.db.addEvent(didC, eventC);
        await fixture.db.setEvents(didA, [eventA, eventAUpdate]);
        await fixture.db.deleteEvents(didB);
        await fixture.db.addBlock('local', block2);

        const changes = await fixture.db.exportIndexChanges({
            cursor: checkpoint.cursor,
            limit: 10,
        });

        expect(changes).toMatchObject({
            mode: 'changes',
            cursor: '7',
            hasMore: false,
        });
        expect(changes.dids).toStrictEqual([
            {
                did: didC,
                events: [eventC],
            },
            {
                did: didA,
                events: [eventA, eventAUpdate],
            },
            {
                did: didB,
                events: [],
                removed: true,
            },
        ]);
        expect(changes.blocks).toHaveLength(1);
        expect(changes.blocks[0]).toMatchObject({
            registry: 'local',
            block: block2,
        });
    });
});

describe.each(productionAdapterFactories)('Gatekeeper production snapshot export adapter: %s', (_name, createFixture) => {
    let fixture: AdapterFixture;

    beforeEach(async () => {
        fixture = await createFixture();
    });

    afterEach(async () => {
        await fixture.cleanup?.();
    });

    it('loads DID events only for the current snapshot page', async () => {
        const loadedKeys: string[] = [];
        const originalGetEvents = fixture.db.getEvents.bind(fixture.db);
        fixture.db.getEvents = async (did: string) => {
            loadedKeys.push(did);
            return originalGetEvents(did);
        };

        const firstPage = await fixture.db.exportIndexSnapshot({ limit: 1 });

        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.dids.map(record => record.did)).toStrictEqual([didA]);
        expect(loadedKeys).toStrictEqual(['z1']);
    });
});

describe('Gatekeeper Redis DID snapshot index', () => {
    it('exports snapshots without Redis KEYS', async () => {
        const fixture = createRedisFixture();

        await expect(fixture.db.exportIndexSnapshot({ limit: 1 })).resolves.toMatchObject({
            mode: 'snapshot',
            hasMore: true,
        });
        await expect(fixture.db.getAllKeys()).resolves.toStrictEqual(['z1', 'z2']);
    });

    it('resets Redis by scanning only the configured namespace', async () => {
        const fixture = createRedisFixture();

        expect(await fixture.db.resetDb()).toBeGreaterThan(0);
        await expect(fixture.db.getEvents(didA)).resolves.toStrictEqual([]);
    });

    it('rebuilds the DID index on start when the index is missing', async () => {
        const dbName = 'redis-startup-index-rebuild';
        const didIndexKey = `${dbName}/index/dids`;
        const rebuildKey = `${didIndexKey}:rebuild`;
        const lists = new Map<string, string[]>([
            [`${dbName}/dids/z2`, [JSON.stringify(eventB)]],
            [`${dbName}/dids/z1`, [JSON.stringify(eventA)]],
        ]);
        const strings = new Map<string, string>();
        const zsets = new Map<string, Map<string, number>>([
            [rebuildKey, new Map([['stale', 0]])],
        ]);
        const scanMatches: string[] = [];
        const redis = {
            type: async (key: string) => zsets.has(key)
                ? 'zset'
                : (strings.has(key) ? 'string' : 'none'),
            lrange: async () => [],
            get: async (key: string) => strings.get(key) ?? null,
            set: async (key: string, value: string | number) => {
                strings.set(key, String(value));
                return 'OK';
            },
            del: async (...keys: string[]) => {
                let removed = 0;
                for (const key of keys) {
                    if (lists.delete(key)) {
                        removed += 1;
                    }
                    if (strings.delete(key)) {
                        removed += 1;
                    }
                    if (zsets.delete(key)) {
                        removed += 1;
                    }
                }
                return removed;
            },
            scan: async (_cursor: string, _match: string, pattern: string) => {
                scanMatches.push(pattern);
                return ['0', Array.from(lists.keys())];
            },
            zadd: async (key: string, score: number | string, member: string) => {
                const zset = zsets.get(key) ?? new Map<string, number>();
                const existed = zset.has(member);
                zset.set(member, Number(score));
                zsets.set(key, zset);
                return existed ? 0 : 1;
            },
            renamenx: async (source: string, target: string) => {
                if (zsets.has(target) || strings.has(target) || lists.has(target)) {
                    return 0;
                }

                const zset = zsets.get(source);
                if (!zset) {
                    throw new Error('missing rebuild key');
                }

                zsets.set(target, zset);
                zsets.delete(source);
                return 1;
            },
            quit: async () => undefined,
        };
        jest.resetModules();
        jest.unstable_mockModule('ioredis', () => ({
            Redis: jest.fn(() => redis),
        }));
        const { default: MockedDbRedis } = await import('@mdip/gatekeeper/db/redis.ts');
        const db = new MockedDbRedis(dbName);

        await db.start();
        await db.stop();

        expect(Array.from(zsets.get(didIndexKey)?.keys() ?? []).sort()).toStrictEqual(['z1', 'z2']);
        expect(zsets.has(rebuildKey)).toBe(false);
        expect(scanMatches).toStrictEqual([`${dbName}/dids/*`]);
        expect(didIndexKey.startsWith(`${dbName}/dids/`)).toBe(false);

        jest.dontMock('ioredis');
        jest.resetModules();
    });

    it('skips publishing a rebuilt Redis DID index when no DID keys exist', async () => {
        const dbName = 'redis-startup-index-empty';
        const didIndexKey = `${dbName}/index/dids`;
        const rebuildKey = `${didIndexKey}:rebuild`;
        const del = jest.fn(async () => 0);
        const renamenx = jest.fn();
        const redis = {
            type: async () => 'none',
            del,
            scan: async () => ['0', [
                `${dbName}/dids/`,
                `${dbName}/dids/nested/id`,
                `${dbName}/index/dids`,
            ]],
            zadd: jest.fn(),
            renamenx,
            quit: async () => undefined,
        };
        jest.resetModules();
        jest.unstable_mockModule('ioredis', () => ({
            Redis: jest.fn(() => redis),
        }));
        const { default: MockedDbRedis } = await import('@mdip/gatekeeper/db/redis.ts');
        const db = new MockedDbRedis(dbName);

        await db.start();
        await db.stop();

        expect(del).toHaveBeenCalledWith(rebuildKey);
        expect(renamenx).not.toHaveBeenCalled();

        jest.dontMock('ioredis');
        jest.resetModules();
    });

    it('leaves an existing Redis DID index untouched on startup', async () => {
        const dbName = 'redis-startup-index-existing';
        const didIndexKey = `${dbName}/index/dids`;
        const redis = {
            type: async (key: string) => key === didIndexKey ? 'zset' : 'none',
            del: jest.fn(),
            scan: jest.fn(),
            renamenx: jest.fn(),
            quit: async () => undefined,
        };
        jest.resetModules();
        jest.unstable_mockModule('ioredis', () => ({
            Redis: jest.fn(() => redis),
        }));
        const { default: MockedDbRedis } = await import('@mdip/gatekeeper/db/redis.ts');
        const db = new MockedDbRedis(dbName);

        await db.start();
        await db.stop();

        expect(redis.scan).not.toHaveBeenCalled();
        expect(redis.renamenx).not.toHaveBeenCalled();

        jest.dontMock('ioredis');
        jest.resetModules();
    });

    it('rejects Redis startup when the existing DID index key has the wrong type', async () => {
        const dbName = 'redis-startup-index-wrong-type';
        const redis = {
            type: async () => 'string',
            quit: async () => undefined,
        };
        jest.resetModules();
        jest.unstable_mockModule('ioredis', () => ({
            Redis: jest.fn(() => redis),
        }));
        const { default: MockedDbRedis } = await import('@mdip/gatekeeper/db/redis.ts');
        const db = new MockedDbRedis(dbName);

        await expect(db.start()).rejects.toThrow(
            `Unsupported Redis DID index key type for ${dbName}/index/dids: string`
        );

        jest.dontMock('ioredis');
        jest.resetModules();
    });

    it('fails Redis startup if another starter publishes an invalid DID index key', async () => {
        const dbName = 'redis-startup-index-invalid-race';
        const didIndexKey = `${dbName}/index/dids`;
        let indexPublished = false;
        const redis = {
            type: async (key: string) => {
                if (key === didIndexKey && indexPublished) {
                    return 'string';
                }

                return 'none';
            },
            del: async () => 0,
            scan: async () => ['0', [`${dbName}/dids/z1`]],
            zadd: async () => 1,
            renamenx: async () => {
                indexPublished = true;
                return 0;
            },
            quit: jest.fn(async () => undefined),
        };
        jest.resetModules();
        jest.unstable_mockModule('ioredis', () => ({
            Redis: jest.fn(() => redis),
        }));
        const { default: MockedDbRedis } = await import('@mdip/gatekeeper/db/redis.ts');
        const db = new MockedDbRedis(dbName);

        await expect(db.start()).rejects.toThrow(`Unsupported Redis DID index key type for ${didIndexKey}: string`);
        expect(redis.quit).toHaveBeenCalledTimes(1);

        jest.dontMock('ioredis');
        jest.resetModules();
    });

    it('discards rebuilt Redis DID index if another starter publishes first', async () => {
        const dbName = 'redis-startup-index-race';
        const didIndexKey = `${dbName}/index/dids`;
        const rebuildKey = `${didIndexKey}:rebuild`;
        const lists = new Map<string, string[]>([
            [`${dbName}/dids/z2`, [JSON.stringify(eventB)]],
            [`${dbName}/dids/z1`, [JSON.stringify(eventA)]],
        ]);
        const zsets = new Map<string, Map<string, number>>();
        const redis = {
            type: async (key: string) => zsets.has(key) ? 'zset' : 'none',
            del: async (...keys: string[]) => {
                let removed = 0;
                for (const key of keys) {
                    if (zsets.delete(key)) {
                        removed += 1;
                    }
                }
                return removed;
            },
            scan: async () => ['0', Array.from(lists.keys())],
            zadd: async (key: string, score: number | string, member: string) => {
                const zset = zsets.get(key) ?? new Map<string, number>();
                const existed = zset.has(member);
                zset.set(member, Number(score));
                zsets.set(key, zset);
                return existed ? 0 : 1;
            },
            renamenx: async () => {
                zsets.set(didIndexKey, new Map([['z1', 0], ['z2', 0]]));
                return 0;
            },
            quit: async () => undefined,
        };
        jest.resetModules();
        jest.unstable_mockModule('ioredis', () => ({
            Redis: jest.fn(() => redis),
        }));
        const { default: MockedDbRedis } = await import('@mdip/gatekeeper/db/redis.ts');
        const db = new MockedDbRedis(dbName);

        await db.start();
        await db.stop();

        expect(Array.from(zsets.get(didIndexKey)?.keys() ?? []).sort()).toStrictEqual(['z1', 'z2']);
        expect(zsets.has(rebuildKey)).toBe(false);

        jest.dontMock('ioredis');
        jest.resetModules();
    });

    it('maintains the DID index on add, set, and delete', async () => {
        const fixture = createRedisFixture();
        const didC = 'did:test:z3';
        const eventC = createEvent(didC, '2026-01-01T00:00:03.000Z');
        const didD = 'did:test:z4';
        const eventD = createEvent(didD, '2026-01-01T00:00:04.000Z');

        await fixture.db.addEvent(didC, eventC);
        await fixture.db.setEvents(didD, [eventD]);
        await fixture.db.deleteEvents(didA);

        const snapshot = await fixture.db.exportIndexSnapshot({ limit: 10 });

        expect(snapshot.hasMore).toBe(false);
        expect(snapshot.dids.map(record => record.did)).toStrictEqual([didB, didC, didD]);
        expect(snapshot.dids.map(record => record.events)).toStrictEqual([[eventB], [eventC], [eventD]]);
    });
});

describe('Gatekeeper DB startup and guard behavior', () => {
    it('resets Postgres index change storage with the rest of the namespace', async () => {
        const fixture = createPostgresFixture();

        await expect(fixture.db.resetDb()).resolves.toBeUndefined();
        await fixture.cleanup?.();
    });

    it('cleans up Mongo startup when transaction support is unavailable', async () => {
        const close = jest.fn(async () => undefined);
        const client = {
            connect: jest.fn(async () => undefined),
            close,
            db: jest.fn(() => ({
                command: jest.fn(async () => ({})),
            })),
        };
        jest.resetModules();
        jest.unstable_mockModule('mongodb', () => ({
            MongoClient: jest.fn(() => client),
        }));
        const { default: MockedDbMongo } = await import('@mdip/gatekeeper/db/mongo.ts');
        const db = new MockedDbMongo('mongo-startup-failure');

        await expect(db.start()).rejects.toThrow('MongoDB transactions require a replica set');
        expect(close).toHaveBeenCalledTimes(1);

        jest.dontMock('mongodb');
        jest.resetModules();
    });

    it('starts, migrates legacy indexes, resets, and stops Mongo with transaction-capable topology', async () => {
        const deletedCollections: string[] = [];
        const droppedIndexes: { collection: string; index: string }[] = [];
        const createIndex = jest.fn(async () => undefined);
        const close = jest.fn(async () => undefined);
        const indexesByCollection: Record<string, unknown[]> = {
            dids: [{ name: 'id_1', key: { id: 1 } }],
        };
        const appDb = {
            collection: (name: string) => ({
                indexes: async () => indexesByCollection[name] ?? [],
                createIndex,
                dropIndex: async (index: string) => {
                    droppedIndexes.push({ collection: name, index });
                },
                deleteMany: async () => {
                    deletedCollections.push(name);
                    return { deletedCount: 1 };
                },
            }),
        };
        const adminDb = {
            command: jest.fn(async () => ({ setName: 'rs0' })),
        };
        const client = {
            connect: jest.fn(async () => undefined),
            close,
            db: jest.fn((name: string) => name === 'admin' ? adminDb : appDb),
        };
        jest.resetModules();
        jest.unstable_mockModule('mongodb', () => ({
            MongoClient: jest.fn(() => client),
        }));
        const { default: MockedDbMongo } = await import('@mdip/gatekeeper/db/mongo.ts');
        const db = new MockedDbMongo('mongo-startup-success');

        await db.start();
        await db.resetDb();
        await db.stop();

        expect(createIndex).toHaveBeenCalledTimes(5);
        expect(createIndex).toHaveBeenCalledWith(
            { id: 1 },
            { name: 'dids_id_unique', unique: true }
        );
        expect(droppedIndexes).toStrictEqual([{ collection: 'dids', index: 'id_1' }]);
        expect(deletedCollections).toStrictEqual([
            'dids',
            'queue',
            'blocks',
            'index_changes',
            'counters',
        ]);
        expect(close).toHaveBeenCalledTimes(1);

        jest.dontMock('mongodb');
        jest.resetModules();
    });

    it('rejects index exports before DB adapters are started', async () => {
        const mongo = new DbMongo('mongo-unstarted');
        const redis = new DbRedis('redis-unstarted');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-unstarted-'));
        const sqlite = new DbSqlite('sqlite', tempDir);

        try {
            await expect(mongo.exportIndexSnapshot()).rejects.toThrow('Mongo not started');
            await expect(mongo.exportIndexChanges()).rejects.toThrow('Mongo not started');
            await expect((mongo as any).verifyTransactionSupport()).rejects.toThrow('Mongo not started');
            await expect((mongo as any).withTransaction(async () => undefined)).rejects.toThrow('Mongo not started');
            await expect((mongo as any).nextIndexSeq({})).rejects.toThrow('Mongo not started');
            await expect((mongo as any).recordIndexChange({ kind: 'did', did: didA }, {}))
                .rejects.toThrow('Mongo not started');
            await expect((mongo as any).getIndexCheckpointCursor()).rejects.toThrow('Mongo not started');

            expect(() => (redis as any).assertStarted()).toThrow('Redis not started');
            await expect(redis.getAllKeys()).rejects.toThrow('Redis not started');
            await expect(redis.exportIndexSnapshot()).rejects.toThrow('Redis not started');
            await expect(redis.exportIndexChanges()).rejects.toThrow('Redis not started');
            await expect((redis as any).getIndexCheckpointCursor()).rejects.toThrow('Redis not started');

            await expect((sqlite as any).recordIndexChangeStrict({ kind: 'did', did: didA }))
                .rejects.toThrow('SQLite DB not open');
            await expect((sqlite as any).getIndexCheckpointCursor()).rejects.toThrow('SQLite DB not open');
            await expect(sqlite.exportIndexSnapshot()).rejects.toThrow('SQLite DB not open');
            await expect(sqlite.exportIndexChanges()).rejects.toThrow('SQLite DB not open');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
