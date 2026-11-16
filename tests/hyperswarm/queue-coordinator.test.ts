import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';

import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import type { QueueMessage } from '../../services/mediators/hyperswarm/src/protocol-messages.ts';
import { createQueueCoordinator as createQueueCoordinatorImpl } from '../../services/mediators/hyperswarm/src/queue-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';
import { createBulkWorkScheduler } from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';

type QueueCoordinatorOptions = Parameters<typeof createQueueCoordinatorImpl>[0];

function createQueueCoordinator(
    options: Omit<QueueCoordinatorOptions, 'bulkReads' | 'operationPages'>
    & Partial<Pick<QueueCoordinatorOptions, 'bulkReads' | 'operationPages'>>,
) {
    return createQueueCoordinatorImpl({
        bulkReads: createBulkWorkScheduler(2),
        operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
        ...options,
    });
}

function makeOperation(created = '2026-08-01T12:00:00.000Z'): { cipher: CipherNode; operation: Operation } {
    const cipher = new CipherNode();
    const unsigned = {
        type: 'create' as const,
        created,
        mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
    };
    return {
        cipher,
        operation: {
            ...unsigned,
            signature: {
                signed: unsigned.created,
                hash: cipher.hashJSON(unsigned),
                value: 'signature',
            },
        } as Operation,
    };
}

