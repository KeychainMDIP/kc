import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import { Operation } from '@mdip/gatekeeper/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const h = (c: string) => c.repeat(64);
const idFromNum = (n: number) => n.toString(16).padStart(64, '0');

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
            op: makeOpFromHash(id, new Date(baseTs + i).toISOString()),
        });
    }
    await seedStore(store, records);
}

describe('NegentropyAdapter', () => {
    it('loads and builds from store', async () => {
        const store = new InMemoryOperationSyncStore();
        await seedStore(store, [
            { id: h('a'), ts: 1000, op: makeOp('a', '2026-02-09T10:00:00.000Z') },
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

    it('plans recent window first then older windows in descending recency', async () => {
        const store = new InMemoryOperationSyncStore();
        const nowMs = Date.parse('2026-02-10T00:00:00.000Z');
        await seedStore(store, [
            { id: h('a'), ts: nowMs - (10 * DAY_MS), op: makeOp('a', '2026-01-31T00:00:00.000Z') },
            { id: h('b'), ts: nowMs - (2 * DAY_MS), op: makeOp('b', '2026-02-08T00:00:00.000Z') },
        ]);

        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            frameSizeLimit: 0,
            recentWindowDays: 3,
            olderWindowDays: 2,
            deferInitialBuild: true,
        });

        const windows = await adapter.planWindows(nowMs);
        expect(windows.length).toBeGreaterThanOrEqual(2);
        expect(windows[0].name).toBe('recent');
        expect(windows[0].toTs).toBe(nowMs);
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
        const baseTs = Date.parse('2026-02-01T00:00:00.000Z');
        const nowMs = Date.parse('2026-02-10T00:00:00.000Z');

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
            nowMs,
            maxRoundsPerSession: 1,
        });

        expect(session.windowCount).toBeGreaterThan(0);
        expect(session.windows.some(window => window.cappedByRounds)).toBe(true);
        expect(session.windows[0].rounds).toBe(1);
    });

    it('continues into older windows when a newer window hits record cap', async () => {
        const nowMs = Date.parse('2026-02-10T00:00:00.000Z');
        const storeA = new InMemoryOperationSyncStore();
        const storeB = new InMemoryOperationSyncStore();

        const recentA = nowMs - (6 * 60 * 60 * 1000);
        const recentB = nowMs - (8 * 60 * 60 * 1000);
        const older = nowMs - (2 * DAY_MS);

        await seedStore(storeA, [
            { id: h('a'), ts: recentA, op: makeOp('a', new Date(recentA).toISOString()) },
            { id: h('b'), ts: recentB, op: makeOp('b', new Date(recentB).toISOString()) },
            { id: h('c'), ts: older, op: makeOp('c', new Date(older).toISOString()) },
        ]);
        await seedStore(storeB, [
            { id: h('d'), ts: recentA, op: makeOp('d', new Date(recentA).toISOString()) },
            { id: h('e'), ts: older, op: makeOp('e', new Date(older).toISOString()) },
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

        const session = await adapterA.runWindowedSessionWithPeer(adapterB, { nowMs });
        const recent = session.windows.find(window => window.windowName === 'recent');
        const olderWindow = session.windows.find(window => window.windowName === 'older_1');

        expect(session.windowCount).toBeGreaterThanOrEqual(2);
        expect(recent?.cappedByRecords).toBe(true);
        expect(olderWindow).toBeDefined();
    });
});
