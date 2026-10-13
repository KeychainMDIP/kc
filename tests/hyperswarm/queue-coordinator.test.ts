import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';

import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import type { QueueMessage } from '../../services/mediators/hyperswarm/src/protocol-messages.ts';
import { createQueueCoordinator } from '../../services/mediators/hyperswarm/src/queue-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';

function makeOperation(): { cipher: CipherNode; operation: Operation } {
    const cipher = new CipherNode();
    const unsigned = {
        type: 'create' as const,
        created: '2026-08-01T12:00:00.000Z',
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
            getImportPipeline: () => ({
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
            getImportPipeline: () => ({ enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay: jest.fn(async () => undefined),
            onProtocolViolation: jest.fn(),
        });

        await expect(coordinator.flush()).rejects.toThrow('failed to merge local Gatekeeper queue');
        expect(clearQueue).not.toHaveBeenCalled();
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
            getImportPipeline: () => ({
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