describe('queue coordinator', () => {
    const connection = {} as ConnectionInfo;

    it('does not clear or relay the publication queue if processing pauses while persistence finishes', async () => {
        let available = true;
        const operation = { signature: { hash: 'operation-hash' } } as Operation;
        const enqueue = jest.fn(async () => {
            available = false;
            return { knownIds: [], persistedIds: ['operation-hash'], retryable: false };
        });
        const clearQueue = jest.fn(async () => true);
        const relay = jest.fn(async () => {});
        const pipeline = { get available() { return available; }, enqueue } as unknown as ImportPipeline;
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm', maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024,
            gatekeeper: { getQueue: async () => [operation], clearQueue },
            cipher: { hashJSON: () => 'batch-hash' } as Pick<CipherNode, 'hashJSON'>,
            syncStats: createMediatorSyncStats(), getImportPipeline: () => pipeline,
            getNodeKey: () => 'local', createQueueMessage: () => ({ type: 'queue', time: '', node: '', relays: [] }), relay,
            onProtocolViolation: jest.fn(),
        });
        await coordinator.flush();
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(clearQueue).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });

    it('leaves gossip unseen and the publication queue intact while processing is paused', async () => {
        let available = false;
        const { cipher, operation } = makeOperation();
        const enqueue = jest.fn(async () => ({
            knownIds: [], persistedIds: [operation.signature!.hash], pendingIds: [], capacityDeferredIds: [], retryable: false,
        }));
        const getQueue = jest.fn(async () => []);
        const clearQueue = jest.fn(async () => true);
        const relay = jest.fn(async () => {});
        const onProtocolViolation = jest.fn();
        const pipeline = { get available() { return available; }, enqueue } as unknown as ImportPipeline;
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm', maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024,
            gatekeeper: { getQueue, clearQueue },
            cipher,
            syncStats: createMediatorSyncStats(), getImportPipeline: () => pipeline,
            getNodeKey: () => 'local', createQueueMessage: () => ({ type: 'queue', time: '', node: '', relays: [] }), relay,
            onProtocolViolation,
        });
        const message = { type: 'queue' as const, time: '', node: '', relays: [], data: [operation] };
        const malformed = {
            ...message,
            data: [{
                ...operation,
                signature: { ...operation.signature!, hash: 'f'.repeat(64) },
            }],
        };
        await coordinator.handleMessage('peer', malformed, connection);
        await coordinator.handleMessage('peer', message, connection);
        await coordinator.flush();
        expect(onProtocolViolation).toHaveBeenCalledTimes(1);
        expect(enqueue).not.toHaveBeenCalled();
        expect(getQueue).not.toHaveBeenCalled();
        expect(clearQueue).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
        available = true;
        await coordinator.handleMessage('peer', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledTimes(1);
    });

    it.each([
        { name: 'HTTP epoch conflict', error: { error: 'gatekeeper_index_epoch_changed' }, reset: true },
        { name: 'direct epoch conflict', error: { code: 'gatekeeper_index_epoch_changed' }, reset: true },
        { name: 'storage failure', error: new Error('storage unavailable'), reset: false },
        { name: 'missing error body', error: null, reset: false },
    ])('handles $name while clearing the publication queue', async ({ error, reset }) => {
        const operation = { signature: { hash: 'operation-hash' } } as Operation;
        const enqueue = jest.fn(async () => ({ knownIds: [], persistedIds: [], retryable: false }));
        const clearQueue = jest.fn(async () => { throw error; });
        const relay = jest.fn(async () => {});
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: { getQueue: jest.fn(async () => [operation]), clearQueue },
            cipher: { hashJSON: () => 'batch-hash' } as Pick<CipherNode, 'hashJSON'>,
            syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ available: true, recovering: false, indexEpoch: 'old-epoch', enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });

        if (reset) await expect(coordinator.flush()).resolves.toBeUndefined();
        else await expect(coordinator.flush()).rejects.toBe(error);
        expect(clearQueue).toHaveBeenCalledWith('hyperswarm', ['operation-hash'], 'old-epoch');
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(relay).not.toHaveBeenCalled();
    });

    it.each(['persist', 'merge'] as const)('treats an old-epoch %s result as reset recovery', async phase => {
        const operation = { signature: { hash: 'operation-hash' } } as Operation;
        const enqueue = jest.fn(async (request: { phase?: string }) => ({
            knownIds: [], persistedIds: [],
            retryable: request.phase === phase,
            indexEpochChanged: request.phase === phase,
        }));
        const clearQueue = jest.fn(async () => true);
        const relay = jest.fn(async () => {});
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: { getQueue: jest.fn(async () => [operation]), clearQueue },
            cipher: { hashJSON: () => 'batch-hash' } as Pick<CipherNode, 'hashJSON'>,
            syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ available: true, recovering: false, indexEpoch: 'old-epoch', enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });

        await expect(coordinator.flush()).resolves.toBeUndefined();
        expect(enqueue).toHaveBeenCalledTimes(phase === 'persist' ? 1 : 2);
        expect(clearQueue).not.toHaveBeenCalled();
        expect(relay).not.toHaveBeenCalled();
    });
    it('suppresses duplicate gossip and preserves local flush ordering', async () => {
        const { cipher, operation } = makeOperation();
        const order: string[] = [];
        const enqueue = jest.fn(async (request: { phase?: string }) => {
            order.push(request.phase ?? 'remote');
            return {
                knownIds: [],
                persistedIds: [operation.signature!.hash],
                pendingIds: [],
                capacityDeferredIds: [],
                retryable: false,
            };
        });
        const clearQueue = jest.fn(async () => { order.push('clear'); });
        const relay = jest.fn(async () => { order.push('relay'); });
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => [operation]),
                clearQueue,
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ available: true, recovering: false, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({
                type: 'queue', time: '', node: 'local', relays: [],
            }),
            relay,
            onProtocolViolation: jest.fn(),
        });
        const message = {
            type: 'queue' as const,
            time: '',
            node: 'peer',
            relays: [],
            data: [operation],
        };

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.handleMessage('peer-key', { ...message, relays: [] }, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledTimes(1);

        order.length = 0;
        await coordinator.flush();
        expect(order).toEqual(['persist', 'merge', 'clear', 'relay']);
    });

    it('does not relay incomplete gossip and permits later repair', async () => {
        const { cipher, operation } = makeOperation();
        let attempt = 0;
        const enqueue = jest.fn(async () => {
            attempt += 1;
            return attempt === 1 ? {
                knownIds: [], persistedIds: [], pendingIds: [operation.signature!.hash],
                capacityDeferredIds: [], retryable: false,
            } : {
                knownIds: [], persistedIds: [operation.signature!.hash], pendingIds: [],
                capacityDeferredIds: [], retryable: false,
            };
        });
        const relay = jest.fn(async (_message: QueueMessage) => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ available: true, recovering: false, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        await coordinator.handleMessage('peer-key', message, connection);
        expect(relay).not.toHaveBeenCalled();
        await coordinator.handleMessage('peer-key', { ...message, relays: [] }, connection);
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(relay).toHaveBeenCalledTimes(1);
    });

    it('drops gossip on local page pressure without penalizing the peer and permits retry', async () => {
        const { cipher, operation } = makeOperation();
        const operationPages = createOperationPageBudget(1, 512 * 1024);
        const held = operationPages.reserve(1)!;
        const enqueue = jest.fn(async () => ({
            knownIds: [],
            persistedIds: [operation.signature!.hash],
            pendingIds: [],
            capacityDeferredIds: [],
            retryable: false,
        }));
        const relay = jest.fn(async () => undefined);
        const onProtocolViolation = jest.fn();
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages,
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation,
        });
        const message = {
            type: 'queue' as const,
            time: '',
            node: 'peer',
            relays: [],
            data: [operation],
        };

        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).not.toHaveBeenCalled();
        expect(onProtocolViolation).not.toHaveBeenCalled();

        held.release();
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledTimes(1);
        expect(operationPages.pages).toBe(0);
    });

    it('admits at most one active and one waiting gossip batch', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z');
        const third = makeOperation('2026-08-01T12:00:02.000Z');
        const completions: Array<() => void> = [];
        const enqueue = jest.fn((request: { data: Operation[] }) => new Promise(resolve => {
            completions.push(() => resolve({
                knownIds: [],
                persistedIds: request.data.map(operation => operation.signature!.hash),
                pendingIds: [],
                capacityDeferredIds: [],
                retryable: false,
            }));
        }));
        const relay = jest.fn(async () => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        const firstWork = coordinator.handleMessage('first-peer', message(first.operation), connection);
        const secondWork = coordinator.handleMessage('second-peer', message(second.operation), connection);
        await coordinator.handleMessage('third-peer', message(third.operation), connection);
        expect(enqueue).toHaveBeenCalledTimes(2);

        completions[0]();
        await firstWork;
        const thirdWork = coordinator.handleMessage('third-peer', message(third.operation), connection);
        expect(enqueue).toHaveBeenCalledTimes(3);
        completions[1]();
        completions[2]();
        await Promise.all([secondWork, thirdWork]);
        expect(relay).toHaveBeenCalledTimes(3);
    });

    it('keeps forwarded relay hints within the protocol limit', async () => {
        const { cipher, operation } = makeOperation();
        const relay = jest.fn(async (_message: QueueMessage) => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                available: true,
                enqueue: jest.fn(async () => ({
                    knownIds: [],
                    persistedIds: [operation.signature!.hash],
                    pendingIds: [],
                    capacityDeferredIds: [],
                    retryable: false,
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });
        const relays = Array.from({ length: 64 }, (_, index) => index.toString(16).padStart(64, '0'));
        const peerKey = 'f'.repeat(64);

        await coordinator.handleMessage(peerKey, {
            type: 'queue', time: '', node: 'peer', relays, data: [operation],
        }, connection);

        const forwarded = relay.mock.calls[0][0];
        expect(forwarded.relays).toHaveLength(64);
        expect(forwarded.relays).toContain(peerKey);
        expect(forwarded.relays).not.toContain(relays[0]);
    });

    it('rejects malformed gossip and permits retry after an import failure', async () => {
        const { cipher, operation } = makeOperation();
        const enqueue = jest.fn<ImportPipeline['enqueue']>()
            .mockRejectedValueOnce(new Error('import failed'))
            .mockResolvedValueOnce({
                knownIds: [], persistedIds: [operation.signature!.hash], pendingIds: [],
                capacityDeferredIds: [], retryable: false,
            });
        const relay = jest.fn(async () => undefined);
        const onProtocolViolation = jest.fn();
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ available: true, recovering: false, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation,
        });
        const message = {
            type: 'queue', time: '', node: 'peer', data: [operation],
        } as QueueMessage;

        await expect(coordinator.handleMessage('peer-key', {
            ...message,
            data: 'invalid',
        } as unknown as QueueMessage, connection)).resolves.toBeUndefined();
        await expect(coordinator.handleMessage('peer-key', {
            ...message,
            data: [{
                ...operation,
                signature: { ...operation.signature!, hash: 'f'.repeat(64) },
            }],
        }, connection)).resolves.toBeUndefined();
        await expect(coordinator.handleMessage('peer-key', message, connection)).rejects.toThrow('import failed');
        await expect(coordinator.handleMessage('peer-key', message, connection)).resolves.toBeUndefined();

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(onProtocolViolation).toHaveBeenCalledTimes(2);
        expect(relay).toHaveBeenCalledWith(expect.objectContaining({ relays: ['peer-key'] }));
    });

    it('retains a local queue when merging reports backpressure', async () => {
        const { cipher, operation } = makeOperation();
        const enqueue = jest.fn<ImportPipeline['enqueue']>()
            .mockResolvedValueOnce({
                knownIds: [], persistedIds: [operation.signature!.hash], pendingIds: [],
                capacityDeferredIds: [], retryable: false,
            })
            .mockResolvedValueOnce({
                knownIds: [], persistedIds: [], pendingIds: [],
                capacityDeferredIds: [operation.signature!.hash], retryable: false,
            });
        const clearQueue = jest.fn(async () => true);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => [operation]),
                clearQueue,
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ available: true, recovering: false, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });

        await expect(coordinator.flush()).rejects.toThrow('failed to merge local Gatekeeper queue');
        expect(clearQueue).not.toHaveBeenCalled();
    });

    it('leaves the local queue untouched when page capacity is unavailable', async () => {
        const { cipher } = makeOperation();
        const operationPages = createOperationPageBudget(1, 512 * 1024);
        const held = operationPages.reserve(1)!;
        const getQueue = jest.fn(async () => []);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue,
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages,
            getImportPipeline: () => ({ available: true, enqueue: jest.fn() } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });

        await coordinator.flush();
        expect(getQueue).not.toHaveBeenCalled();
        held.release();
        await coordinator.flush();
        expect(getQueue).toHaveBeenCalledTimes(1);
    });

    it('relays a local queue in protocol-bounded pages', async () => {
        const first = makeOperation();
        const secondUnsigned = {
            type: 'create' as const,
            created: '2026-08-01T12:00:01.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
        };
        const second = {
            ...secondUnsigned,
            signature: {
                signed: secondUnsigned.created,
                hash: first.cipher.hashJSON(secondUnsigned),
                value: 'signature',
            },
        } as Operation;
        const batch = [first.operation, second];
        const relay = jest.fn(async (_message: QueueMessage) => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 1,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => batch),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                available: true,
                enqueue: jest.fn(async () => ({
                    knownIds: [],
                    persistedIds: batch.map(operation => operation.signature!.hash),
                    pendingIds: [],
                    capacityDeferredIds: [],
                    retryable: false,
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });

        await coordinator.flush();

        expect(relay).toHaveBeenCalledTimes(2);
        expect(relay.mock.calls.map(([message]) => message.data)).toEqual([
            [first.operation],
            [second],
        ]);
    });
});
