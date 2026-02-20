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

describe('bootstrapSyncStoreIfEmpty', () => {
    it('skips bootstrap when store is already populated', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.upsertMany([{
            id: h('a'),
            // eslint-disable-next-line sonarjs/no-duplicate-string
            ts: Date.parse('2026-02-10T10:00:00.000Z'),
            operation: makeOperation('a', '2026-02-10T10:00:00.000Z'),
        }]);

        const gatekeeper = {
            exportBatch: jest.fn(async () => []),
        };

        const result = await bootstrapSyncStoreIfEmpty(store, gatekeeper);
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('store_not_empty');
        expect(gatekeeper.exportBatch).not.toHaveBeenCalled();
        expect(await store.count()).toBe(1);
    });

    it('bootstraps from gatekeeper exportBatch when store is empty', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const opB = makeOperation('b', '2026-02-10T11:00:00.000Z');
        const gatekeeper = {
            exportBatch: jest.fn(async () => [makeEvent(opA), makeEvent(opB)]),
        };

        const result = await bootstrapSyncStoreIfEmpty(store, gatekeeper);
        expect(result.skipped).toBe(false);
        expect(result.exported).toBe(2);
        expect(result.mapped).toBe(2);
        expect(result.invalid).toBe(0);
        expect(result.inserted).toBe(2);
        expect(result.countAfter).toBe(2);
        expect(gatekeeper.exportBatch).toHaveBeenCalledTimes(1);
        expect(await store.count()).toBe(2);
    });

    it('throws when gatekeeper exportBatch fails', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();

        const gatekeeper = {
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
            exportBatch: jest.fn(async () => [{ registry: 'hyperswarm', time: new Date().toISOString() }]),
        };

        const result = await bootstrapSyncStoreIfEmpty(store, gatekeeper as any);
        expect(result.skipped).toBe(false);
        expect(result.exported).toBe(0);
        expect(result.mapped).toBe(0);
        expect(result.invalid).toBe(0);
        expect(result.inserted).toBe(0);
        expect(result.countAfter).toBe(0);
        expect(gatekeeper.exportBatch).toHaveBeenCalledTimes(1);
    });
});
