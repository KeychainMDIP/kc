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
import { createQueueCoordinator } from '../../services/mediators/hyperswarm/src/queue-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';
import { createBulkWorkScheduler } from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';

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

    it('suppresses duplicate gossip and preserves local flush ordering', async () => {
        const { cipher, operation } = makeOperation();
        const order: string[] = [];
        const enqueue = jest.fn(async (request: { phase?: string }) => {
            order.push(request.phase ?? 'remote');
            return importResult({
                persistedIds: [operation.signature!.hash],
                acceptedOperations: [operation],
            });
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
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
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
            return attempt === 1
                ? importResult({ pendingIds: [operation.signature!.hash] })
                : importResult({
                    persistedIds: [operation.signature!.hash],
                    acceptedOperations: [operation],
                });
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
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
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
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: accepted.cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({
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

    it('relays nothing when the import result is retryable', async () => {
        const { cipher, operation } = makeOperation();
        const enqueue = jest.fn(async () => importResult({
            acceptedOperations: [operation],
            retryable: true,
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
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
            onProtocolViolation: jest.fn(),
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        await coordinator.handleMessage('peer-key', message, connection);
        await coordinator.handleMessage('peer-key', message, connection);

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(relay).not.toHaveBeenCalled();
    });

    it('drops gossip on local page pressure without penalizing the peer and permits retry', async () => {
        const { cipher, operation } = makeOperation();
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
            gatekeeper: {
                getQueue: jest.fn(async () => []),
                clearQueue: jest.fn(async () => true),
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages,
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
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

    it('replaces untrusted relay hints with the immediate sender', async () => {
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

    it('rejects malformed gossip and permits retry after an import failure', async () => {
        const { cipher, operation } = makeOperation();
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
            gatekeeper: {
                getQueue: jest.fn(async () => [operation]),
                clearQueue,
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher,
            syncStats: createMediatorSyncStats(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
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
            getImportPipeline: () => ({ enqueue: jest.fn() } as unknown as ImportPipeline),
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
                enqueue: jest.fn(async () => importResult({
                    persistedIds: batch.map(operation => operation.signature!.hash),
                    acceptedOperations: batch,
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
