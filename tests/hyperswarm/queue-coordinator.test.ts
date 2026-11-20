import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';

import type {
    ImportPipeline,
    ImportQueueResult,
} from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import type { QueueMessage } from '../../services/mediators/hyperswarm/src/protocol-messages.ts';
import { createQueueCoordinator as createQueueCoordinatorImpl } from '../../services/mediators/hyperswarm/src/queue-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';
import { createBulkWorkScheduler } from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';
import { validateQueueMessagePayload } from '../../services/mediators/hyperswarm/src/protocol-validation.ts';

type QueueCoordinatorOptions = Parameters<typeof createQueueCoordinatorImpl>[0];

function createQueueCoordinator(
    options: Omit<QueueCoordinatorOptions,
        'bulkReads' | 'operationPages' | 'repairIntervalMs' | 'getConnection' | 'requestRepair'>
    & Partial<Pick<QueueCoordinatorOptions,
        'bulkReads' | 'operationPages' | 'repairIntervalMs' | 'getConnection' | 'requestRepair'>>,
) {
    const getImportPipeline = options.getImportPipeline;
    const coordinator = createQueueCoordinatorImpl({
        bulkReads: createBulkWorkScheduler(2),
        operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
        repairIntervalMs: 1_000,
        getConnection: () => undefined,
        requestRepair: async () => false,
        ...options,
        getImportPipeline: () => {
            const pipeline = getImportPipeline();
            return pipeline.available === undefined
                ? { ...pipeline, available: true } as ImportPipeline
                : pipeline;
        },
    });
    return {
        ...coordinator,
        handleMessage(peerKey: string, message: QueueMessage, connection: ConnectionInfo) {
            const page = validateQueueMessagePayload(message, {
                maxOpsPerPush: options.maxOpsPerPage,
                maxBytesPerPush: options.maxBytesPerPage,
            });
            if (!page.ok) {
                throw new Error(page.reason);
            }
            return coordinator.handleMessage(peerKey, message, connection, page.value);
        },
    };
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

function importResult(overrides: Partial<ImportQueueResult> = {}): ImportQueueResult {
    return {
        knownIds: [],
        persistedIds: [],
        pendingIds: [],
        capacityDeferredIds: [],
        acceptedOperations: [],
        portableTerminalOperations: [],
        unaddressableOperations: [],
        retryable: false,
        ...overrides,
    };
}

describe('queue coordinator', () => {
    const connection = {} as ConnectionInfo;
    const defaultRepairOptions = () => ({
        repairIntervalMs: 1_000,
        getConnection: () => connection,
        requestRepair: jest.fn(async () => false),
    });

    it('does not clear or relay the publication queue if processing pauses while persistence finishes', async () => {
        let available = true;
        const operation = { signature: { hash: 'operation-hash' } } as Operation;
        const enqueue = jest.fn(async () => {
            available = false;
            return { knownIds: [], persistedIds: ['operation-hash'], retryable: false };
        });
        const clearQueue = jest.fn(async (_registry: string, _page: Operation[]) => true);
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
        const enqueue = jest.fn(async () => importResult({
            persistedIds: [operation.signature!.hash], acceptedOperations: [operation],
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
        expect(clearQueue).toHaveBeenCalledWith('hyperswarm', [operation], 'old-epoch');
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

    it('does not relay a local page when Gatekeeper reports a failed clear', async () => {
        const { cipher, operation } = makeOperation();
        const relay = jest.fn(async () => undefined);
        const syncStats = createMediatorSyncStats();
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            gatekeeper: {
                getQueue: jest.fn(async () => [operation]),
                clearQueue: jest.fn(async () => false),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats,
            getImportPipeline: () => ({
                available: true,
                enqueue: jest.fn(async () => importResult()),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });

        await expect(coordinator.flush()).rejects.toThrow('failed to clear local Gatekeeper queue');
        expect(relay).not.toHaveBeenCalled();
        expect(syncStats.queueOpsRelayed).toBe(0);
    });

    it('suppresses duplicate gossip and preserves local flush ordering', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const operations = [first.operation, second];
        const order: string[] = [];
        const enqueue = jest.fn(async (request: { phase?: string; data: Operation[] }) => {
            order.push(request.phase ?? 'remote');
            return importResult({
                persistedIds: request.data.map(operation => operation.signature!.hash),
                acceptedOperations: request.data,
            });
        });
        const clearQueue = jest.fn(async () => { order.push('clear'); return true; });
        const relay = jest.fn(async () => { order.push('relay'); });
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => operations),
                clearQueue,
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
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
            data: operations,
        };

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.handleMessage('peer-key', {
            ...message,
            data: [...operations].reverse(),
        }, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledTimes(1);

        order.length = 0;
        await coordinator.flush();
        expect(order).toEqual(['persist', 'merge', 'clear', 'relay']);
    });

    it('suppresses a reordered remote copy after publishing the local queue', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const operations = [first.operation, second];
        const enqueue = jest.fn(async (request: { data: Operation[] }) => importResult({
            persistedIds: request.data.map(operation => operation.signature!.hash),
        }));
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => operations),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });

        await coordinator.flush();
        expect(enqueue).toHaveBeenCalledTimes(2);
        await coordinator.handleMessage('peer-key', {
            type: 'queue',
            time: '',
            node: 'peer',
            relays: [],
            data: [...operations].reverse(),
        }, connection);

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(coordinator.getMetrics().recentOutcomes).toBe(1);
    });

    it('does not fail a successful local flush when an outcome key cannot be mapped', async () => {
        const { cipher, operation } = makeOperation();
        const unmapped = {
            ...operation,
            signature: { ...operation.signature!, hash: 'invalid' },
        };
        const enqueue = jest.fn(async () => importResult());
        const relay = jest.fn(async () => undefined);
        const syncStats = createMediatorSyncStats();
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => [unmapped]),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats,
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });

        await expect(coordinator.flush()).resolves.toBeUndefined();

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(relay).toHaveBeenCalledTimes(1);
        expect(syncStats.queueOpsRelayed).toBe(1);
        expect(coordinator.getMetrics().recentOutcomes).toBe(0);
    });

    it('forgets completed gossip when the synchronization store resets', async () => {
        const { cipher, operation } = makeOperation();
        const enqueue = jest.fn(async () => importResult({
            persistedIds: [operation.signature!.hash],
            acceptedOperations: [operation],
        }));
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message: QueueMessage = {
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        };

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);

        coordinator.reset();
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(2);
    });

    it('does not restore completed gossip when an admitted import crosses a reset', async () => {
        const { cipher, operation } = makeOperation();
        let complete!: (result: ImportQueueResult) => void;
        const enqueue = jest.fn<ImportPipeline['enqueue']>()
            .mockImplementationOnce(() => new Promise<ImportQueueResult>(resolve => { complete = resolve; }))
            .mockResolvedValue(importResult({
                persistedIds: [operation.signature!.hash],
                acceptedOperations: [operation],
            }));
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message: QueueMessage = {
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        };

        const admitted = coordinator.handleMessage('peer-key', message, connection);
        await Promise.resolve();
        coordinator.reset();
        complete(importResult({
            persistedIds: [operation.signature!.hash],
            acceptedOperations: [operation],
        }));
        await admitted;

        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(2);
    });

    it('delays incomplete gossip before permitting a later retry', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const operations = [first.operation, second];
        let nowMs = 0;
        let attempt = 0;
        const enqueue = jest.fn(async (request: { data: Operation[] }) => {
            attempt += 1;
            return attempt === 1
                ? importResult({ pendingIds: [request.data[0].signature!.hash] })
                : importResult({
                    persistedIds: request.data.map(operation => operation.signature!.hash),
                    acceptedOperations: request.data,
                });
        });
        const relay = jest.fn(async (_message: QueueMessage) => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            now: () => nowMs,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ available: true, recovering: false, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: operations };
        const reordered = { ...message, data: [...operations].reverse() };

        await coordinator.handleMessage('peer-key', message, connection);
        expect(relay).not.toHaveBeenCalled();
        await coordinator.handleMessage('peer-key', reordered, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        nowMs = 1_001;
        await coordinator.handleMessage('peer-key', reordered, connection);
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(relay).toHaveBeenCalledTimes(1);
    });

    it('relays only persisted accepted and portable-terminal subsets', async () => {
        const accepted = makeOperation('2026-08-01T12:00:00.000Z');
        const terminal = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const pending = makeOperation('2026-08-01T12:00:02.000Z').operation;
        const unrelatedInvalid = makeOperation('2026-08-01T12:00:03.000Z').operation;
        const relay = jest.fn(async (_message: QueueMessage) => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 1,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: accepted.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                available: true,
                enqueue: jest.fn(async () => importResult({
                    persistedIds: [accepted.operation.signature!.hash, terminal.signature!.hash],
                    pendingIds: [pending.signature!.hash],
                    acceptedOperations: [accepted.operation],
                    portableTerminalOperations: [terminal],
                    unaddressableOperations: [unrelatedInvalid],
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: 'local-time', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });

        await coordinator.handleMessage('peer-key', {
            type: 'queue', time: 'untrusted-time', node: 'untrusted-node', relays: [],
            data: [pending],
        }, connection);

        expect(relay).toHaveBeenCalledTimes(2);
        expect(relay.mock.calls.map(([message]) => message)).toEqual([
            {
                type: 'queue', time: 'local-time', node: 'local', relays: ['peer-key'],
                data: [accepted.operation],
            },
            {
                type: 'queue', time: 'local-time', node: 'local', relays: ['peer-key'],
                data: [terminal],
            },
        ]);
    });

    it('retries gossip when a persisted operation cannot fit a relay page', async () => {
        const { cipher, operation } = makeOperation();
        const oversized = { ...operation, extra: 'x'.repeat(1_000) } as Operation;
        const enqueue = jest.fn(async () => importResult({
            persistedIds: [operation.signature!.hash],
            acceptedOperations: [oversized],
        }));
        const relay = jest.fn(async () => undefined);
        const gatekeeper = {
            getQueue: jest.fn(async () => []),
            clearQueue: jest.fn(async () => true),
        } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>;
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm', maxOpsPerPage: 300, maxBytesPerPage: 512,
            ...defaultRepairOptions(),
            gatekeeper,
            cipher, syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay, onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.handleMessage('peer-key', message, connection);

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(relay).not.toHaveBeenCalled();
        await coordinator.shutdown();
    });

    it('drains persisted pages after a relay failure without failing the import', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const enqueue = jest.fn<ImportPipeline['enqueue']>()
            .mockImplementationOnce(async request => {
                if (request.kind !== 'remote' || !request.onPersistedPage) {
                    throw new Error('missing persisted-page callback');
                }
                await request.onPersistedPage({
                    acceptedOperations: [first.operation],
                    portableTerminalOperations: [],
                });
                await request.onPersistedPage({
                    acceptedOperations: [second],
                    portableTerminalOperations: [],
                });
                return importResult({ persistedIds: [first.operation.signature!.hash] });
            })
            .mockResolvedValueOnce(importResult({ knownIds: [first.operation.signature!.hash] }));
        const relay = jest.fn<(_message: QueueMessage) => Promise<void>>()
            .mockRejectedValueOnce(new Error('relay unavailable'))
            .mockResolvedValue(undefined);
        let nowMs = 0;
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            now: () => nowMs,
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
        const message: QueueMessage = {
            type: 'queue', time: '', node: 'peer', relays: [], data: [first.operation],
        };

        await expect(coordinator.handleMessage('peer-key', message, connection)).resolves.toBeUndefined();
        expect(relay).toHaveBeenCalledTimes(2);
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        nowMs = 1_001;
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(2);
    });

    it('relays nothing when the import result is retryable', async () => {
        const { cipher, operation } = makeOperation();
        let nowMs = 0;
        const enqueue = jest.fn(async () => importResult({
            acceptedOperations: [operation],
            retryable: true,
        }));
        const relay = jest.fn(async () => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            now: () => nowMs,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ available: true, enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        nowMs = 1_001;
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(relay).not.toHaveBeenCalled();
    });

    it('drops gossip on local page pressure without penalizing the peer and permits retry', async () => {
        const { cipher, operation } = makeOperation();
        let nowMs = 0;
        const operationPages = createOperationPageBudget(1, 512 * 1024);
        const held = operationPages.reserve(1)!;
        const enqueue = jest.fn(async () => importResult({
            persistedIds: [operation.signature!.hash],
            acceptedOperations: [operation],
        }));
        const relay = jest.fn(async () => undefined);
        const onProtocolViolation = jest.fn();
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            now: () => nowMs,
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
        await coordinator.runRepairs();
        nowMs = 1_001;
        await coordinator.handleMessage('peer-key', message, connection);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledTimes(1);
        expect(operationPages.pages).toBe(0);
    });

    it('admits at most one active and one waiting gossip batch', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z');
        const third = makeOperation('2026-08-01T12:00:02.000Z');
        let nowMs = 0;
        const completions: Array<() => void> = [];
        const enqueue = jest.fn((request: { data: Operation[] }) => new Promise(resolve => {
            completions.push(() => resolve(importResult({
                persistedIds: request.data.map(operation => operation.signature!.hash),
                acceptedOperations: request.data,
            })));
        }));
        const relay = jest.fn(async () => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            now: () => nowMs,
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
        await coordinator.handleMessage('third-peer', message(third.operation), connection);
        expect(enqueue).toHaveBeenCalledTimes(2);
        completions[1]();
        await secondWork;
        await coordinator.runRepairs();
        nowMs = 1_001;
        const thirdWork = coordinator.handleMessage('third-peer', message(third.operation), connection);
        expect(enqueue).toHaveBeenCalledTimes(3);
        completions[2]();
        await thirdWork;
        expect(relay).toHaveBeenCalledTimes(3);
    });

    it('drops overloaded gossip before content validation and coalesces one repair', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z');
        const dropped = makeOperation('2026-08-01T12:00:02.000Z');
        const connections = new Map<string, ConnectionInfo>([
            ['first-peer', {} as ConnectionInfo],
            ['second-peer', {} as ConnectionInfo],
            ['dropped-peer', {} as ConnectionInfo],
        ]);
        const completions: Array<() => void> = [];
        const enqueue = jest.fn((request: { data: Operation[] }) => new Promise(resolve => {
            completions.push(() => resolve(importResult({
                persistedIds: request.data.map(operation => operation.signature!.hash),
                acceptedOperations: request.data,
            })));
        }));
        const requestRepair = jest.fn(async () => false);
        const onProtocolViolation = jest.fn();
        const syncStats = createMediatorSyncStats();
        const operationPages = createOperationPageBudget(5, 5 * 512 * 1024);
        const hashJSON = jest.spyOn(first.cipher, 'hashJSON');
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats,
            bulkReads: createBulkWorkScheduler(2),
            operationPages,
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: peerKey => connections.get(peerKey),
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation,
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        const firstWork = coordinator.handleMessage(
            'first-peer', message(first.operation), connections.get('first-peer')!,
        );
        const secondWork = coordinator.handleMessage(
            'second-peer', message(second.operation), connections.get('second-peer')!,
        );
        const hashesBeforeDrops = hashJSON.mock.calls.length;
        await coordinator.handleMessage(
            'dropped-peer', message(dropped.operation), connections.get('dropped-peer')!,
        );
        await coordinator.handleMessage(
            'dropped-peer', message(dropped.operation), connections.get('dropped-peer')!,
        );
        await coordinator.handleMessage('dropped-peer', message({
            ...dropped.operation,
            signature: { ...dropped.operation.signature!, hash: 'f'.repeat(64) },
        }), connections.get('dropped-peer')!);

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(requestRepair).not.toHaveBeenCalled();
        expect(onProtocolViolation).not.toHaveBeenCalled();
        expect(hashJSON).toHaveBeenCalledTimes(hashesBeforeDrops);
        expect(operationPages.pages).toBe(2);
        expect(syncStats.hardening.gossipOverloadDrops).toBe(3);
        expect(coordinator.getMetrics()).toMatchObject({ recentOutcomes: 0, repairsPending: 1 });

        completions[0]();
        await firstWork;
        expect(requestRepair).not.toHaveBeenCalled();
        completions[1]();
        await secondWork;
        await coordinator.runRepairs();

        expect(requestRepair).toHaveBeenCalledTimes(1);
        expect(requestRepair).toHaveBeenCalledWith(
            'dropped-peer', connections.get('dropped-peer'),
        );
    });

    it('does not create another immediate repair opportunity for the same peer', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const requestRepair = jest.fn(async () => false);
        const operationPages = createOperationPageBudget(1, 512 * 1024);
        const held = operationPages.reserve(1)!;
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages,
            getImportPipeline: () => ({ enqueue: jest.fn() } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: () => connection,
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        await coordinator.handleMessage('peer-key', message(first.operation), connection);
        await coordinator.handleMessage('peer-key', message(second), connection);
        expect(requestRepair).toHaveBeenCalledTimes(1);

        await coordinator.runRepairs();
        await coordinator.runRepairs();
        expect(requestRepair).toHaveBeenCalledTimes(2);
        held.release();
    });

    it('keeps saturated drops cheap while a repair is already running', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const third = makeOperation('2026-08-01T12:00:02.000Z').operation;
        const operationPages = createOperationPageBudget(1, 512 * 1024);
        const held = operationPages.reserve(1)!;
        let finishRepair!: (started: boolean) => void;
        const activeRepair = new Promise<boolean>(resolve => { finishRepair = resolve; });
        const requestRepair = jest.fn<() => Promise<boolean>>()
            .mockImplementationOnce(() => activeRepair)
            .mockResolvedValue(false);
        const connections = new Map<string, ConnectionInfo>([
            ['first-peer', {} as ConnectionInfo],
            ['second-peer', {} as ConnectionInfo],
            ['third-peer', {} as ConnectionInfo],
        ]);
        const hashJSON = jest.spyOn(first.cipher, 'hashJSON');
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            operationPages,
            getImportPipeline: () => ({ available: true, enqueue: jest.fn() } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: peerKey => connections.get(peerKey),
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        await coordinator.handleMessage('first-peer', message(first.operation), connections.get('first-peer')!);
        await coordinator.handleMessage('second-peer', message(second), connections.get('second-peer')!);
        const hashesBeforeSaturatedDrop = hashJSON.mock.calls.length;
        await coordinator.handleMessage('third-peer', message(third), connections.get('third-peer')!);

        expect(hashJSON).toHaveBeenCalledTimes(hashesBeforeSaturatedDrop);
        expect(requestRepair).toHaveBeenCalledTimes(1);
        expect(coordinator.getMetrics()).toMatchObject({ recentOutcomes: 2, repairsPending: 3 });

        finishRepair(false);
        await coordinator.shutdown();
        held.release();
    });

    it('uses one connected duplicate sender when the original source disconnects', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const operations = [first.operation, second];
        const original = {} as ConnectionInfo;
        const disconnectedAlternative = {} as ConnectionInfo;
        const alternative = {} as ConnectionInfo;
        const connections = new Map<string, ConnectionInfo>([
            ['original-peer', original],
            ['disconnected-peer', disconnectedAlternative],
            ['alternative-peer', alternative],
        ]);
        let complete!: (result: ImportQueueResult) => void;
        const enqueue = jest.fn(() => new Promise<ImportQueueResult>(resolve => {
            complete = resolve;
        }));
        const requestRepair = jest.fn(async () => false);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: peerKey => connections.get(peerKey),
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: operations };
        const reordered = { ...message, data: [...operations].reverse() };

        const originalWork = coordinator.handleMessage('original-peer', message, original);
        await coordinator.handleMessage('disconnected-peer', reordered, disconnectedAlternative);
        connections.delete('disconnected-peer');
        await coordinator.handleMessage('alternative-peer', reordered, alternative);
        connections.delete('original-peer');
        complete(importResult({ pendingIds: [first.operation.signature!.hash] }));
        await originalWork;
        await coordinator.runRepairs();

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(requestRepair).toHaveBeenCalledWith('alternative-peer', alternative);
    });

    it('bounds recent gossip outcomes with FIFO eviction', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const third = makeOperation('2026-08-01T12:00:02.000Z').operation;
        const enqueue = jest.fn(async (request: { data: Operation[] }) => importResult({
            persistedIds: request.data.map(operation => operation.signature!.hash),
            acceptedOperations: request.data,
        }));
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            maxRecentOutcomes: 2,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        await coordinator.handleMessage('peer', message(first.operation), connection);
        await coordinator.handleMessage('peer', message(second), connection);
        await coordinator.handleMessage('peer', message(third), connection);
        await coordinator.handleMessage('peer', message(second), connection);
        await coordinator.handleMessage('peer', message(first.operation), connection);

        expect(enqueue).toHaveBeenCalledTimes(4);
    });

    it('prunes expired retry outcomes before evicting completed outcomes', async () => {
        const retry = makeOperation('2026-08-01T12:00:00.000Z');
        const retained = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const newest = makeOperation('2026-08-01T12:00:02.000Z').operation;
        let nowMs = 0;
        let retryAttempt = 0;
        const enqueue = jest.fn(async (request: { data: Operation[] }) => {
            const operation = request.data[0];
            if (operation === retry.operation && retryAttempt++ === 0) {
                return importResult({ pendingIds: [operation.signature!.hash] });
            }
            return importResult({
                persistedIds: [operation.signature!.hash],
                acceptedOperations: [operation],
            });
        });
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            now: () => nowMs,
            maxRecentOutcomes: 2,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: retry.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        await coordinator.handleMessage('peer', message(retry.operation), connection);
        nowMs = 1_001;
        await coordinator.handleMessage('peer', message(retained), connection);
        await coordinator.handleMessage('peer', message(newest), connection);
        await coordinator.handleMessage('peer', message(retained), connection);
        await coordinator.handleMessage('peer', message(retry.operation), connection);

        expect(enqueue).toHaveBeenCalledTimes(4);
    });

    it('removes started and disconnected repairs while preserving FIFO order', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const firstConnection = {} as ConnectionInfo;
        const secondConnection = {} as ConnectionInfo;
        const connections = new Map<string, ConnectionInfo>([
            ['first-peer', firstConnection],
            ['second-peer', secondConnection],
        ]);
        const requestRepair = jest.fn(async () => true);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                enqueue: jest.fn(async (request: { data: Operation[] }) => importResult({
                    pendingIds: request.data.map(operation => operation.signature!.hash),
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: peerKey => connections.get(peerKey),
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        await coordinator.handleMessage('first-peer', message(first.operation), firstConnection);
        await coordinator.handleMessage('second-peer', message(second), secondConnection);
        await coordinator.runRepairs();
        expect(requestRepair).toHaveBeenCalledWith('first-peer', firstConnection);

        connections.delete('second-peer');
        await coordinator.runRepairs();
        expect(requestRepair).toHaveBeenCalledTimes(1);
    });

    it('retains repair work recorded while an earlier repair is starting', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        let finishRepair!: (started: boolean) => void;
        const requestRepair = jest.fn<(
            peerKey: string,
            connection: ConnectionInfo,
        ) => Promise<boolean>>()
            .mockImplementationOnce(() => new Promise<boolean>(resolve => {
                finishRepair = resolve;
            }))
            .mockResolvedValueOnce(true);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                enqueue: jest.fn(async (request: { data: Operation[] }) => importResult({
                    pendingIds: request.data.map(operation => operation.signature!.hash),
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: () => connection,
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        await coordinator.handleMessage('peer-key', message(first.operation), connection);
        const firstRepair = coordinator.runRepairs();
        await Promise.resolve();
        await coordinator.handleMessage('peer-key', message(second), connection);
        finishRepair(true);
        await firstRepair;

        await coordinator.runRepairs();
        expect(requestRepair).toHaveBeenCalledTimes(2);
    });

    it('preserves a new overload yield while an earlier repair is starting', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        const firstConnection = {} as ConnectionInfo;
        const secondConnection = {} as ConnectionInfo;
        const connections = new Map<string, ConnectionInfo>([
            ['first-peer', firstConnection],
            ['second-peer', secondConnection],
        ]);
        let finishRepair!: (started: boolean) => void;
        const requestRepair = jest.fn<(
            peerKey: string,
            connection: ConnectionInfo,
        ) => Promise<boolean>>()
            .mockImplementationOnce(() => new Promise<boolean>(resolve => {
                finishRepair = resolve;
            }))
            .mockResolvedValueOnce(false);
        const operationPages = createOperationPageBudget(1, 512 * 1024);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages,
            getImportPipeline: () => ({
                enqueue: jest.fn(async () => importResult({
                    pendingIds: [first.operation.signature!.hash],
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: peerKey => connections.get(peerKey),
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });

        await coordinator.handleMessage('first-peer', {
            type: 'queue', time: '', node: 'peer', relays: [], data: [first.operation],
        }, firstConnection);
        const firstRepair = coordinator.runRepairs();
        await Promise.resolve();
        const held = operationPages.reserve(1)!;
        await coordinator.handleMessage('second-peer', {
            type: 'queue', time: '', node: 'peer', relays: [], data: [second],
        }, secondConnection);
        finishRepair(true);
        await firstRepair;
        held.release();

        expect(requestRepair).toHaveBeenCalledTimes(2);
        expect(requestRepair).toHaveBeenLastCalledWith('second-peer', secondConnection);
    });

    it('does not renew completed repair work for a retry-suppressed duplicate', async () => {
        const { cipher, operation } = makeOperation();
        let finishRepair!: (started: boolean) => void;
        const requestRepair = jest.fn<(
            peerKey: string,
            connection: ConnectionInfo,
        ) => Promise<boolean>>(() => new Promise(resolve => {
                finishRepair = resolve;
            }));
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                enqueue: jest.fn(async () => importResult({
                    pendingIds: [operation.signature!.hash],
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: () => connection,
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = {
            type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation],
        };

        await coordinator.handleMessage('peer-key', message, connection);
        const repair = coordinator.runRepairs();
        await Promise.resolve();
        finishRepair(true);
        await repair;

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.runRepairs();
        await coordinator.runRepairs();
        expect(requestRepair).toHaveBeenCalledTimes(1);
    });

    it('moves an in-flight batch to a replacement connection with the same peer key', async () => {
        const { cipher, operation } = makeOperation();
        const original = {} as ConnectionInfo;
        const replacement = {} as ConnectionInfo;
        const connections = new Map<string, ConnectionInfo>([['peer-key', original]]);
        let complete!: (result: ImportQueueResult) => void;
        const enqueue = jest.fn(() => new Promise<ImportQueueResult>(resolve => {
            complete = resolve;
        }));
        const requestRepair = jest.fn(async () => false);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: peerKey => connections.get(peerKey),
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        const work = coordinator.handleMessage('peer-key', message, original);
        connections.set('peer-key', replacement);
        await coordinator.handleMessage('peer-key', message, replacement);
        complete(importResult({ pendingIds: [operation.signature!.hash] }));
        await work;
        await coordinator.runRepairs();

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(requestRepair).toHaveBeenCalledWith('peer-key', replacement);
    });

    it('does not retain a repair source that is no longer connected', async () => {
        const { cipher, operation } = makeOperation();
        const enqueue = jest.fn(async () => importResult({ retryable: true }));
        const requestRepair = jest.fn(async () => false);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: () => undefined,
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.runRepairs();

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(requestRepair).not.toHaveBeenCalled();
    });

    it('retains a repair flag when targeted repair throws', async () => {
        const { cipher, operation } = makeOperation();
        const requestRepair = jest.fn(async () => {
            throw new Error('repair failed');
        });
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                enqueue: jest.fn(async () => importResult({
                    pendingIds: [operation.signature!.hash],
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: () => connection,
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });

        await coordinator.handleMessage('peer-key', {
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        }, connection);
        await expect(coordinator.runRepairs()).resolves.toBeUndefined();
        await expect(coordinator.runRepairs()).resolves.toBeUndefined();

        expect(requestRepair).toHaveBeenCalledTimes(2);
    });

    it('preserves repair across replacement and removes it on the active disconnect', async () => {
        const { cipher, operation } = makeOperation();
        const original = {} as ConnectionInfo;
        const replacement = {} as ConnectionInfo;
        const connections = new Map<string, ConnectionInfo>([['peer-key', original]]);
        const requestRepair = jest.fn(async () => false);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            repairIntervalMs: 1_000,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                enqueue: jest.fn(async () => importResult({
                    pendingIds: [operation.signature!.hash],
                })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            getConnection: peerKey => connections.get(peerKey),
            requestRepair,
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        await coordinator.handleMessage('peer-key', message, original);
        coordinator.handleDisconnected('peer-key', 'connection_replaced', original);
        connections.set('peer-key', replacement);
        await coordinator.runRepairs();
        expect(requestRepair).toHaveBeenCalledWith('peer-key', replacement);

        coordinator.handleDisconnected('peer-key', 'connection_closed', replacement);
        connections.delete('peer-key');
        await coordinator.runRepairs();
        expect(requestRepair).toHaveBeenCalledTimes(1);
    });

    it('stops admission and waits for admitted gossip during idempotent shutdown', async () => {
        const first = makeOperation('2026-08-01T12:00:00.000Z');
        const second = makeOperation('2026-08-01T12:00:01.000Z').operation;
        let complete!: (result: ImportQueueResult) => void;
        const enqueue = jest.fn(() => new Promise<ImportQueueResult>(resolve => {
            complete = resolve;
        }));
        const operationPages = createOperationPageBudget(5, 5 * 512 * 1024);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages,
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });
        const message = (operation: Operation): QueueMessage => ({
            type: 'queue', time: '', node: 'peer', relays: [], data: [operation],
        });

        const active = coordinator.handleMessage('peer', message(first.operation), connection);
        const shutdown = coordinator.shutdown();
        await coordinator.handleMessage('peer', message(second), connection);
        expect(enqueue).toHaveBeenCalledTimes(1);

        complete(importResult({
            persistedIds: [first.operation.signature!.hash],
            acceptedOperations: [first.operation],
        }));
        await active;
        await expect(shutdown).resolves.toBeUndefined();
        await expect(coordinator.shutdown()).resolves.toBeUndefined();
        expect(operationPages.pages).toBe(0);
    });

    it('rejects an invalid recent-outcome limit', () => {
        const { cipher } = makeOperation();
        expect(() => createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            maxRecentOutcomes: 0,
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue: jest.fn() } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        })).toThrow('maxRecentOutcomes must be a positive safe integer');
    });

    it('replaces untrusted relay hints with the immediate sender', async () => {
        const { cipher, operation } = makeOperation();
        const relay = jest.fn(async (_message: QueueMessage) => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
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
                enqueue: jest.fn(async () => importResult({
                    persistedIds: [operation.signature!.hash],
                    acceptedOperations: [operation],
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
        expect(forwarded.relays).toEqual([peerKey]);
    });

    it('rejects forged gossip and delays retry after an import failure', async () => {
        const { cipher, operation } = makeOperation();
        let nowMs = 0;
        const enqueue = jest.fn<ImportPipeline['enqueue']>()
            .mockRejectedValueOnce(new Error('import failed'))
            .mockResolvedValueOnce(importResult({
                persistedIds: [operation.signature!.hash],
                acceptedOperations: [operation],
            }));
        const relay = jest.fn(async () => undefined);
        const onProtocolViolation = jest.fn();
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            now: () => nowMs,
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
            data: [{
                ...operation,
                signature: { ...operation.signature!, hash: 'f'.repeat(64) },
            }],
        }, connection)).resolves.toBeUndefined();
        await expect(coordinator.handleMessage('peer-key', message, connection)).resolves.toBeUndefined();
        await expect(coordinator.handleMessage('peer-key', message, connection)).resolves.toBeUndefined();
        expect(enqueue).toHaveBeenCalledTimes(1);
        nowMs = 1_001;
        await expect(coordinator.handleMessage('peer-key', message, connection)).resolves.toBeUndefined();
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(onProtocolViolation).toHaveBeenCalledTimes(1);
        expect(relay).toHaveBeenCalledWith(expect.objectContaining({ relays: ['peer-key'] }));
    });

    it('retains a local queue when merging reports backpressure', async () => {
        const { cipher, operation } = makeOperation();
        const enqueue = jest.fn<ImportPipeline['enqueue']>()
            .mockResolvedValueOnce(importResult({
                persistedIds: [operation.signature!.hash],
                acceptedOperations: [operation],
            }))
            .mockResolvedValueOnce(importResult({
                capacityDeferredIds: [operation.signature!.hash],
            }));
        const clearQueue = jest.fn(async () => true);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
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

    it('leaves a local queue intact if processing pauses after merging', async () => {
        const { cipher, operation } = makeOperation();
        let available = true;
        const enqueue = jest.fn<ImportPipeline['enqueue']>(async () => {
            if (enqueue.mock.calls.length === 2) available = false;
            return importResult({ persistedIds: [operation.signature!.hash] });
        });
        const clearQueue = jest.fn(async () => true);
        const pipeline = { get available() { return available; }, enqueue } as unknown as ImportPipeline;
        const gatekeeper = {
            getQueue: jest.fn(async () => [operation]),
            clearQueue,
        } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>;
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm', maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper,
            cipher, syncStats: createMediatorSyncStats(), getImportPipeline: () => pipeline,
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined), onProtocolViolation: jest.fn(),
        });

        await coordinator.flush();

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(clearQueue).not.toHaveBeenCalled();
        await coordinator.shutdown();
    });

    it('starts repair only while the failed relay connection is still current', async () => {
        const getConnection = jest.fn<() => ConnectionInfo | undefined>()
            .mockReturnValueOnce(connection)
            .mockReturnValueOnce(undefined);
        const requestRepair = jest.fn(async () => true);
        const gatekeeper = {
            getQueue: jest.fn(async () => []),
            clearQueue: jest.fn(async () => true),
        } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>;
        const base = {
            registry: 'hyperswarm', maxOpsPerPage: 300, maxBytesPerPage: 512 * 1024,
            gatekeeper,
            cipher: new CipherNode(), syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ available: true } as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue' as const, time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined), onProtocolViolation: jest.fn(),
        };
        const disconnected = createQueueCoordinator({ ...base, getConnection, requestRepair });
        disconnected.handleRelayFailure('peer-key', connection);
        await disconnected.runRepairs();
        expect(requestRepair).not.toHaveBeenCalled();
        disconnected.handleRelayFailure('peer-key', connection);

        const current = createQueueCoordinator({
            ...base,
            getConnection: () => connection,
            requestRepair,
        });
        current.handleRelayFailure('peer-key', connection);
        await current.runRepairs();
        expect(requestRepair).toHaveBeenCalledWith('peer-key', connection);
        await Promise.all([disconnected.shutdown(), current.shutdown()]);
    });

    it('retains a local queue when initial persistence is retryable', async () => {
        const { cipher, operation } = makeOperation();
        const clearQueue = jest.fn(async () => true);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 300,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue: jest.fn(async () => [operation]),
                clearQueue,
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                enqueue: jest.fn(async () => importResult({ retryable: true })),
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });

        await expect(coordinator.flush()).rejects.toThrow('failed to import local Gatekeeper queue');
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
            ...defaultRepairOptions(),
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

    it('drains one protocol-bounded local queue page per flush', async () => {
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
        const pages = [[first.operation], [second], []];
        const enqueue = jest.fn(async () => importResult({
            persistedIds: [],
            acceptedOperations: [],
        }));
        const getQueue = jest.fn(async () => pages.shift() ?? []);
        const clearQueue = jest.fn(async (_registry: string, _page: Operation[]) => true);
        const relay = jest.fn(async (_message: QueueMessage) => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            maxOpsPerPage: 1,
            maxBytesPerPage: 512 * 1024,
            ...defaultRepairOptions(),
            gatekeeper: {
                getQueue,
                clearQueue,
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: first.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
                available: true,
                enqueue,
            } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });

        await coordinator.flush();
        await coordinator.flush();
        await coordinator.flush();

        expect(relay).toHaveBeenCalledTimes(2);
        expect(relay.mock.calls.map(([message]) => message.data)).toEqual([
            [first.operation],
            [second],
        ]);
        expect(getQueue).toHaveBeenCalledTimes(3);
        expect(getQueue).toHaveBeenCalledWith('hyperswarm', {
            limit: 1,
            maxBytes: 512 * 1024,
        });
        expect(clearQueue.mock.calls.map(([, page]) => page)).toEqual([
            [first.operation],
            [second],
        ]);

        await coordinator.handleMessage('peer', {
            type: 'queue', time: '', node: 'peer', relays: [], data: [first.operation],
        }, connection);
        expect(enqueue).toHaveBeenCalledTimes(4);
    });
});
