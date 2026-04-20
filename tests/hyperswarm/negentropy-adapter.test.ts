import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import { MDIP_EPOCH_SECONDS } from '../../services/mediators/hyperswarm/src/negentropy/windows.ts';
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

    it('sets wantUint8ArrayOutput on the underlying negentropy instance', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, [
            { id: h('a'), ts: 1000, op: makeOp('a', '2026-02-09T10:00:00.000Z') },
        ]);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            wantUint8ArrayOutput: true,
        });

        expect((adapter as any).ne.wantUint8ArrayOutput).toBe(true);
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

    it('returns null earliest timestamp for an empty store', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, []);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        await expect(adapter.getEarliestTimestamp()).resolves.toBeNull();
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
            name: 'history_paged',
            fromTs: Number.MIN_SAFE_INTEGER,
            toTs: Number.MAX_SAFE_INTEGER,
            maxRecords: 100,
            order: 0,
        });

        expect(stats.loaded).toBe(1);
        expect(stats.skipped).toBe(2);
    });

    it('uses MDIP epoch when both peers have empty history', async () => {
        const store = new InMemoryOperationSyncStore();
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');
        const peerStore = new InMemoryOperationSyncStore();
        await seedStore(store, []);
        await seedStore(peerStore, []);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });
        const peerAdapter = await NegentropyAdapter.create({
            syncStore: peerStore,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        const session = await adapter.runWindowedSessionWithPeer(peerAdapter, { nowTs });
        expect(session.windowCount).toBe(1);
        expect(session.windows[0].windowName).toBe('history_paged');
        expect(session.windows[0].fromTs).toBe(MDIP_EPOCH_SECONDS);
        expect(session.windows[0].toTs).toBe(nowTs);
    });

    it('starts paged history at the earliest known timestamp across peers', async () => {
        const store = new InMemoryOperationSyncStore();
        const peerStore = new InMemoryOperationSyncStore();
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');
        const earliestTs = nowTs - (10 * DAY_SECONDS);
        await seedStore(store, [
            { id: h('a'), ts: earliestTs, op: makeOp('a', '2026-01-31T00:00:00.000Z') },
            { id: h('b'), ts: nowTs - (2 * DAY_SECONDS), op: makeOp('b', '2026-02-08T00:00:00.000Z') },
        ]);
        await seedStore(peerStore, [
            { id: h('c'), ts: nowTs - DAY_SECONDS, op: makeOp('c', '2026-02-09T00:00:00.000Z') },
        ]);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });
        const peerAdapter = await NegentropyAdapter.create({
            syncStore: peerStore,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        const session = await adapter.runWindowedSessionWithPeer(peerAdapter, { nowTs });
        expect(session.windowCount).toBeGreaterThan(0);
        expect(session.windows[0].windowName).toBe('history_paged');
        expect(session.windows[0].fromTs).toBe(earliestTs);
        expect(session.windows[0].toTs).toBe(nowTs);
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
            name: 'history_paged',
            fromTs: 0,
            toTs: 5000,
            maxRecords: 2,
            order: 0,
        });

        expect(stats.loaded).toBe(2);
        expect(stats.skipped).toBe(0);
        expect(stats.cappedByRecords).toBe(true);
        expect(stats.windowName).toBe('history_paged');
    });

    it('supports cursor-based pagination for capped windows', async () => {
        const store = new InMemoryOperationSyncStore();
        const baseTs = toEpochSeconds('2026-02-09T00:00:00.000Z');
        await seedNumericRange(store, 0, 5, baseTs);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            deferInitialBuild: true,
        });

        const first = await adapter.rebuildForWindow({
            name: 'history_paged',
            fromTs: baseTs,
            toTs: baseTs + 10,
            maxRecords: 2,
            order: 0,
        });

        expect(first.loaded).toBe(2);
        expect(first.cappedByRecords).toBe(true);
        expect(first.lastCursor).toStrictEqual({ ts: baseTs + 1, id: idFromNum(1) });

        const second = await adapter.rebuildForWindow({
            name: 'history_paged',
            fromTs: baseTs,
            toTs: baseTs + 10,
            maxRecords: 2,
            order: 1,
            after: first.lastCursor ?? undefined,
        });

        expect(second.loaded).toBe(2);
        expect(second.cappedByRecords).toBe(true);
        expect(second.lastCursor).toStrictEqual({ ts: baseTs + 3, id: idFromNum(3) });

        const third = await adapter.rebuildForWindow({
            name: 'history_paged',
            fromTs: baseTs,
            toTs: baseTs + 10,
            maxRecords: 2,
            order: 2,
            after: second.lastCursor ?? undefined,
        });

        expect(third.loaded).toBe(1);
        expect(third.cappedByRecords).toBe(false);
        expect(third.lastCursor).toStrictEqual({ ts: baseTs + 4, id: idFromNum(4) });
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
            maxRecordsPerWindow: 10000,
            deferInitialBuild: true,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
            frameSizeLimit: 4096,
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

    it('returns cloned session stats snapshots', async () => {
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();

        await seedStore(storeA, [
            // eslint-disable-next-line sonarjs/no-duplicate-string
            { id: h('a'), ts: nowTs - 100, op: makeOp('a', '2026-02-09T23:58:20.000Z') },
        ]);
        await seedStore(storeB, [
            { id: h('a'), ts: nowTs - 100, op: makeOp('a', '2026-02-09T23:58:20.000Z') },
        ]);

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

        await adapterA.runWindowedSessionWithPeer(adapterB, { nowTs });
        const snapshotA = adapterA.getLastSessionStats();
        expect(snapshotA).not.toBeNull();

        snapshotA!.windows[0].windowName = 'mutated';
        const snapshotB = adapterA.getLastSessionStats();
        expect(snapshotB).not.toBeNull();
        expect(snapshotB!.windows[0].windowName).not.toBe('mutated');
    });

    it('completes a window when peer responds with null', async () => {
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();

        await seedStore(storeA, [
            { id: h('a'), ts: nowTs - 100, op: makeOp('a', '2026-02-09T23:58:20.000Z') },
        ]);
        await seedStore(storeB, [
            { id: h('a'), ts: nowTs - 100, op: makeOp('a', '2026-02-09T23:58:20.000Z') },
        ]);

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

        (adapterB as any).respond = async () => null;

        const session = await adapterA.runWindowedSessionWithPeer(adapterB, {
            nowTs,
            maxRoundsPerSession: 3,
        });

        expect(session.windowCount).toBeGreaterThan(0);
        expect(session.windows[0].rounds).toBe(1);
        expect(session.windows[0].completed).toBe(true);
        expect(session.windows[0].cappedByRounds).toBe(false);
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

    it('continues paging through history while record-capped pages remain', async () => {
        const nowTs = toEpochSeconds('2026-02-10T00:00:00.000Z');
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();

        await seedStore(storeA, [
            { id: h('a'), ts: nowTs - 3, op: makeOp('a', toISOFromEpochSeconds(nowTs - 3)) },
            { id: h('b'), ts: nowTs - 2, op: makeOp('b', toISOFromEpochSeconds(nowTs - 2)) },
            { id: h('c'), ts: nowTs - 1, op: makeOp('c', toISOFromEpochSeconds(nowTs - 1)) },
        ]);
        await seedStore(storeB, [
            { id: h('a'), ts: nowTs - 3, op: makeOp('a', toISOFromEpochSeconds(nowTs - 3)) },
            { id: h('b'), ts: nowTs - 2, op: makeOp('b', toISOFromEpochSeconds(nowTs - 2)) },
            { id: h('c'), ts: nowTs - 1, op: makeOp('c', toISOFromEpochSeconds(nowTs - 1)) },
        ]);

        const adapterA = await NegentropyAdapter.create({
            syncStore: storeA,
            frameSizeLimit: 0,
            maxRecordsPerWindow: 1,
            deferInitialBuild: true,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
            frameSizeLimit: 0,
            maxRecordsPerWindow: 1,
            deferInitialBuild: true,
        });

        const session = await adapterA.runWindowedSessionWithPeer(adapterB, { nowTs });
        expect(session.windowCount).toBe(3);
        expect(session.windows[0].windowName).toBe('history_paged');
        expect(session.windows[0].cappedByRecords).toBe(true);
        expect(session.windows[1].cappedByRecords).toBe(true);
        expect(session.windows[2].cappedByRecords).toBe(false);
    });
});
