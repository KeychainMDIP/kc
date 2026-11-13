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
import TestHelper from '../gatekeeper/helper.ts';

const operation: Operation = {
    type: 'create', created: '2026-01-01T00:00:00.000Z',
    mdip: { version: 1, type: 'agent', registry: 'hyperswarm' },
    signature: { signed: '2026-01-01T00:00:00.000Z', hash: 'a'.repeat(64), value: 'signature' },
};
const request = { kind: 'remote' as const, name: 'peer', data: [operation] };
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
            expect(gatekeeper.importBatch).toHaveBeenCalledTimes(2);
            expect(gatekeeper.processEvents).toHaveBeenCalledTimes(3);
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
        await pipeline.refreshIndex('startup');
        gatekeeper.processEvents.mockRejectedValueOnce('timeout of 60000ms exceeded');
        gatekeeper.getStatus.mockResolvedValue(status(true));
        const onFailure = jest.fn(async () => {});
        const sendToPeer = jest.fn(() => true);
        const coordinator = createOrderedCatchupCoordinator({
            version: 1, maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024, idleTimeoutMs: 120_000,
            syncStore: new InMemoryOperationSyncStore(), importPipeline: pipeline, syncStats: createMediatorSyncStats(),
            getConnection: () => ({} as ConnectionInfo), createSessionId: () => 'session',
            createBaseMessage: type => ({ type, time: '', node: '', relays: [] }), sendToPeer,
            onFailure, onIndexRefreshed: async () => {}, onComplete: async () => false, onHandoffDeferred: async () => {},
        });
        try {
            expect(coordinator.startClient('peer', 'empty', 100_000)).toBe(true);
            await coordinator.handleMessage('peer', {
                type: 'ordered_catchup_push', sessionId: 'session', time: '', node: '', relays: [],
                data: [operation], cursor: { syncOrder: 1, id: operation.signature!.hash }, hasMore: true,
            });
            await nextTurn();
            const sent = sendToPeer.mock.calls.length;
            // An already requested prefetched page may arrive while the worker waits.
            await coordinator.handleMessage('peer', {
                type: 'ordered_catchup_push', sessionId: 'session', time: '', node: '', relays: [],
                data: [operation], cursor: { syncOrder: 2, id: operation.signature!.hash }, hasMore: true,
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
        await pipeline.refreshIndex('startup');
        gatekeeper.processEvents.mockResolvedValueOnce({ busy: true }).mockResolvedValue({
            added: 1, merged: 0, rejected: 0, pending: 0,
            acceptedHashes: [operation.signature!.hash], acceptedEvents: [],
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
            version: 1, maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024, idleTimeoutMs: 120_000,
            syncStore: store, importPipeline: pipeline, syncStats: createMediatorSyncStats(),
            getConnection: () => ({} as ConnectionInfo), createSessionId: () => 'session',
            createBaseMessage: type => ({ type, time: '', node: '', relays: [] }), sendToPeer: () => true,
            onFailure, onIndexRefreshed: async () => {}, onComplete: async () => false, onHandoffDeferred: async () => {},
        });
        try {
            expect(coordinator.startClient('peer', 'empty', 100_000)).toBe(true);
            await coordinator.handleMessage('peer', {
                type: 'ordered_catchup_push', sessionId: 'session', time: '', node: '', relays: [],
                data: [operation], cursor: { syncOrder: 1, id: operation.signature!.hash }, hasMore: true,
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
            expect(await store.has(operation.signature!.hash)).toBe(true);
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
