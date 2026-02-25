import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import { Operation } from '@mdip/gatekeeper/types';
import type { OperationSyncStore, SyncOperationRecord, SyncStoreListOptions } from '../../services/mediators/hyperswarm/src/db/types.ts';

const DAY_SECONDS = 24 * 60 * 60;
const h = (c: string) => c.repeat(64);
const idFromNum = (n: number) => n.toString(16).padStart(64, '0');
const toEpochSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const toISOFromEpochSeconds = (ts: number) => new Date(ts * 1000).toISOString();

function makeOp(hashChar: string, signed: string): Operation {
    return {
        type: 'create',
        signature: {
            signed,
            hash: h(hashChar),
            value: `sig-${hashChar}`,
        },
    };
}

function makeOpFromHash(hash: string, signed: string): Operation {
    return {
        type: 'create',
        signature: {
            signed,
            hash,
            value: `sig-${hash.slice(0, 8)}`,
        },
    };
}

async function seedStore(
    store: InMemoryOperationSyncStore,
    records: Array<{ id: string; ts: number; op: Operation }>
): Promise<void> {
    await store.start();
    await store.reset();
    await store.upsertMany(records.map(item => ({
        id: item.id,
        ts: item.ts,
        operation: item.op,
    })));
}

async function seedNumericRange(
    store: InMemoryOperationSyncStore,
    start: number,
    endExclusive: number,
    baseTs: number,
): Promise<void> {
    const records = [];
    for (let i = start; i < endExclusive; i++) {
        const id = idFromNum(i);
        records.push({
            id,
            ts: baseTs + i,
            op: makeOpFromHash(id, toISOFromEpochSeconds(baseTs + i)),
        });
    }
    await seedStore(store, records);
}

