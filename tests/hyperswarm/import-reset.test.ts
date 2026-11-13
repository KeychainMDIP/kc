import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import type { IndexExportRequest, IndexExportResponse, Operation } from '@mdip/gatekeeper/types';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import { createImportPipeline, type ImportPipelineOptions } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';

const operation: Operation = {
    type: 'create', created: '2026-01-01T00:00:00.000Z',
    mdip: { version: 1, type: 'agent', registry: 'hyperswarm' },
    signature: { signed: '2026-01-01T00:00:00.000Z', hash: 'a'.repeat(64), value: 'signature' },
};

function fixture() {
    const store = new InMemoryOperationSyncStore();
    const cipher = new CipherNode();
    let serverEpoch = 'epoch-a';
    const exportIndex = jest.fn(async (request: IndexExportRequest): Promise<IndexExportResponse> => ({
        mode: request.mode, indexEpoch: serverEpoch, cursor: '0', checkpointCursor: '0', hasMore: false,
        dids: [], blocks: [], ...(request.mode === 'changes' && { operations: [] }),
    }));
    const importBatch = jest.fn<ImportPipelineOptions['gatekeeper']['importBatch']>(async () => ({
        queued: 1, processed: 0, rejected: 0, total: 1, rejectedIndices: [],
    }));
    const processEvents = jest.fn<ImportPipelineOptions['gatekeeper']['processEvents']>(async () => ({
        added: 0, merged: 0, rejected: 0, pending: 1, acceptedHashes: [], acceptedEvents: [],
    }));
    const pipeline = createImportPipeline({
        gatekeeper: { importBatch, processEvents, exportIndex, isReady: async () => true,
            getStatus: async () => ({ uptimeSeconds: 0, memoryUsage: process.memoryUsage(),
                eventsQueue: { staged: 0, pending: 0, processing: 0, total: 0, active: false } }),
        },
        syncStore: store, cipher, syncStats: createMediatorSyncStats(),
        beginStoreMutation: () => () => {}, onStoreChanged: () => {},
    });
    return { store, cipher, pipeline, importBatch, processEvents, exportIndex, reset() { serverEpoch = 'epoch-b'; } };
}

