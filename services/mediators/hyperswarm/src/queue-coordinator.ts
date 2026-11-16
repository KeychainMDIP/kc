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
import { hasContentVerifiedOperationId } from './sync-persistence.js';
import { mapOperationToSyncKey } from './sync-mapping.js';

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

    function reserveBatch(batch: Operation[]): string | null {
        const hash = options.cipher.hashJSON(batch);
        if (batchesSeen.has(hash)) {
            return null;
        }
        batchesSeen.add(hash);
        return hash;
    }

    async function handleMessage(peerKey: string, message: QueueMessage): Promise<void> {
        if (!options.getImportPipeline().available || !Array.isArray(message.data)) {
            return;
        }
        const batchHash = reserveBatch(message.data);
        if (!batchHash) {
            return;
        }

        let imported;
        try {
            imported = await options.getImportPipeline().enqueue({
                kind: 'remote',
                name: peerKey,
                node: message.node,
                data: message.data,
                queueGossip: true,
            });
        }
        catch (error) {
            batchesSeen.delete(batchHash);
            throw error;
        }
        const handledIds = new Set([...imported.knownIds, ...imported.persistedIds]);
        const complete = !imported.retryable
            && (imported.pendingIds?.length ?? 0) === 0
            && (imported.capacityDeferredIds?.length ?? 0) === 0
            && message.data.every(operation => {
                const mapped = mapOperationToSyncKey(operation);
                return mapped.ok
                    && hasContentVerifiedOperationId(operation, options.cipher)
                    && handledIds.has(mapped.value.idHex);
            });
        if (!complete) {
            batchesSeen.delete(batchHash);
            return;
        }
        if (!Array.isArray(message.relays)) {
            message.relays = [];
        }
        message.relays.push(peerKey);
        await options.relay(message);
    }

    async function flush(): Promise<void> {
        if (!options.getImportPipeline().available) return;
        const indexEpoch = options.getImportPipeline().indexEpoch;
        const batch = await options.gatekeeper.getQueue(options.registry);
        if (batch.length === 0) {
            return;
        }

        const imported = await options.getImportPipeline().enqueue({
            kind: 'local_queue',
            phase: 'persist',
            indexEpoch,
            name: options.getNodeKey(),
            data: batch,
        });
        if (imported.retryable) {
            if (imported.indexEpochChanged || imported.dependencyUnavailable) return;
            throw new Error('failed to import local Gatekeeper queue');
        }

        if (!options.getImportPipeline().available) return;
        const merged = await options.getImportPipeline().enqueue({
            kind: 'local_queue',
            phase: 'merge',
            indexEpoch,
            name: options.getNodeKey(),
            data: batch,
        });
        if (merged.retryable
            || (merged.capacityDeferredIds?.length ?? 0) > 0) {
            if (merged.indexEpochChanged || merged.dependencyUnavailable) return;
            throw new Error('failed to merge local Gatekeeper queue');
        }

        // These operations were already accepted locally and persisted above. GC or a history
        // change can remove their dependencies before confirmation, without invalidating the
        // historical operations. Gatekeeper owns retained pending confirmations, while the
        // capacity-refused inputs above still need caller retries before clearing the queue.

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
        if (!options.getImportPipeline().available) return;
        try {
            if (indexEpoch === undefined) await options.gatekeeper.clearQueue(options.registry, hashes);
            else await options.gatekeeper.clearQueue(options.registry, hashes, indexEpoch);
        } catch (error) {
            const conflict = error as { error?: string; code?: string } | null;
            if ((conflict?.error ?? conflict?.code) === 'gatekeeper_index_epoch_changed') return;
            throw error;
        }
        await options.relay(message);
    }

    return { flush, handleMessage };
}