describe('NegentropyAdapter', () => {
    it('returns null session/window stats before any rebuilds', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, []);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        expect(adapter.getLastWindowStats()).toBeNull();
        expect(adapter.getLastSessionStats()).toBeNull();
    });

    it('loads and builds from store', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, [
            // eslint-disable-next-line sonarjs/no-duplicate-string
            { id: h('a'), ts: 1000, op: makeOp('a', '2026-02-09T10:00:00.000Z') },
            // eslint-disable-next-line sonarjs/no-duplicate-string
            { id: h('b'), ts: 2000, op: makeOp('b', '2026-02-09T11:00:00.000Z') },
        ]);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
        });

        const stats = adapter.getStats();
        expect(stats.loaded).toBe(2);
        expect(stats.skipped).toBe(0);
        expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('reconciles two stores and reports have/need ids', async () => {
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();

        await seedStore(storeA, [
            { id: h('a'), ts: 1000, op: makeOp('a', '2026-02-09T10:00:00.000Z') },
            { id: h('b'), ts: 2000, op: makeOp('b', '2026-02-09T11:00:00.000Z') },
            // eslint-disable-next-line sonarjs/no-duplicate-string
            { id: h('c'), ts: 3000, op: makeOp('c', '2026-02-09T12:00:00.000Z') },
        ]);

        await seedStore(storeB, [
            { id: h('b'), ts: 2000, op: makeOp('b', '2026-02-09T11:00:00.000Z') },
            { id: h('c'), ts: 3000, op: makeOp('c', '2026-02-09T12:00:00.000Z') },
            { id: h('d'), ts: 4000, op: makeOp('d', '2026-02-09T13:00:00.000Z') },
        ]);

        const adapterA = await NegentropyAdapter.create({
            syncStore: storeA,
            frameSizeLimit: 0,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
            frameSizeLimit: 0,
        });

        let msg: string | Uint8Array | null = await adapterA.initiate();
        const have = new Set<string>();
        const need = new Set<string>();

        for (let i = 0; i < 20 && msg !== null; i++) {
            const response = await adapterB.respond(msg);
            if (response === null) {
                break;
            }
            const round = await adapterA.reconcile(response);

            for (const id of round.haveIds) {
                have.add(String(id));
            }
            for (const id of round.needIds) {
                need.add(String(id));
            }

            msg = round.nextMsg;
        }

        expect(have.has(h('a'))).toBe(true);
        expect(need.has(h('d'))).toBe(true);
    });

    it('throws when frameSizeLimit is invalid', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, []);

        await expect(() => NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 1024,
        })).rejects.toThrow('frameSizeLimit');
    });

    it('throws when integer options are invalid', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, []);

        await expect(() => NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            recentWindowDays: 0,
        })).rejects.toThrow('recentWindowDays');

        await expect(() => NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            olderWindowDays: 0,
        })).rejects.toThrow('olderWindowDays');

        await expect(() => NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            maxRecordsPerWindow: 0,
        })).rejects.toThrow('maxRecordsPerWindow');

        await expect(() => NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            maxRoundsPerSession: 0,
        })).rejects.toThrow('maxRoundsPerSession');
    });

    it('throws if initiate/reconcile called before adapter has been built', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, []);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        await expect(adapter.initiate()).rejects.toThrow('not initialized');
        await expect(adapter.reconcile('msg')).rejects.toThrow('not initialized');
    });

    it('returns empty windows for empty store and rejects non-finite nowTs', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, []);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        await expect(adapter.planWindows(Number.NaN)).rejects.toThrow('nowTs must be a finite timestamp');
        await expect(adapter.planWindows(Math.floor(Date.now() / 1000))).resolves.toStrictEqual([]);
    });

    it('skips invalid sync rows when rebuilding a window', async () => {
        const validId = h('a');
        const validTs = toEpochSeconds('2026-02-13T00:00:00.000Z');
        const validOp = makeOp('a', '2026-02-13T00:00:00.000Z');
        const rows: SyncOperationRecord[] = [
            { id: 'invalid-id', ts: validTs, operation: validOp, insertedAt: 1 },
            { id: validId, ts: Number.NaN, operation: validOp, insertedAt: 2 },
            { id: validId, ts: validTs, operation: validOp, insertedAt: 3 },
        ];

        const stubStore: OperationSyncStore = {
            start: async () => undefined,
            stop: async () => undefined,
            reset: async () => undefined,
            upsertMany: async () => 0,
            getByIds: async () => [],
            has: async () => false,
            count: async () => rows.length,
            iterateSorted: async (options: SyncStoreListOptions = {}) => {
                if (options.after) {
                    return [];
                }
                return rows;
            },
        };

        const adapter = await NegentropyAdapter.create({
            syncStore: stubStore,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        const stats = await adapter.rebuildForWindow({
            name: 'recent',
            fromTs: Number.MIN_SAFE_INTEGER,
            toTs: Number.MAX_SAFE_INTEGER,
            maxRecords: 100,
            order: 0,
        });

        expect(stats.loaded).toBe(1);
        expect(stats.skipped).toBe(2);
    });

    it('plans recent window first then older windows in descending recency', async () => {
        const store = new InMemoryOperationSyncStore();
        // eslint-disable-next-line sonarjs/no-duplicate-string
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');
        await seedStore(store, [
            { id: h('a'), ts: nowTs - (10 * DAY_SECONDS), op: makeOp('a', '2026-01-31T00:00:00.000Z') },
            { id: h('b'), ts: nowTs - (2 * DAY_SECONDS), op: makeOp('b', '2026-02-08T00:00:00.000Z') },
        ]);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            recentWindowDays: 3,
            olderWindowDays: 2,
            deferInitialBuild: true,
        });

        const windows = await adapter.planWindows(nowTs);
        expect(windows.length).toBeGreaterThanOrEqual(2);
        expect(windows[0].name).toBe('recent');
        expect(windows[0].toTs).toBe(nowTs);
        expect(windows[1].fromTs).toBeLessThanOrEqual(windows[1].toTs);
        expect(windows[1].toTs).toBe(windows[0].fromTs - 1);
    });

    it('caps records per window and emits window stats', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, [
            { id: h('a'), ts: 1000, op: makeOp('a', '2026-02-09T10:00:00.000Z') },
            { id: h('b'), ts: 2000, op: makeOp('b', '2026-02-09T11:00:00.000Z') },
            { id: h('c'), ts: 3000, op: makeOp('c', '2026-02-09T12:00:00.000Z') },
        ]);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        const stats = await adapter.rebuildForWindow({
            name: 'recent',
            fromTs: 0,
            toTs: 5000,
            maxRecords: 2,
            order: 0,
        });

        expect(stats.loaded).toBe(2);
        expect(stats.skipped).toBe(0);
        expect(stats.cappedByRecords).toBe(true);
        expect(stats.windowName).toBe('recent');
    });

    it('applies maxRoundsPerSession cap in windowed sessions', async () => {
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();
        const baseTs = toEpochSeconds('2026-02-01T00:00:00.000Z');
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');

        await seedNumericRange(storeA, 0, 2000, baseTs);
        await seedNumericRange(storeB, 1000, 3000, baseTs);

        const adapterA = await NegentropyAdapter.create({
            syncStore: storeA,
            frameSizeLimit: 4096,
            recentWindowDays: 14,
            olderWindowDays: 14,
            maxRecordsPerWindow: 10000,
            deferInitialBuild: true,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
            frameSizeLimit: 4096,
            recentWindowDays: 14,
            olderWindowDays: 14,
            maxRecordsPerWindow: 10000,
            deferInitialBuild: true,
        });

        const session = await adapterA.runWindowedSessionWithPeer(adapterB, {
            nowTs,
            maxRoundsPerSession: 1,
        });

        expect(session.windowCount).toBeGreaterThan(0);
        expect(session.windows.some(window => window.cappedByRounds)).toBe(true);
        expect(session.windows[0].rounds).toBe(1);
    });

    it('throws for invalid runWindowedSessionWithPeer maxRoundsPerSession option', async () => {
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();
        await seedStore(storeA, []);
        await seedStore(storeB, []);

        const adapterA = await NegentropyAdapter.create({
            syncStore: storeA,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        await expect(adapterA.runWindowedSessionWithPeer(adapterB, {
            maxRoundsPerSession: 0,
        })).rejects.toThrow('maxRoundsPerSession');
    });

    it('continues into older windows when a newer window hits record cap', async () => {
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();

        const recentA = nowTs - (6 * 60 * 60);
        const recentB = nowTs - (8 * 60 * 60);
        const older = nowTs - (2 * DAY_SECONDS);

        await seedStore(storeA, [
            { id: h('a'), ts: recentA, op: makeOp('a', toISOFromEpochSeconds(recentA)) },
            { id: h('b'), ts: recentB, op: makeOp('b', toISOFromEpochSeconds(recentB)) },
            { id: h('c'), ts: older, op: makeOp('c', toISOFromEpochSeconds(older)) },
        ]);
        await seedStore(storeB, [
            { id: h('d'), ts: recentA, op: makeOp('d', toISOFromEpochSeconds(recentA)) },
            { id: h('e'), ts: older, op: makeOp('e', toISOFromEpochSeconds(older)) },
        ]);

        const adapterA = await NegentropyAdapter.create({
            syncStore: storeA,
            frameSizeLimit: 0,
            recentWindowDays: 1,
            olderWindowDays: 1,
            maxRecordsPerWindow: 1,
            deferInitialBuild: true,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
            frameSizeLimit: 0,
            recentWindowDays: 1,
            olderWindowDays: 1,
            maxRecordsPerWindow: 1,
            deferInitialBuild: true,
        });

        const session = await adapterA.runWindowedSessionWithPeer(adapterB, { nowTs });
        const recent = session.windows.find(window => window.windowName === 'recent');
        const olderWindow = session.windows.find(window => window.windowName === 'older_1');

        expect(session.windowCount).toBeGreaterThanOrEqual(2);
        expect(recent?.cappedByRecords).toBe(true);
        expect(olderWindow).toBeDefined();
    });
});
