import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Operation } from '@mdip/gatekeeper/types';
import SqliteOperationSyncStore from '../../services/mediators/hyperswarm/src/db/sqlite.ts';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import { OperationSyncStore } from '../../services/mediators/hyperswarm/src/db/types.ts';

const h = (c: string) => c.repeat(64);

const opA: Operation = {
    type: 'create',
    signature: {
        signed: '2026-02-09T10:00:00.000Z',
        hash: h('a'),
        value: 'sig-a',
    },
};

const opB: Operation = {
    type: 'create',
    signature: {
        signed: '2026-02-09T11:00:00.000Z',
        hash: h('b'),
        value: 'sig-b',
    },
};

const opC: Operation = {
    type: 'create',
    signature: {
        signed: '2026-02-09T11:30:00.000Z',
        hash: h('c'),
        value: 'sig-c',
    },
};

const recA = { id: h('a'), ts: 1000, operation: opA };
const recB = { id: h('b'), ts: 2000, operation: opB };
const recC = { id: h('c'), ts: 2000, operation: opC };

async function runStoreContractTests(store: OperationSyncStore): Promise<void> {
    await store.start();
    await store.reset();

    const inserted1 = await store.upsertMany([recB, recA, recC]);
    expect(inserted1).toBe(3);

    const inserted2 = await store.upsertMany([recA, recC]);
    expect(inserted2).toBe(0);

    expect(await store.count()).toBe(3);
    expect(await store.has(recA.id)).toBe(true);
    expect(await store.has(h('d'))).toBe(false);

    const byIds = await store.getByIds([recC.id, recA.id, h('d')]);
    expect(byIds.map(item => item.id)).toStrictEqual([recC.id, recA.id]);

    const sortedAll = await store.iterateSorted();
    expect(sortedAll.map(item => item.id)).toStrictEqual([recA.id, recB.id, recC.id]);
    expect(sortedAll.every(item => Number.isFinite(item.insertedAt))).toBe(true);

    const firstTwo = await store.iterateSorted({ limit: 2 });
    expect(firstTwo.map(item => item.id)).toStrictEqual([recA.id, recB.id]);

    const rangeTs = await store.iterateSorted({ fromTs: 1500, toTs: 2000 });
    expect(rangeTs.map(item => item.id)).toStrictEqual([recB.id, recC.id]);

    const afterA = await store.iterateSorted({ after: { ts: 1000, id: recA.id } });
    expect(afterA.map(item => item.id)).toStrictEqual([recB.id, recC.id]);

    const afterB = await store.iterateSorted({ after: { ts: 2000, id: recB.id } });
    expect(afterB.map(item => item.id)).toStrictEqual([recC.id]);

    const afterRange = await store.iterateSorted({
        after: { ts: 1500, id: h('0') },
        fromTs: 1500,
        toTs: 2000,
    });
    expect(afterRange.map(item => item.id)).toStrictEqual([recB.id, recC.id]);

    await store.reset();
    expect(await store.count()).toBe(0);

    await store.stop();
}

describe('InMemoryOperationSyncStore', () => {
    it('implements sync-store contract', async () => {
        const store = new InMemoryOperationSyncStore();
        await runStoreContractTests(store);
    });

    it('preserves explicit insertedAt and handles empty getByIds input', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.reset();

        const insertedAt = 123456789;
        const inserted = await store.upsertMany([{
            ...recA,
            insertedAt,
        }]);

        expect(inserted).toBe(1);
        const rows = await store.getByIds([recA.id]);
        expect(rows[0].insertedAt).toBe(insertedAt);
        expect(await store.getByIds([])).toStrictEqual([]);
    });
});

describe('SqliteOperationSyncStore', () => {
    let tmpRoot = '';

    beforeEach(async () => {
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hypr-sync-store-'));
    });

    afterEach(async () => {
        if (tmpRoot) {
            await fs.rm(tmpRoot, { recursive: true, force: true });
        }
    });

    it('implements sync-store contract', async () => {
        const store = new SqliteOperationSyncStore('operations.db', path.join(tmpRoot, 'data/hyperswarm'));
        await runStoreContractTests(store);
    });

    it('is safe to stop before start and idempotent to start twice', async () => {
        const store = new SqliteOperationSyncStore('operations.db', path.join(tmpRoot, 'data/hyperswarm'));
        await expect(store.stop()).resolves.toBeUndefined();
        await store.start();
        await store.start();
        await expect(store.stop()).resolves.toBeUndefined();
    });

    it('throws from data APIs when start was not called', async () => {
        const store = new SqliteOperationSyncStore('operations.db', path.join(tmpRoot, 'data/hyperswarm'));

        await expect(store.reset()).rejects.toThrow('Call start() first');
        await expect(store.upsertMany([recA])).rejects.toThrow('Call start() first');
        await expect(store.getByIds([recA.id])).rejects.toThrow('Call start() first');
        await expect(store.iterateSorted()).rejects.toThrow('Call start() first');
        await expect(store.has(recA.id)).rejects.toThrow('Call start() first');
        await expect(store.count()).rejects.toThrow('Call start() first');
    });

    it('returns early for empty inputs', async () => {
        const store = new SqliteOperationSyncStore('operations.db', path.join(tmpRoot, 'data/hyperswarm'));
        await store.start();
        await store.reset();

        expect(await store.upsertMany([])).toBe(0);
        expect(await store.getByIds([])).toStrictEqual([]);
    });

    it('rolls back transaction when an upsert item fails serialization', async () => {
        const store = new SqliteOperationSyncStore('operations.db', path.join(tmpRoot, 'data/hyperswarm'));
        await store.start();
        await store.reset();

        const circular: any = { type: 'create' };
        circular.self = circular;

        await expect(store.upsertMany([
            recA,
            {
                id: h('d'),
                ts: 4000,
                operation: circular,
            } as any,
        ])).rejects.toThrow();

        expect(await store.count()).toBe(0);
    });

    it('returns zero count when sqlite get returns no row', async () => {
        const store = new SqliteOperationSyncStore('operations.db', path.join(tmpRoot, 'data/hyperswarm'));
        await store.start();

        const db = (store as any).db;
        const originalGet = db.get.bind(db);
        db.get = async () => undefined;
        await expect(store.count()).resolves.toBe(0);
        db.get = originalGet;
    });
});
