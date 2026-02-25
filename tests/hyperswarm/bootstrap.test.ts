import { jest } from '@jest/globals';
import { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import { bootstrapSyncStoreIfEmpty } from '../../services/mediators/hyperswarm/src/bootstrap.ts';

const h = (c: string) => c.repeat(64);

function makeOperation(hashChar: string, signed: string): Operation {
    return {
        type: 'create',
        signature: {
            hash: h(hashChar),
            signed,
            value: `sig-${hashChar}`,
        },
    };
}

function makeEvent(operation: Operation): GatekeeperEvent {
    return {
        registry: 'hyperswarm',
        time: new Date().toISOString(),
        operation,
    };
}

function makeDid(index: number): string {
    return `did:test:${index}`;
}

describe('bootstrapSyncStoreIfEmpty', () => {
    it('skips rebuild when store drift is within configured percentage tolerance', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        // eslint-disable-next-line sonarjs/no-duplicate-string
        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        await store.upsertMany([{
            id: h('a'),
            // eslint-disable-next-line sonarjs/no-duplicate-string
            ts: Math.floor(Date.parse('2026-02-10T10:00:00.000Z') / 1000),
            operation: opA,
        }]);

        const gatekeeper = {
            getDIDs: jest.fn(async () => [makeDid(1)]),
            exportBatch: jest.fn(async () => [makeEvent(opA)]),
        };

        const result = await bootstrapSyncStoreIfEmpty(store, gatekeeper);
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('store_within_drift_tolerance');
        expect(result.driftPct).toBe(0);
        expect(gatekeeper.getDIDs).toHaveBeenCalledTimes(1);
        expect(gatekeeper.exportBatch).toHaveBeenCalledTimes(1);
        expect(gatekeeper.exportBatch).toHaveBeenCalledWith([makeDid(1)]);
        expect(await store.count()).toBe(1);
    });

    it('rebuilds populated store when drift percentage exceeds threshold', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.upsertMany([{
            id: h('a'),
            ts: Math.floor(Date.parse('2026-02-10T10:00:00.000Z') / 1000),
            operation: makeOperation('a', '2026-02-10T10:00:00.000Z'),
        }]);

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const opB = makeOperation('b', '2026-02-10T11:00:00.000Z');
        const gatekeeper = {
            getDIDs: jest.fn(async () => [makeDid(1), makeDid(2)]),
            exportBatch: jest.fn(async () => [makeEvent(opA), makeEvent(opB)]),
        };

        const result = await bootstrapSyncStoreIfEmpty(store, gatekeeper);
        expect(result.skipped).toBe(false);
        expect(result.countBefore).toBe(1);
        expect(result.countAfter).toBe(2);
        expect(result.driftPct).toBeGreaterThan(result.driftThresholdPct);
        expect(result.inserted).toBe(2);
        expect(gatekeeper.getDIDs).toHaveBeenCalledTimes(1);
        expect(gatekeeper.exportBatch).toHaveBeenCalledTimes(2);
        expect(await store.count()).toBe(2);
    });

    it('bootstraps from gatekeeper exportBatch when store is empty', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const opB = makeOperation('b', '2026-02-10T11:00:00.000Z');
        const gatekeeper = {
            getDIDs: jest.fn(async () => [makeDid(1), makeDid(2)]),
            exportBatch: jest.fn(async () => [makeEvent(opA), makeEvent(opB)]),
        };

        const result = await bootstrapSyncStoreIfEmpty(store, gatekeeper);
        expect(result.skipped).toBe(false);
        expect(result.exported).toBe(2);
        expect(result.mapped).toBe(2);
        expect(result.invalid).toBe(0);
        expect(result.inserted).toBe(2);
        expect(result.countAfter).toBe(2);
        expect(result.driftPct).toBe(1);
        expect(gatekeeper.getDIDs).toHaveBeenCalledTimes(1);
        expect(gatekeeper.exportBatch).toHaveBeenCalledTimes(1);
        expect(gatekeeper.exportBatch).toHaveBeenCalledWith([makeDid(1), makeDid(2)]);
        expect(await store.count()).toBe(2);
    });

    it('throws when gatekeeper exportBatch fails', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();

        const gatekeeper = {
            getDIDs: jest.fn(async () => [makeDid(1)]),
            exportBatch: jest.fn(async () => {
                throw new Error('boom');
            }),
        };

        await expect(bootstrapSyncStoreIfEmpty(store, gatekeeper)).rejects.toThrow('boom');
    });

    it('handles empty/invalid export payload without upserting', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();

        const gatekeeper = {
            getDIDs: jest.fn(async () => [makeDid(1)]),
            exportBatch: jest.fn(async () => [{ registry: 'hyperswarm', time: new Date().toISOString() }]),
        };

        const result = await bootstrapSyncStoreIfEmpty(store, gatekeeper as any);
        expect(result.skipped).toBe(false);
        expect(result.exported).toBe(0);
        expect(result.mapped).toBe(0);
        expect(result.invalid).toBe(0);
        expect(result.inserted).toBe(0);
        expect(result.countAfter).toBe(0);
        expect(result.driftPct).toBe(0);
        expect(gatekeeper.getDIDs).toHaveBeenCalledTimes(1);
        expect(gatekeeper.exportBatch).toHaveBeenCalledTimes(1);
    });

    it('exports in DID batches to avoid loading the full export in one payload', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();

        const dids = Array.from({ length: 501 }, (_, index) => makeDid(index + 1));
        const gatekeeper = {
            getDIDs: jest.fn(async () => dids),
            exportBatch: jest.fn(async (batchDids?: string[]) => {
                return (batchDids ?? []).map((_, index) =>
                    makeEvent(makeOperation(index % 2 === 0 ? 'a' : 'b', '2026-02-10T10:00:00.000Z'))
                );
            }),
        };

        await bootstrapSyncStoreIfEmpty(store, gatekeeper);

        expect(gatekeeper.getDIDs).toHaveBeenCalledTimes(1);
        expect(gatekeeper.exportBatch).toHaveBeenCalledTimes(2);
        expect(gatekeeper.exportBatch).toHaveBeenNthCalledWith(1, dids.slice(0, 500));
        expect(gatekeeper.exportBatch).toHaveBeenNthCalledWith(2, dids.slice(500, 501));
    });
});
