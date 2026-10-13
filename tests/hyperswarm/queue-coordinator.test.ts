import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';

import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
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
        });
        const message = {
            type: 'queue' as const,
            time: '',
            node: 'peer',
            relays: [],
            data: [operation],
        };

        await coordinator.handleMessage('peer-key', message);
        await coordinator.handleMessage('peer-key', { ...message, relays: [] });
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
        const relay = jest.fn(async () => undefined);
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
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
        });
        const message = { type: 'queue' as const, time: '', node: 'peer', relays: [], data: [operation] };

        await coordinator.handleMessage('peer-key', message);
        expect(relay).not.toHaveBeenCalled();
        await coordinator.handleMessage('peer-key', { ...message, relays: [] });
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(relay).toHaveBeenCalledTimes(1);
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
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
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
        });
        const message = {
            type: 'queue', time: '', node: 'peer', data: [operation],
        } as QueueMessage;

        await expect(coordinator.handleMessage('peer-key', {
            ...message,
            data: 'invalid',
        } as unknown as QueueMessage)).resolves.toBeUndefined();
        await expect(coordinator.handleMessage('peer-key', message)).rejects.toThrow('import failed');
        await expect(coordinator.handleMessage('peer-key', message)).resolves.toBeUndefined();

        expect(enqueue).toHaveBeenCalledTimes(2);
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
        });

        await expect(coordinator.flush()).rejects.toThrow('failed to merge local Gatekeeper queue');
        expect(clearQueue).not.toHaveBeenCalled();
    });
});
