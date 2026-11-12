import { jest } from '@jest/globals';
import type CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';

import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import { createQueueCoordinator } from '../../services/mediators/hyperswarm/src/queue-coordinator.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';

describe('queue coordinator', () => {
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
            gatekeeper: { getQueue: jest.fn(async () => [operation]), clearQueue },
            cipher: { hashJSON: () => 'batch-hash' } as Pick<CipherNode, 'hashJSON'>,
            syncStats: createMediatorSyncStats(),
            getImportPipeline: () => ({ indexEpoch: 'old-epoch', enqueue } as unknown as ImportPipeline),
            getNodeKey: () => 'local-key',
            createQueueMessage: () => ({ type: 'queue', time: '', node: 'local', relays: [] }),
            relay,
        });

        await expect(coordinator.flush()).resolves.toBeUndefined();
        expect(enqueue).toHaveBeenCalledTimes(phase === 'persist' ? 1 : 2);
        expect(clearQueue).toHaveBeenCalledTimes(phase === 'persist' ? 0 : 1);
        expect(relay).toHaveBeenCalledTimes(phase === 'persist' ? 0 : 1);
    });

    it('suppresses duplicate gossip and preserves local flush ordering', async () => {
        const operation = { signature: { hash: 'operation-hash' } } as Operation;
        const order: string[] = [];
        const enqueue = jest.fn(async (request: { phase?: string }) => {
            order.push(request.phase ?? 'remote');
            return { knownIds: [], persistedIds: [], retryable: false };
        });
        const clearQueue = jest.fn(async () => { order.push('clear'); });
        const relay = jest.fn(async () => { order.push('relay'); });
        const coordinator = createQueueCoordinator({
            registry: 'hyperswarm',
            gatekeeper: {
                getQueue: jest.fn(async () => [operation]),
                clearQueue,
            } as unknown as Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>,
            cipher: { hashJSON: () => 'batch-hash' } as Pick<CipherNode, 'hashJSON'>,
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
        expect(order).toEqual(['persist', 'clear', 'relay', 'merge']);
    });
});
