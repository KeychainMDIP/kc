import { jest } from '@jest/globals';

import CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import { generateCID } from '@mdip/ipfs/utils';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    createImportPipeline,
    type ImportPipelineOptions,
} from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import { mapAcceptedOperationsToSyncRecords } from '../../services/mediators/hyperswarm/src/sync-persistence.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';

const operation: Operation = {
    type: 'create',
    created: '2026-08-01T12:00:00.000Z',
    mdip: {
        version: 1,
        type: 'agent',
        registry: 'hyperswarm',
    },
    signature: {
        signed: '2026-08-01T12:00:00.000Z',
        hash: 'a'.repeat(64),
        value: 'signature',
    },
};

function createPipeline(
    isReady: jest.Mock<() => Promise<boolean>>,
    syncStore = new InMemoryOperationSyncStore(),
    gatekeeperOverrides: Partial<ImportPipelineOptions['gatekeeper']> = {},
    callbackOverrides: Partial<Pick<ImportPipelineOptions, 'beginStoreMutation' | 'onStoreChanged'>> = {},
) {
    const gatekeeper = {
        exportIndex: jest.fn(),
        importBatch: jest.fn(),
        isReady,
        processEvents: jest.fn(),
        ...gatekeeperOverrides,
    } as unknown as ImportPipelineOptions['gatekeeper'];

    return createImportPipeline({
        gatekeeper,
        syncStore,
        cipher: new CipherNode(),
        syncStats: createMediatorSyncStats(),
        retryDelayMs: 300_000,
        beginStoreMutation: jest.fn(() => jest.fn()),
        onStoreChanged: jest.fn(),
        ...callbackOverrides,
    });
}

async function makeTerminalChain(): Promise<{ root: Operation; child: Operation }> {
    const cipher = new CipherNode();
    const rootUnsigned = {
        type: 'update' as const,
        did: 'did:test:legacy',
        doc: { didDocumentData: { root: true } },
    };
    const root: Operation = {
        ...rootUnsigned,
        signature: {
            signed: '2026-08-01T12:00:00.000Z',
            hash: cipher.hashJSON(rootUnsigned),
            value: 'signature',
        },
    };
    const rootCid = await generateCID(JSON.parse(cipher.canonicalizeJSON(root)));
    const childUnsigned = {
        type: 'update' as const,
        did: rootUnsigned.did,
        previd: rootCid,
        doc: { didDocumentData: { child: true } },
    };
    return {
        root,
        child: {
            ...childUnsigned,
            signature: {
                signed: '2026-08-01T12:01:00.000Z',
                hash: cipher.hashJSON(childUnsigned),
                value: 'signature',
            },
        },
    };
}

function makeValidOperation(index: number): Operation {
    const cipher = new CipherNode();
    const unsigned = {
        type: 'create' as const,
        created: new Date(Date.UTC(2026, 7, 1, 12, 0, 0, index)).toISOString(),
        mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
    };
    return {
        ...unsigned,
        signature: {
            signed: unsigned.created,
            hash: cipher.hashJSON(unsigned),
            value: `signature-${index}`,
        },
    };
}