describe('Hyperswarm import reset boundary', () => {
    it('does not persist terminal classification cancelled during content verification', async () => {
        const { pipeline, store, cipher } = fixture();
        const unsigned: Operation = { type: 'update', did: 'did:test:legacy', doc: {} };
        const candidate = { ...unsigned, signature: { ...operation.signature!, hash: cipher.hashJSON(unsigned) } };
        await pipeline.refreshIndex('startup');
        let cancelled = false;
        const original = cipher.hashJSON.bind(cipher);
        const hash = jest.spyOn(cipher, 'hashJSON').mockImplementation(value => {
            cancelled = true;
            return original(value);
        });
        const write = jest.spyOn(store, 'upsertMany');
        try {
            await expect(pipeline.enqueue({ kind: 'terminal', name: 'peer', data: [candidate], cancelled: () => cancelled }))
                .resolves.toMatchObject({ retryable: false, persistedIds: [] });
            expect(hash).toHaveBeenCalledTimes(1);
            expect(write).not.toHaveBeenCalled();
            expect(await store.count()).toBe(0);
        } finally { await pipeline.shutdown(); }
    });

    it.each(['remote', 'terminal'] as const)('stops cancelled %s work after its known-operation lookup', async kind => {
        const { pipeline, store, importBatch, processEvents } = fixture();
        const unsigned: Operation = { type: 'update', did: 'did:test:legacy', doc: {} };
        const candidate = {
            ...unsigned,
            signature: { ...operation.signature!, hash: new CipherNode().hashJSON(unsigned) },
        };
        await pipeline.refreshIndex('startup');
        let cancelled = false;
        jest.spyOn(store, 'getByIds').mockImplementationOnce(async () => {
            cancelled = true;
            return [];
        });
        const write = jest.spyOn(store, 'upsertMany');
        try {
            await expect(pipeline.enqueue({ kind, name: 'peer', data: [candidate], cancelled: () => cancelled }))
                .resolves.toMatchObject({ retryable: false, persistedIds: [] });
            expect(importBatch).not.toHaveBeenCalled();
            expect(processEvents).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
            expect(await store.count()).toBe(0);
        } finally { await pipeline.shutdown(); }
    });

    it('uses the mirrored epoch for admission and event processing', async () => {
        const { pipeline, importBatch, processEvents } = fixture();
        try {
            await pipeline.refreshIndex('startup');
            await pipeline.enqueue({ kind: 'remote', name: 'peer', data: [operation] });
            expect(importBatch).toHaveBeenCalledWith(expect.any(Array), 'epoch-a');
            expect(processEvents).toHaveBeenCalledWith('epoch-a');
        } finally { await pipeline.shutdown(); }
    });

    it('stops old chunks and queued sessions when reset interrupts admission', async () => {
        const { pipeline, importBatch, processEvents, reset } = fixture();
        await pipeline.refreshIndex('startup');
        const batch = Array.from({ length: 250 }, (_, index) => ({
            ...operation, signature: { ...operation.signature!, hash: index.toString(16).padStart(64, '0') },
        }));
        importBatch.mockImplementationOnce(async () => {
            reset();
            return { queued: 100, processed: 0, rejected: 0, total: 100, rejectedIndices: [] };
        }).mockRejectedValueOnce({ error: 'gatekeeper_index_epoch_changed' });
        try {
            const active = pipeline.enqueue({ kind: 'remote', name: 'peer', data: batch });
            const queued = pipeline.enqueue({ kind: 'remote', name: 'peer', data: [operation] });
            const refresh = pipeline.refreshIndex('discover-reset');
            await expect(active).resolves.toMatchObject({ retryable: true, indexEpochChanged: true, persistedIds: [] });
            await expect(queued).resolves.toMatchObject({ retryable: true, indexEpochChanged: true, persistedIds: [] });
            await expect(refresh).resolves.toMatchObject({ resetReason: 'gatekeeper_index_epoch_changed' });
            expect(importBatch).toHaveBeenCalledTimes(2);
            expect(processEvents).not.toHaveBeenCalled();
            expect(pipeline.indexEpoch).toBe('epoch-b');
            await expect(pipeline.enqueue({
                kind: 'remote', name: 'old-session', data: [operation], indexEpoch: 'epoch-a',
            })).resolves.toMatchObject({ retryable: true, indexEpochChanged: true, persistedIds: [] });
            expect(importBatch).toHaveBeenCalledTimes(2);
            await pipeline.enqueue({ kind: 'remote', name: 'new-session', data: [operation] });
            expect(importBatch).toHaveBeenLastCalledWith(expect.any(Array), 'epoch-b');
            expect(processEvents).toHaveBeenCalledWith('epoch-b');
        } finally { await pipeline.shutdown(); }
    });

    it('does not persist stale candidates when reset interrupts event processing', async () => {
        const { pipeline, store, importBatch, processEvents, reset } = fixture();
        await pipeline.refreshIndex('startup');
        importBatch.mockImplementationOnce(async () => {
            reset();
            return { queued: 1, processed: 0, rejected: 0, total: 1, rejectedIndices: [] };
        });
        processEvents.mockRejectedValueOnce({ error: 'gatekeeper_index_epoch_changed' });
        try {
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer', data: [operation] }))
                .resolves.toMatchObject({ retryable: true, indexEpochChanged: true, persistedIds: [] });
            expect(await store.count()).toBe(0);
            await pipeline.refreshIndex('reset');
            expect(pipeline.indexEpoch).toBe('epoch-b');
        } finally { await pipeline.shutdown(); }
    });

    it('finishes accepted persistence before an epoch refresh can reset the store', async () => {
        const { pipeline, store, processEvents, exportIndex, reset } = fixture();
        await pipeline.refreshIndex('startup');
        processEvents.mockResolvedValueOnce({
            added: 1, merged: 0, rejected: 0, pending: 0,
            acceptedHashes: [operation.signature!.hash!],
            acceptedEvents: [{ operation, registry: 'hyperswarm', time: operation.created! }],
        });
        let release!: () => void;
        let entered!: () => void;
        const enteredWrite = new Promise<void>(resolve => { entered = resolve; });
        const held = new Promise<void>(resolve => { release = resolve; });
        const original = store.upsertMany.bind(store);
        jest.spyOn(store, 'upsertMany').mockImplementationOnce(async records => {
            entered();
            await held;
            return original(records);
        });
        try {
            const active = pipeline.enqueue({ kind: 'remote', name: 'peer', data: [operation] });
            await enteredWrite;
            reset();
            const refresh = pipeline.refreshIndex('reset');
            await new Promise(resolve => setImmediate(resolve));
            expect(exportIndex).toHaveBeenCalledTimes(1);
            release();
            await active;
            await expect(refresh).resolves.toMatchObject({ resetReason: 'gatekeeper_index_epoch_changed', countAfter: 0 });
            expect(await store.count()).toBe(0);
        } finally {
            release?.();
            await pipeline.shutdown();
        }
    });
});
