import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import { logger } from '@mdip/common/logger';
import Gatekeeper from '@mdip/gatekeeper';
import GatekeeperClient from '@mdip/gatekeeper/client';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { GetStatusResult, IndexExportRequest, IndexExportResponse, Operation } from '@mdip/gatekeeper/types';
import { createImportPipeline, type ImportPipelineOptions } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import { createOrderedCatchupCoordinator } from '../../services/mediators/hyperswarm/src/ordered-catchup-coordinator.ts';
import type { ConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { createBulkWorkScheduler } from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';
import TestHelper from '../gatekeeper/helper.ts';

const unsignedOperation: Operation = {
    type: 'create', created: '2026-01-01T00:00:00.000Z',
    mdip: { version: 1, type: 'agent', registry: 'hyperswarm' },
};
const operation: Operation = {
    ...unsignedOperation,
    signature: {
        signed: unsignedOperation.created!,
        hash: new CipherNode().hashJSON(unsignedOperation),
        value: 'signature',
    },
};
const request = { kind: 'remote' as const, name: 'peer', data: [operation] };
function makeOperations(count: number): Operation[] {
    const cipher = new CipherNode();
    return Array.from({ length: count }, (_, index) => {
        const unsigned: Operation = { ...operation, created: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z` };
        delete unsigned.signature;
        return { ...unsigned, signature: { ...operation.signature!, hash: cipher.hashJSON(unsigned) } };
    });
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
const status = (active: boolean): GetStatusResult => ({
    uptimeSeconds: 0, memoryUsage: process.memoryUsage(),
    eventsQueue: { staged: 0, pending: 17, processing: active ? 1 : 0, total: 17, active },
});

function fixture() {
    let epoch = 'epoch-a';
    const store = new InMemoryOperationSyncStore();
    const gatekeeper = {
        isReady: jest.fn(async () => true),
        importBatch: jest.fn<ImportPipelineOptions['gatekeeper']['importBatch']>(async () => ({
            queued: 1, processed: 0, rejected: 0, total: 1, rejectedIndices: [],
        })),
        processEvents: jest.fn<ImportPipelineOptions['gatekeeper']['processEvents']>(async () => ({
            added: 0, merged: 0, rejected: 0, pending: 17, acceptedHashes: [], acceptedEvents: [],
        })),
        getStatus: jest.fn<ImportPipelineOptions['gatekeeper']['getStatus']>(async () => status(false)),
        exportIndex: jest.fn(async (input: IndexExportRequest): Promise<IndexExportResponse> => ({
            mode: input.mode, indexEpoch: epoch, cursor: '0', checkpointCursor: '0', hasMore: false,
            dids: [], blocks: [], ...(input.mode === 'changes' && { operations: [] }),
        })),
    };
    const pipeline = createImportPipeline({
        gatekeeper, syncStore: store, cipher: new CipherNode(), syncStats: createMediatorSyncStats(),
        retryDelayMs: 300_000,
        beginStoreMutation: () => () => {}, onStoreChanged() {},
    });
    return { pipeline, gatekeeper, store, reset() { epoch = 'epoch-b'; } };
}

describe('Gatekeeper processing recovery', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
    afterEach(() => jest.useRealTimers());

    it('adds no status probes to a successful import', async () => {
        const { pipeline, gatekeeper } = fixture();
        try {
            await expect(pipeline.enqueue(request)).resolves.toMatchObject({ retryable: false, persistedIds: [] });
            expect(gatekeeper.getStatus).not.toHaveBeenCalled();
            expect(pipeline.available).toBe(true);
        } finally { await pipeline.shutdown(); }
    });

    it('recovers a later processing page without readmitting accepted, pending or capacity-deferred operations', async () => {
        const { pipeline, gatekeeper, store } = fixture();
        const [accepted, pending, refused] = makeOperations(3);
        await pipeline.refreshIndex('startup');
        gatekeeper.importBatch.mockResolvedValueOnce({
            queued: 2, processed: 0, rejected: 0, total: 2, rejectedIndices: [],
            capacityDeferred: 1, capacityDeferredIndices: [2], processedIndices: [],
        });
        gatekeeper.processEvents.mockResolvedValueOnce({
            added: 1, acceptedHashes: [accepted.signature!.hash], hasMore: true,
        }).mockRejectedValueOnce('timeout of 60000ms exceeded').mockResolvedValueOnce({
            pending: 1, hasMore: false,
        });
        gatekeeper.getStatus.mockResolvedValueOnce(status(true));
        const data = [accepted, pending, refused];
        const importing = pipeline.enqueue({ ...request, data });
        try {
            await nextTurn();
            expect(await store.has(accepted.signature!.hash)).toBe(true);
            expect(pipeline.recovering).toBe(true);
            await jest.advanceTimersByTimeAsync(1_000);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(2);
            await jest.advanceTimersByTimeAsync(2_000);
            await expect(importing).resolves.toMatchObject({
                persistedIds: [accepted.signature!.hash], pendingIds: [pending.signature!.hash],
                capacityDeferredIds: [refused.signature!.hash], retryable: false, indexRefreshRequired: true,
            });
            expect(gatekeeper.processEvents.mock.calls).toEqual([['epoch-a'], ['epoch-a'], ['epoch-a']]);
            await expect(pipeline.enqueue({ ...request, data })).resolves.toMatchObject({
                knownIds: [accepted.signature!.hash], pendingIds: [pending.signature!.hash],
                capacityDeferredIds: [refused.signature!.hash], persistedIds: [], retryable: false,
            });
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(3);
            expect(await store.count()).toBe(1);
        } finally { await pipeline.shutdown(); }
    });

    it('keeps later-page recovery in the original epoch and clears capacity delays after reset', async () => {
        const { pipeline, gatekeeper, reset } = fixture();
        const [refused, accepted] = makeOperations(2);
        await pipeline.refreshIndex('startup');
        gatekeeper.importBatch.mockResolvedValueOnce({
            queued: 0, processed: 0, rejected: 0, total: 0, rejectedIndices: [],
            capacityDeferred: 1, capacityDeferredIndices: [0], processedIndices: [],
        });
        await expect(pipeline.enqueue({ ...request, data: [refused] })).resolves.toMatchObject({
            capacityDeferredIds: [refused.signature!.hash],
        });
        gatekeeper.processEvents.mockResolvedValueOnce({
            added: 1, acceptedHashes: [accepted.signature!.hash], hasMore: true,
        }).mockResolvedValueOnce({ busy: true }).mockRejectedValueOnce({ error: 'gatekeeper_index_epoch_changed' });
        const importing = pipeline.enqueue({ ...request, data: [accepted] });
        try {
            await nextTurn();
            reset();
            await jest.advanceTimersByTimeAsync(1_000);
            await expect(importing).resolves.toMatchObject({ retryable: true, indexEpochChanged: true });
            expect(gatekeeper.processEvents.mock.calls.slice(1)).toEqual([['epoch-a'], ['epoch-a'], ['epoch-a']]);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(2);
            await jest.advanceTimersByTimeAsync(5_000);
            await pipeline.refreshIndex('new-epoch');
            expect(pipeline.indexEpoch).toBe('epoch-b');
            await pipeline.enqueue({ ...request, data: [refused] });
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(3);
            expect(gatekeeper.importBatch.mock.calls.at(-1)?.[1]).toBe('epoch-b');
        } finally { await pipeline.shutdown(); }
    });

    it.each(['code', 'error'] as const)('recovers when reset interrupts an owed processing drain using %s', async field => {
        const { pipeline, gatekeeper, reset } = fixture();
        await pipeline.refreshIndex('startup');
        gatekeeper.processEvents.mockRejectedValueOnce('timeout of 60000ms exceeded');
        gatekeeper.getStatus.mockRejectedValue(new Error('status unavailable'));
        try {
            const importing = pipeline.enqueue(request);
            await nextTurn();
            await jest.advanceTimersByTimeAsync(300_000);
            await expect(importing).resolves.toMatchObject({ retryable: true, dependencyUnavailable: true });
            gatekeeper.getStatus.mockResolvedValue(status(false));
            await jest.advanceTimersByTimeAsync(5_000);
            const failure = { [field]: 'gatekeeper_index_epoch_changed' };
            gatekeeper.processEvents.mockRejectedValueOnce(failure);
            await expect(pipeline.refreshIndex('interrupted-drain')).rejects.toThrow();
            expect(pipeline.available).toBe(false);
            expect(gatekeeper.processEvents.mock.calls.at(-1)?.[0]).toBe('epoch-a');
            reset();
            await jest.advanceTimersByTimeAsync(5_000);
            await expect(pipeline.refreshIndex('new-epoch')).resolves.toMatchObject({
                resetReason: 'gatekeeper_index_epoch_changed',
            });
            expect(pipeline.indexEpoch).toBe('epoch-b');
            expect(pipeline.available).toBe(true);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
        } finally { await pipeline.shutdown(); }
    });

    it('cancels recovery on a later page before admitting the next bounded chunk', async () => {
        const { pipeline, gatekeeper, store } = fixture();
        const data = makeOperations(101);
        gatekeeper.importBatch.mockResolvedValueOnce({
            queued: 100, processed: 0, rejected: 0, total: 100, rejectedIndices: [],
        });
        gatekeeper.processEvents.mockResolvedValueOnce({
            added: 1, acceptedHashes: [data[0].signature!.hash], hasMore: true,
        }).mockResolvedValueOnce({ busy: true });
        const onComplete = jest.fn();
        const importing = pipeline.enqueue({ ...request, data }, onComplete);
        try {
            await nextTurn();
            expect(pipeline.recovering).toBe(true);
            await pipeline.shutdown();
            await expect(importing).resolves.toMatchObject({ retryable: true });
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.importBatch.mock.calls[0][0]).toHaveLength(100);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(2);
            expect(gatekeeper.getStatus).not.toHaveBeenCalled();
            expect(await store.has(data[0].signature!.hash)).toBe(true);
        } finally { await pipeline.shutdown(); }
    });

    it('drains shared staged work after a lost later-page response even when the requested operations are already known', async () => {
        const cipher = new CipherNode();
        const db = new DbJsonMemory('paged-processing-recovery');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const helper = new TestHelper(gatekeeper, cipher);
        const operations = await Promise.all(Array.from({ length: 3 }, () =>
            helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' })));
        const store = new InMemoryOperationSyncStore();
        const queueState = gatekeeper as unknown as { stagedEvents: Array<{ bytes: number }>; maxEventPageBytes: number };
        const importBatch = jest.fn<ImportPipelineOptions['gatekeeper']['importBatch']>(async (...args) => {
            const result = await gatekeeper.importBatch(...args);
            queueState.maxEventPageBytes = Math.max(...queueState.stagedEvents.map(entry => entry.bytes));
            return result;
        });
        let calls = 0;
        const processEvents = jest.fn<ImportPipelineOptions['gatekeeper']['processEvents']>(async expectedEpoch => {
            calls += 1;
            if (calls === 2) {
                await gatekeeper.importBatch([{
                    registry: 'hyperswarm', time: operations[2].created!, ordinal: [Date.now(), 0], operation: operations[2],
                }]);
            }
            const result = await gatekeeper.processEvents(expectedEpoch);
            if (calls === 2) {
                expect(result.hasMore).toBe(true);
                throw 'timeout of 60000ms exceeded';
            }
            return result;
        });
        let offline = true;
        const pipeline = createImportPipeline({
            gatekeeper: {
                isReady: async () => true, importBatch, processEvents,
                getStatus: async () => {
                    if (offline) throw new Error('status unavailable');
                    return { ...status(false), eventsQueue: gatekeeper.getQueueStatus() };
                },
                exportIndex: async input => input.mode === 'snapshot'
                    ? db.exportIndexSnapshot(input) : db.exportIndexChanges(input),
            },
            syncStore: store, cipher, syncStats: createMediatorSyncStats(), retryDelayMs: 300_000,
            beginStoreMutation: () => () => {}, onStoreChanged() {},
        });
        try {
            await pipeline.refreshIndex('startup');
            const epoch = pipeline.indexEpoch;
            const importing = pipeline.enqueue({ ...request, data: operations.slice(0, 2) });
            await nextTurn();
            await jest.advanceTimersByTimeAsync(300_000);
            await expect(importing).resolves.toMatchObject({ retryable: true, dependencyUnavailable: true });
            expect(gatekeeper.getQueueStatus()).toMatchObject({ staged: 1, processing: 0, active: false });
            expect(await store.has(operations[0].signature!.hash)).toBe(true);
            expect(await store.has(operations[1].signature!.hash)).toBe(false);
            offline = false;
            await jest.advanceTimersByTimeAsync(5_000);
            await pipeline.refreshIndex('resume-and-drain');
            expect(gatekeeper.getQueueStatus().total).toBe(0);
            expect(await store.count()).toBe(3);
            expect(await gatekeeper.getDIDs()).toHaveLength(3);
            expect(pipeline.available).toBe(true);
            expect(processEvents.mock.calls).toEqual([[epoch], [epoch], [epoch]]);
            expect(importBatch).toHaveBeenCalledTimes(1);
        } finally { await pipeline.shutdown(); }
    });

    it.each(['busy', 'timeout'])('waits after %s without readmitting the page or racing another processor', async kind => {
        const { pipeline, gatekeeper } = fixture();
        if (kind === 'busy') gatekeeper.processEvents.mockResolvedValueOnce({ busy: true });
        else gatekeeper.processEvents.mockRejectedValueOnce('timeout of 60000ms exceeded');
        gatekeeper.getStatus.mockResolvedValueOnce(status(true));
        const first = pipeline.enqueue(request);
        const second = pipeline.enqueue(request);
        try {
            await nextTurn();
            expect(pipeline.recovering).toBe(true);
            expect(pipeline.available).toBe(false);
            await jest.advanceTimersByTimeAsync(1_000);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(2_000);
            await expect(first).resolves.toMatchObject({ retryable: false });
            await expect(second).resolves.toMatchObject({ retryable: false });
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(2);
            expect(gatekeeper.getStatus).toHaveBeenCalledTimes(2);
            expect(gatekeeper.getStatus).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5_000, maxResponseBytes: 65_536 }));
            const recoveryLogs = jest.mocked(logger.child).mock.results.flatMap(child => jest.mocked((child.value as typeof logger).info).mock.calls);
            expect(recoveryLogs).toContainEqual([
                expect.objectContaining({ eventsQueue: status(false).eventsQueue }), 'Gatekeeper processing recovered',
            ]);
            expect(pipeline.available).toBe(true);
        } finally { await pipeline.shutdown(); }
    });

    it('does not mistake failed or malformed probes for an idle processor', async () => {
        const { pipeline, gatekeeper } = fixture();
        gatekeeper.processEvents.mockResolvedValueOnce({ busy: true });
        gatekeeper.getStatus.mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({} as GetStatusResult)
            .mockResolvedValueOnce({ eventsQueue: { active: 'false' } } as unknown as GetStatusResult);
        const pending = pipeline.enqueue(request);
        try {
            await nextTurn();
            await jest.advanceTimersByTimeAsync(7_000);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(5_000);
            await expect(pending).resolves.toMatchObject({ retryable: false });
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(2);
        } finally { await pipeline.shutdown(); }
    });

    it('bounds the wait and keeps all admissions paused until an idle status and successful export', async () => {
        const { pipeline, gatekeeper } = fixture();
        gatekeeper.processEvents.mockResolvedValue({ busy: true });
        gatekeeper.getStatus.mockResolvedValue(status(true));
        const first = pipeline.enqueue(request);
        const queued = pipeline.enqueue(request);
        try {
            await nextTurn();
            await jest.advanceTimersByTimeAsync(300_000);
            for (const pending of [first, queued, pipeline.enqueue(request)]) {
                await expect(pending).resolves.toMatchObject({ retryable: true, dependencyUnavailable: true });
            }
            expect(pipeline.available).toBe(false);
            expect(pipeline.recovering).toBe(false);
            const outageLogs = jest.mocked(logger.child).mock.results.flatMap(child => jest.mocked((child.value as typeof logger).warn).mock.calls);
            expect(outageLogs).toContainEqual([
                expect.objectContaining({ eventsQueue: status(true).eventsQueue }),
                'Gatekeeper processing recovery interrupted, imports paused until index refresh',
            ]);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(1);
            await expect(pipeline.refreshIndex('still-busy')).rejects.toThrow('processing is unavailable');
            expect(gatekeeper.exportIndex).not.toHaveBeenCalled();
            const probes = gatekeeper.getStatus.mock.calls.length;
            await expect(pipeline.refreshIndex('backoff')).rejects.toThrow('processing is unavailable');
            expect(gatekeeper.getStatus).toHaveBeenCalledTimes(probes);
            gatekeeper.getStatus.mockResolvedValue(status(false));
            gatekeeper.processEvents.mockResolvedValue({ hasMore: false, pending: 17 });
            gatekeeper.exportIndex.mockRejectedValueOnce(new Error('export failed'));
            await jest.advanceTimersByTimeAsync(5_000);
            await expect(pipeline.refreshIndex('failed-export')).rejects.toThrow('export failed');
            expect(pipeline.available).toBe(false);
            await jest.advanceTimersByTimeAsync(5_000);
            await pipeline.refreshIndex('recovered');
            expect(pipeline.available).toBe(true);
        } finally { await pipeline.shutdown(); }
    });

    it('does not extend its retry budget for racing busy replies', async () => {
        const { pipeline, gatekeeper } = fixture();
        gatekeeper.processEvents.mockResolvedValue({ busy: true });
        const pending = pipeline.enqueue(request);
        try {
            await nextTurn();
            await jest.advanceTimersByTimeAsync(300_000);
            await expect(pending).resolves.toMatchObject({ dependencyUnavailable: true });
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.processEvents.mock.calls.length).toBeGreaterThan(1);
        } finally { await pipeline.shutdown(); }
    });

    it.each(['status', 'processing'] as const)('stops when the recovery budget expires during a %s request', async phase => {
        const { pipeline, gatekeeper } = fixture();
        const startedAt = Date.now();
        gatekeeper.processEvents.mockImplementation(async () => {
            if (phase === 'processing' && Date.now() - startedAt >= 297_000) {
                jest.setSystemTime(startedAt + 300_001);
            }
            return { busy: true };
        });
        gatekeeper.getStatus.mockImplementation(async () => {
            const nearDeadline = Date.now() - startedAt >= 297_000;
            if (nearDeadline && phase === 'status') jest.setSystemTime(startedAt + 300_001);
            return status(!nearDeadline);
        });
        const pending = pipeline.enqueue(request);
        try {
            await nextTurn();
            await jest.advanceTimersByTimeAsync(297_000);
            await expect(pending).resolves.toMatchObject({ retryable: true, dependencyUnavailable: true });
            expect(pipeline.available).toBe(false);
            expect(pipeline.recovering).toBe(false);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(phase === 'status' ? 1 : 2);
        } finally { await pipeline.shutdown(); }
    });

    it.each([new Error('disk failure'), { error: 'forbidden', status: 403 }, 'connection refused'])(
        'preserves non-timeout processing failures: %s', async error => {
            const { pipeline, gatekeeper } = fixture();
            gatekeeper.processEvents.mockRejectedValueOnce(error);
            try {
                await expect(pipeline.enqueue(request)).resolves.toMatchObject({ retryable: true });
                expect(gatekeeper.getStatus).not.toHaveBeenCalled();
                expect(pipeline.available).toBe(true);
            } finally { await pipeline.shutdown(); }
        },
    );

    it('preserves the original epoch when reset interrupts recovery', async () => {
        const { pipeline, gatekeeper, reset } = fixture();
        await pipeline.refreshIndex('startup');
        gatekeeper.processEvents.mockResolvedValueOnce({ busy: true })
            .mockRejectedValueOnce({ error: 'gatekeeper_index_epoch_changed' });
        const pending = pipeline.enqueue(request);
        try {
            await nextTurn();
            reset();
            await jest.advanceTimersByTimeAsync(1_000);
            await expect(pending).resolves.toMatchObject({ retryable: true, indexEpochChanged: true });
            expect(gatekeeper.processEvents.mock.calls).toEqual([['epoch-a'], ['epoch-a']]);
            expect(pipeline.available).toBe(false);
            await jest.advanceTimersByTimeAsync(5_000);
            await pipeline.refreshIndex('reset');
            expect(pipeline.indexEpoch).toBe('epoch-b');
            expect(pipeline.available).toBe(true);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
        } finally { await pipeline.shutdown(); }
    });

    it('interrupts recovery sleep during shutdown and settles queued callbacks once', async () => {
        const { pipeline, gatekeeper } = fixture();
        gatekeeper.processEvents.mockResolvedValue({ busy: true });
        const onComplete = jest.fn();
        const pending = pipeline.enqueue(request, onComplete);
        try {
            await nextTurn();
            await pipeline.shutdown();
            await expect(pending).resolves.toMatchObject({ retryable: true });
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(gatekeeper.getStatus).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(600_000);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(1);
        } finally { await pipeline.shutdown(); }
    });

    it('cancels an in-flight recovery probe on shutdown', async () => {
        const { pipeline, gatekeeper } = fixture();
        gatekeeper.processEvents.mockResolvedValue({ busy: true });
        gatekeeper.getStatus.mockImplementationOnce(options => new Promise((_resolve, reject) => {
            options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
        }));
        const pending = pipeline.enqueue(request);
        try {
            await nextTurn();
            await jest.advanceTimersByTimeAsync(1_000);
            expect(gatekeeper.getStatus).toHaveBeenCalledTimes(1);
            await pipeline.shutdown();
            await expect(pending).resolves.toMatchObject({ retryable: true });
        } finally { await pipeline.shutdown(); }
    });

    it('keeps the ordered session alive while its local import recovers and resumes prefetch', async () => {
        const { pipeline, gatekeeper } = fixture();
        const [orderedOperation] = makeOperations(1);
        await pipeline.refreshIndex('startup');
        gatekeeper.processEvents.mockRejectedValueOnce('timeout of 60000ms exceeded');
        gatekeeper.getStatus.mockResolvedValue(status(true));
        const onFailure = jest.fn(async () => {});
        const sendToPeer = jest.fn(() => true);
        const coordinator = createOrderedCatchupCoordinator({
            maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024, idleTimeoutMs: 120_000,
            syncStore: new InMemoryOperationSyncStore(), importPipeline: pipeline,
            syncStats: createMediatorSyncStats(), cipher: new CipherNode(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: () => ({} as ConnectionInfo), createSessionId: () => 'session',
            createBaseMessage: type => ({ type }), sendToPeer,
            sendBulkToPeer: async () => sendToPeer(),
            onFailure, onIndexRefreshed: async () => {}, onComplete: async () => false, onHandoffDeferred: async () => {},
            onProtocolViolation: jest.fn(),
        });
        try {
            expect(coordinator.startClient('peer', 'empty', 100_000)).toBe(true);
            await coordinator.handleMessage('peer', {
                type: 'ordered_catchup_push', sessionId: 'session',
                data: [orderedOperation], cursor: { syncOrder: 1, id: orderedOperation.signature!.hash }, hasMore: true,
            });
            await nextTurn();
            const sent = sendToPeer.mock.calls.length;
            // An already requested prefetched page may arrive while the worker waits.
            await coordinator.handleMessage('peer', {
                type: 'ordered_catchup_push', sessionId: 'session',
                data: [orderedOperation], cursor: { syncOrder: 2, id: orderedOperation.signature!.hash }, hasMore: true,
            });
            await jest.advanceTimersByTimeAsync(121_000);
            coordinator.expire();
            expect(onFailure).not.toHaveBeenCalled();
            expect(coordinator.hasActiveOutbound()).toBe(true);
            expect(sendToPeer).toHaveBeenCalledTimes(sent);
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
            gatekeeper.getStatus.mockResolvedValue(status(false));
            await jest.advanceTimersByTimeAsync(5_000);
            await pipeline.waitForIdle();
            expect(coordinator.hasActiveOutbound()).toBe(true);
            expect(onFailure).not.toHaveBeenCalled();
            expect(sendToPeer.mock.calls.length).toBeGreaterThan(sent);
        } finally {
            await pipeline.shutdown();
            await coordinator.shutdown();
        }
    });

    it('gives the ordered page its normal idle grace while a recovered result is being persisted', async () => {
        const { pipeline, gatekeeper, store } = fixture();
        const [orderedOperation] = makeOperations(1);
        await pipeline.refreshIndex('startup');
        gatekeeper.processEvents.mockResolvedValueOnce({ busy: true }).mockResolvedValue({
            added: 1, merged: 0, rejected: 0, pending: 0,
            acceptedHashes: [orderedOperation.signature!.hash], acceptedEvents: [],
        });
        gatekeeper.getStatus.mockResolvedValue(status(true));
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let markWriteStarted!: () => void;
        const writeStarted = new Promise<void>(resolve => { markWriteStarted = resolve; });
        const upsertMany = store.upsertMany.bind(store);
        jest.spyOn(store, 'upsertMany').mockImplementationOnce(async rows => {
            markWriteStarted();
            await blocked;
            return upsertMany(rows);
        });
        const onFailure = jest.fn(async () => {});
        const coordinator = createOrderedCatchupCoordinator({
            maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024, idleTimeoutMs: 120_000,
            syncStore: store, importPipeline: pipeline, syncStats: createMediatorSyncStats(), cipher: new CipherNode(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: () => ({} as ConnectionInfo), createSessionId: () => 'session',
            createBaseMessage: type => ({ type }), sendToPeer: () => true,
            sendBulkToPeer: async () => true,
            onFailure, onIndexRefreshed: async () => {}, onComplete: async () => false, onHandoffDeferred: async () => {},
            onProtocolViolation: jest.fn(),
        });
        try {
            expect(coordinator.startClient('peer', 'empty', 100_000)).toBe(true);
            await coordinator.handleMessage('peer', {
                type: 'ordered_catchup_push', sessionId: 'session',
                data: [orderedOperation], cursor: { syncOrder: 1, id: orderedOperation.signature!.hash }, hasMore: true,
            });
            await nextTurn();
            await jest.advanceTimersByTimeAsync(121_000);
            coordinator.expire();
            gatekeeper.getStatus.mockResolvedValue(status(false));
            await jest.advanceTimersByTimeAsync(5_000);
            await writeStarted;
            expect(pipeline.recovering).toBe(false);
            coordinator.expire();
            expect(onFailure).not.toHaveBeenCalled();
            expect(coordinator.hasActiveOutbound()).toBe(true);
            release();
            await pipeline.waitForIdle();
            expect(await store.has(orderedOperation.signature!.hash)).toBe(true);
        } finally {
            release();
            await pipeline.shutdown();
            await coordinator.shutdown();
        }
    });
});

describe('real Gatekeeper HTTP processing timeout', () => {
    it('recovers accepted inventory when the original request commits after its client timed out', async () => {
        const cipher = new CipherNode();
        const db = new DbJsonMemory('http-processing-recovery');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const helper = new TestHelper(gatekeeper, cipher);
        const signed = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const original = gatekeeper.importEvent.bind(gatekeeper);
        jest.spyOn(gatekeeper, 'importEvent').mockImplementationOnce(async (...args) => {
            await blocked;
            return original(...args);
        });
        const work: Promise<unknown>[] = [];
        const server = http.createServer((_req, response) => {
            const task = gatekeeper.processEvents().then(result => {
                if (!response.destroyed) response.end(JSON.stringify(result));
            });
            work.push(task);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const client = await GatekeeperClient.create({
            url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 50,
        });
        const store = new InMemoryOperationSyncStore();
        const importBatch = jest.fn(gatekeeper.importBatch.bind(gatekeeper));
        const processEvents = jest.fn(client.processEvents.bind(client));
        let markProbe!: () => void;
        const probeStarted = new Promise<void>(resolve => { markProbe = resolve; });
        const pipeline = createImportPipeline({
            gatekeeper: {
                isReady: async () => true, importBatch, processEvents,
                getStatus: async () => {
                    const result = { ...status(false), eventsQueue: gatekeeper.getQueueStatus() };
                    markProbe();
                    return result;
                },
                exportIndex: async input => input.mode === 'snapshot'
                    ? db.exportIndexSnapshot(input) : db.exportIndexChanges(input),
            },
            syncStore: store, cipher, syncStats: createMediatorSyncStats(),
            retryDelayMs: 300_000,
            beginStoreMutation: () => () => {}, onStoreChanged() {},
        });
        try {
            await pipeline.refreshIndex('startup');
            const pending = pipeline.enqueue({ ...request, data: [signed] });
            await probeStarted;
            expect(gatekeeper.getQueueStatus().active).toBe(true);
            expect(importBatch).toHaveBeenCalledTimes(1);
            expect(processEvents).toHaveBeenCalledTimes(1);
            release();
            await Promise.all(work);
            await expect(pending).resolves.toMatchObject({ retryable: false, persistedIds: [] });
            expect(gatekeeper.getQueueStatus().active).toBe(false);
            await pipeline.refreshIndex('recover-lost-response');
            expect(await store.has(signed.signature!.hash)).toBe(true);
            await pipeline.enqueue({ ...request, data: [signed] });
            expect(importBatch).toHaveBeenCalledTimes(1);
            expect(await store.count()).toBe(1);
        } finally {
            release();
            await pipeline.shutdown();
            await Promise.allSettled(work);
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