describe('import pipeline', () => {
    it('runs completion before starting the next queued import', async () => {
        const isReady = jest.fn(async () => false);
        const pipeline = createPipeline(isReady);
        let aborted = false;

        const first = pipeline.enqueue(
            { kind: 'remote', name: 'peer-a', data: [operation] },
            () => { aborted = true; },
        );
        const second = pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [operation],
            cancelled: () => aborted,
        });

        await expect(first).resolves.toMatchObject({ retryable: true });
        await expect(second).resolves.toMatchObject({ retryable: false });
        expect(isReady).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('drains active work during shutdown and rejects later imports', async () => {
        let releaseReady!: () => void;
        const isReady = jest.fn(() => new Promise<boolean>(resolve => {
            releaseReady = () => resolve(false);
        }));
        const pipeline = createPipeline(isReady);
        const active = pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [operation] });
        const shutdown = pipeline.shutdown();

        await new Promise(resolve => setImmediate(resolve));
        expect(pipeline.running).toBe(1);
        releaseReady();
        await expect(active).resolves.toMatchObject({ retryable: true });
        await shutdown;
        await expect(pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [operation],
        })).resolves.toMatchObject({ retryable: true });
        expect(isReady).toHaveBeenCalledTimes(1);
    });

    it('does not persist terminal operations after their session is cancelled', async () => {
        const cipher = new CipherNode();
        const unsigned = {
            type: 'update' as const,
            did: 'did:test:legacy',
            doc: { didDocumentData: { legacy: true } },
        };
        const legacyOperation: Operation = {
            ...unsigned,
            signature: {
                signed: '2026-08-01T12:00:00.000Z',
                hash: cipher.hashJSON(unsigned),
                value: 'signature',
            },
        };
        const store = new InMemoryOperationSyncStore();
        const upsertMany = jest.spyOn(store, 'upsertMany');
        const pipeline = createPipeline(jest.fn(async () => true), store);
        let cancellationChecks = 0;

        await expect(pipeline.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [legacyOperation],
            cancelled: () => ++cancellationChecks > 1,
        })).resolves.toMatchObject({ persistedIds: [], retryable: false });
        expect(cancellationChecks).toBe(2);
        expect(upsertMany).not.toHaveBeenCalled();
        await pipeline.shutdown();
    });

    it('drains an admitted index refresh and rejects new refreshes during shutdown', async () => {
        let rejectRefresh!: (error: Error) => void;
        const exportIndex = jest.fn(() => new Promise<never>((_resolve, reject) => {
            rejectRefresh = reject;
        }));
        const pipeline = createPipeline(
            jest.fn(async () => true),
            new InMemoryOperationSyncStore(),
            { exportIndex },
        );
        const refresh = pipeline.refreshIndex('test');
        const refreshResult = expect(refresh).rejects.toThrow('index unavailable');
        let shutdownSettled = false;

        await new Promise(resolve => setImmediate(resolve));
        const shutdown = pipeline.shutdown().then(() => { shutdownSettled = true; });
        await new Promise(resolve => setImmediate(resolve));

        expect(shutdownSettled).toBe(false);
        await expect(pipeline.refreshIndex('late')).rejects.toThrow('import pipeline is shutting down');
        expect(exportIndex).toHaveBeenCalledTimes(1);

        rejectRefresh(new Error('index unavailable'));
        await refreshResult;
        await shutdown;
        expect(shutdownSettled).toBe(true);
    });

    it('invalidates the cache before an import write that persists and then throws', async () => {
        const store = new InMemoryOperationSyncStore();
        const upsertMany = store.upsertMany.bind(store);
        const finishStoreMutation = jest.fn();
        const beginStoreMutation = jest.fn(() => finishStoreMutation);
        const onStoreChanged = jest.fn();
        jest.spyOn(store, 'upsertMany').mockImplementationOnce(async records => {
            expect(beginStoreMutation).toHaveBeenCalledTimes(1);
            expect(finishStoreMutation).not.toHaveBeenCalled();
            await upsertMany(records);
            throw new Error('commit acknowledgement lost');
        });
        const pipeline = createPipeline(
            jest.fn(async () => true),
            store,
            {},
            { beginStoreMutation, onStoreChanged },
        );

        await expect(pipeline.enqueue({
            kind: 'local_queue',
            phase: 'persist',
            name: 'local',
            data: [operation],
        })).resolves.toMatchObject({ persistedIds: [], retryable: true });

        await expect(store.has(operation.signature!.hash)).resolves.toBe(true);
        expect(finishStoreMutation).toHaveBeenCalledTimes(1);
        expect(onStoreChanged).not.toHaveBeenCalled();
        await pipeline.shutdown();
    });

    it('does not remember a normally persisted operation as a terminal root', async () => {
        const { root, child } = await makeTerminalChain();
        const store = new InMemoryOperationSyncStore();
        const upsertMany = store.upsertMany.bind(store);
        let markWriteStarted!: () => void;
        const writeStarted = new Promise<void>(resolve => {
            markWriteStarted = resolve;
        });
        let releaseWrite!: () => void;
        const writeBlocked = new Promise<void>(resolve => {
            releaseWrite = resolve;
        });
        jest.spyOn(store, 'upsertMany').mockImplementationOnce(async records => {
            markWriteStarted();
            await writeBlocked;
            return upsertMany(records);
        });
        const pipeline = createPipeline(jest.fn(async () => true), store);
        const normal = pipeline.enqueue({
            kind: 'local_queue',
            phase: 'persist',
            name: 'local',
            data: [root],
        });
        await writeStarted;
        const terminal = pipeline.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [root],
        });

        releaseWrite();
        await expect(normal).resolves.toMatchObject({ persistedIds: [root.signature!.hash] });
        await expect(terminal).resolves.toMatchObject({
            knownIds: [root.signature!.hash],
            persistedIds: [],
        });
        await expect(pipeline.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [child],
        })).resolves.toMatchObject({ persistedIds: [] });
        expect((await store.getByIds([root.signature!.hash]))[0].syncOrder)
            .not.toBe(Number.MAX_SAFE_INTEGER);
        await expect(store.has(child.signature!.hash)).resolves.toBe(false);
        await pipeline.shutdown();
    });

    it('forgets terminal operation CIDs when the pipeline is rebuilt', async () => {
        const { root, child } = await makeTerminalChain();
        const store = new InMemoryOperationSyncStore();
        const first = createPipeline(jest.fn(async () => true), store);

        await expect(first.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [root],
        })).resolves.toMatchObject({ persistedIds: [root.signature!.hash] });
        await expect(first.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [child],
        })).resolves.toMatchObject({ persistedIds: [child.signature!.hash] });
        await first.shutdown();
        await expect(store.deleteBySyncOrder(Number.MAX_SAFE_INTEGER)).resolves.toBe(2);

        const rebuilt = createPipeline(jest.fn(async () => true), store);
        await expect(rebuilt.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [child],
        })).resolves.toMatchObject({ persistedIds: [] });
        await expect(store.has(child.signature!.hash)).resolves.toBe(false);
        await rebuilt.shutdown();
    });

    it('persists each processing page before requesting the next page', async () => {
        const operations = [makeValidOperation(1), makeValidOperation(2)];
        const store = new InMemoryOperationSyncStore();
        const order: string[] = [];
        const upsertMany = store.upsertMany.bind(store);
        jest.spyOn(store, 'upsertMany').mockImplementation(async records => {
            order.push(`persist-${records[0].id}`);
            return upsertMany(records);
        });
        const processEvents = jest.fn<GatekeeperClient['processEvents']>()
            .mockImplementationOnce(async () => {
                order.push('process-1');
                return {
                    added: 1, merged: 0, rejected: 0, pending: 1,
                    acceptedHashes: [operations[0].signature!.hash],
                    acceptedEvents: [{ registry: 'hyperswarm', time: operations[0].created!, operation: operations[0] }],
                    hasMore: true,
                };
            })
            .mockImplementationOnce(async () => {
                order.push('process-2');
                return {
                    added: 1, merged: 0, rejected: 0, pending: 0,
                    acceptedHashes: [operations[1].signature!.hash],
                    acceptedEvents: [{ registry: 'hyperswarm', time: operations[1].created!, operation: operations[1] }],
                    hasMore: false,
                };
            });
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn<GatekeeperClient['importBatch']>(async events => ({
                queued: events.length, processed: 0, rejected: 0, total: events.length,
                rejectedIndices: [], capacityDeferred: 0, capacityDeferredIndices: [], processedIndices: [],
            })),
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: operations }))
            .resolves.toMatchObject({
                persistedIds: operations.map(op => op.signature!.hash),
                pendingIds: [],
                capacityDeferredIds: [],
                retryable: false,
            });
        expect(order).toEqual([
            'process-1',
            `persist-${operations[0].signature!.hash}`,
            'process-2',
            `persist-${operations[1].signature!.hash}`,
        ]);
        await pipeline.shutdown();
    });

    it('does not abort a request for unrelated processing-page capacity', async () => {
        const requested = Array.from({ length: 101 }, (_, index) => makeValidOperation(index + 1));
        const unrelated = makeValidOperation(102);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>(async events => ({
            queued: events.length,
            processed: 0,
            rejected: 0,
            total: events.length,
            rejectedIndices: [],
            capacityDeferred: 0,
            capacityDeferredIndices: [],
            processedIndices: [],
        }));
        const processEvents = jest.fn<GatekeeperClient['processEvents']>()
            .mockResolvedValueOnce({
                added: 100,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: requested.slice(0, 100).map(item => item.signature!.hash),
                acceptedEvents: requested.slice(0, 100).map(item => ({
                    registry: 'hyperswarm',
                    time: item.created!,
                    operation: item,
                })),
                capacityDeferred: 1,
                capacityDeferredHashes: [unrelated.signature!.hash],
                hasMore: false,
            })
            .mockResolvedValueOnce({
                added: 1,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: [requested[100].signature!.hash],
                acceptedEvents: [{
                    registry: 'hyperswarm',
                    time: requested[100].created!,
                    operation: requested[100],
                }],
                hasMore: false,
            });
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        const result = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: requested });

        expect(result).toMatchObject({
            persistedIds: requested.map(item => item.signature!.hash),
            pendingIds: [],
            capacityDeferredIds: [],
            retryable: false,
        });
        expect(importBatch).toHaveBeenCalledTimes(2);
        expect(processEvents).toHaveBeenCalledTimes(2);
        await pipeline.shutdown();
    });

    it('reports processing-page backpressure for the requested operation', async () => {
        const deferred = makeValidOperation(1);
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch: jest.fn<GatekeeperClient['importBatch']>(async () => ({
                queued: 1, processed: 0, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [],
            })),
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({
                added: 0, merged: 0, rejected: 0, pending: 0,
                capacityDeferred: 1,
                capacityDeferredHashes: [deferred.signature!.hash.toUpperCase()],
                hasMore: false,
            })),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] }))
            .resolves.toMatchObject({
                persistedIds: [],
                pendingIds: [],
                capacityDeferredIds: [deferred.signature!.hash],
                retryable: false,
            });
        await pipeline.shutdown();
    });

    it('reports an unverified tail when backpressure stops a multi-chunk import', async () => {
        const operations = Array.from({ length: 101 }, (_, index) => makeValidOperation(index));
        operations[100].signature!.hash = 'f'.repeat(64);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>(async events => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: events.length,
            capacityDeferredIndices: events.map((_event, index) => index), processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: operations }))
            .resolves.toMatchObject({
                capacityDeferredIds: operations.slice(0, 100).map(item => item.signature!.hash),
                retryable: true,
            });
        expect(importBatch).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('delays a capacity-deferred operation without refreshing its deadline on retransmission', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
        const deferred = makeValidOperation(1);
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: 1, capacityDeferredIndices: [0], processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(),
        });

        const first = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        expect(first).toMatchObject({
            capacityDeferredIds: [deferred.signature!.hash],
            retryable: false,
        });
        await jest.advanceTimersByTimeAsync(299_000);
        const repeated = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        expect(repeated.capacityDeferredIds).toEqual([deferred.signature!.hash]);
        expect(importBatch).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1_000);
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        expect(importBatch).toHaveBeenCalledTimes(2);
        await pipeline.shutdown();
        jest.useRealTimers();
    });

    it('does not put an unverified capacity result into retry suppression', async () => {
        const invalid = makeValidOperation(1);
        invalid.signature!.hash = 'f'.repeat(64);
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: 1, capacityDeferredIndices: [0], processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [invalid] }))
            .resolves.toMatchObject({ capacityDeferredIds: [], retryable: true });
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [invalid] });
        expect(importBatch).toHaveBeenCalledTimes(2);
        await pipeline.shutdown();
    });

    it('does not process or immediately resubmit an already-pending operation', async () => {
        const pending = makeValidOperation(1);
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 1, rejected: 0, total: 1,
            rejectedIndices: [], capacityDeferred: 0, capacityDeferredIndices: [], processedIndices: [0],
        }));
        const processEvents = jest.fn<GatekeeperClient['processEvents']>();
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [pending] }))
            .resolves.toMatchObject({
                persistedIds: [],
                pendingIds: [pending.signature!.hash],
                capacityDeferredIds: [],
                retryable: false,
            });
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [pending] });

        expect(importBatch).toHaveBeenCalledTimes(1);
        expect(processEvents).not.toHaveBeenCalled();
        await pipeline.shutdown();
    });

    it('reports a delayed operation accepted while processing its dependency', async () => {
        const pending = makeValidOperation(1);
        const dependency = makeValidOperation(2);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>()
            .mockResolvedValueOnce({
                queued: 0, processed: 1, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [0],
            })
            .mockResolvedValueOnce({
                queued: 1, processed: 0, rejected: 0, total: 2,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [],
            });
        const processEvents = jest.fn<GatekeeperClient['processEvents']>(async () => ({
            added: 2,
            merged: 0,
            rejected: 0,
            pending: 0,
            acceptedHashes: [pending.signature!.hash, dependency.signature!.hash],
            acceptedEvents: [pending, dependency].map(item => ({
                registry: 'hyperswarm',
                time: item.created!,
                operation: item,
            })),
            hasMore: false,
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [pending] }))
            .resolves.toMatchObject({ pendingIds: [pending.signature!.hash] });
        await expect(pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [pending, dependency],
        })).resolves.toMatchObject({
            persistedIds: expect.arrayContaining([
                pending.signature!.hash,
                dependency.signature!.hash,
            ]),
            pendingIds: [],
            capacityDeferredIds: [],
            retryable: false,
        });
        expect(importBatch.mock.calls[1][0]).toHaveLength(1);
        expect(importBatch.mock.calls[1][0][0].operation).toBe(dependency);
        await pipeline.shutdown();
    });

    it('processes admitted work after an import response is lost', async () => {
        const admitted = makeValidOperation(1);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>()
            .mockRejectedValueOnce(new Error('import response lost'))
            .mockResolvedValueOnce({
                queued: 0, processed: 1, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [0],
            });
        const processEvents = jest.fn<GatekeeperClient['processEvents']>(async () => ({
            added: 1,
            merged: 0,
            rejected: 0,
            pending: 0,
            acceptedHashes: [admitted.signature!.hash],
            acceptedEvents: [{
                registry: 'hyperswarm',
                time: admitted.created!,
                operation: admitted,
            }],
            hasMore: false,
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [admitted] }))
            .resolves.toMatchObject({ retryable: true });
        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [admitted] }))
            .resolves.toMatchObject({
                persistedIds: [admitted.signature!.hash],
                pendingIds: [],
                retryable: false,
            });

        expect(processEvents).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('bounds retry delays with FIFO eviction', async () => {
        const operations = Array.from({ length: 25_001 }, (_, index) => makeValidOperation(index));
        const importBatch = jest.fn(async (events: GatekeeperEvent[]) => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: events.length,
            capacityDeferredIndices: events.map((_event, index) => index), processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(),
        });

        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: operations });
        await pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [operations[0], operations.at(-1)!],
        });

        expect(importBatch).toHaveBeenCalledTimes(2);
        expect(importBatch.mock.calls[1][0]).toHaveLength(1);
        expect(importBatch.mock.calls[1][0][0].operation.signature!.hash)
            .toBe(operations[0].signature!.hash);
        await pipeline.shutdown();
    });

    it('clears a retry delay when the operation is found in the sync store', async () => {
        const deferred = makeValidOperation(1);
        const store = new InMemoryOperationSyncStore();
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: 1, capacityDeferredIndices: [0], processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(),
        });

        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        await store.upsertMany(mapAcceptedOperationsToSyncRecords([deferred]).records);
        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] }))
            .resolves.toMatchObject({ knownIds: [deferred.signature!.hash] });
        await store.reset();
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });

        expect(importBatch).toHaveBeenCalledTimes(2);
        await pipeline.shutdown();
    });

    it('keeps retry delays when pruning them during an index refresh fails', async () => {
        const deferred = makeValidOperation(1);
        const store = new InMemoryOperationSyncStore();
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({
                queued: 0, processed: 0, rejected: 0, total: 0,
                rejectedIndices: [], capacityDeferred: 1,
                capacityDeferredIndices: [0], processedIndices: [],
            })),
            processEvents: jest.fn<GatekeeperClient['processEvents']>(),
            exportIndex: jest.fn(async () => ({
                mode: 'snapshot' as const,
                dids: [],
                blocks: [],
                cursor: '0',
                checkpointCursor: '0',
                hasMore: false,
                indexEpoch: 'epoch-a',
            })),
        });

        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        const getByIds = jest.spyOn(store, 'getByIds').mockRejectedValueOnce(new Error('lookup failed'));

        await expect(pipeline.refreshIndex('test')).resolves.toMatchObject({ snapshotComplete: true });
        expect(getByIds).toHaveBeenCalledWith([deferred.signature!.hash]);
        await pipeline.shutdown();
    });
});
