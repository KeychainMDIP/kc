import type CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';

import type { ImportPipeline } from './import-pipeline.js';
import {
    addAggregateSample,
    collectQueueDelaySamples,
} from './negentropy/observability.js';
import type { QueueMessage } from './protocol-messages.js';
import type { MediatorSyncStats } from './sync-stats.js';

interface QueueCoordinatorOptions {
    registry: string;
    gatekeeper: Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>;
    cipher: Pick<CipherNode, 'hashJSON'>;
    syncStats: MediatorSyncStats;
    getImportPipeline(): ImportPipeline;
    getNodeKey(): string;
    createQueueMessage(): Omit<QueueMessage, 'data'>;
    relay(message: QueueMessage): Promise<void>;
}

export function createQueueCoordinator(options: QueueCoordinatorOptions) {
    const batchesSeen = new Set<string>();

    function isNewBatch(batch: Operation[]): boolean {
        const hash = options.cipher.hashJSON(batch);
        if (batchesSeen.has(hash)) {
            return false;
        }
        batchesSeen.add(hash);
        return true;
    }

    async function handleMessage(peerKey: string, message: QueueMessage): Promise<void> {
        if (!Array.isArray(message.data) || !isNewBatch(message.data)) {
            return;
        }

        options.getImportPipeline().enqueue({
            kind: 'remote',
            name: peerKey,
            node: message.node,
            data: message.data,
            queueGossip: true,
        });
        if (!Array.isArray(message.relays)) {
            message.relays = [];
        }
        message.relays.push(peerKey);
        await options.relay(message);
    }

    async function flush(): Promise<void> {
        const batch = await options.gatekeeper.getQueue(options.registry);
        if (batch.length === 0) {
            return;
        }

        const imported = await options.getImportPipeline().enqueue({
            kind: 'local_queue',
            phase: 'persist',
            name: options.getNodeKey(),
            data: batch,
        });
        if (imported.retryable) {
            throw new Error('failed to import local Gatekeeper queue');
        }

        options.syncStats.queueOpsRelayed += batch.length;
        for (const sample of collectQueueDelaySamples(batch)) {
            addAggregateSample(options.syncStats.queueDelayMs, sample);
        }

        const message: QueueMessage = {
            ...options.createQueueMessage(),
            data: batch,
        };
        const hashes = batch
            .map(operation => operation.signature?.hash)
            .filter((hash): hash is string => !!hash);
        await options.gatekeeper.clearQueue(options.registry, hashes);
        await options.relay(message);

        const merged = await options.getImportPipeline().enqueue({
            kind: 'local_queue',
            phase: 'merge',
            name: options.getNodeKey(),
            data: batch,
        });
        if (merged.retryable) {
            throw new Error('failed to merge local Gatekeeper queue');
        }
    }

    return { flush, handleMessage };
}
