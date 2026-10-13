import type CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';

import type { ImportPipeline } from './import-pipeline.js';
import type { ConnectionInfo } from './mediator-state.js';
import {
    addAggregateSample,
    collectQueueDelaySamples,
} from './negentropy/observability.js';
import type { QueueMessage } from './protocol-messages.js';
import type { MediatorSyncStats } from './sync-stats.js';
import { hasContentVerifiedOperationId } from './sync-persistence.js';
import { mapOperationToSyncKey } from './sync-mapping.js';
import {
    chunkOperationsForPush,
    validateOperationPage,
} from './negentropy/transfer.js';
import { MAX_RELAY_HINTS } from './protocol-limits.js';
import { validateOperationContentIds } from './protocol-validation.js';

interface QueueCoordinatorOptions {
    registry: string;
    maxOpsPerPage: number;
    maxBytesPerPage: number;
    gatekeeper: Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>;
    cipher: Pick<CipherNode, 'hashJSON'>;
    syncStats: MediatorSyncStats;
    getImportPipeline(): ImportPipeline;
    getNodeKey(): string;
    createQueueMessage(): Omit<QueueMessage, 'data'>;
    relay(message: QueueMessage): Promise<void>;
    onProtocolViolation(peerKey: string, reason: string, connection: ConnectionInfo): void;
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

    async function handleMessage(
        peerKey: string,
        message: QueueMessage,
        connection: ConnectionInfo,
    ): Promise<void> {
        const page = validateOperationPage(message.data, {
            maxOpsPerPush: options.maxOpsPerPage,
            maxBytesPerPush: options.maxBytesPerPage,
        });
        if (!page.ok) {
            options.onProtocolViolation(peerKey, `invalid_queue_payload: ${page.reason}`, connection);
            return;
        }
        const content = validateOperationContentIds(page.value.operations, options.cipher);
        if (!content.ok) {
            options.onProtocolViolation(peerKey, `invalid_queue_operation: ${content.reason}`, connection);
            return;
        }
        const batchHash = reserveBatch(page.value.operations);
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
        const relays = (Array.isArray(message.relays) ? message.relays : [])
            .filter(relay => relay !== peerKey)
            .slice(-(MAX_RELAY_HINTS - 1));
        await options.relay({
            ...message,
            relays: [...relays, peerKey],
        });
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

        const merged = await options.getImportPipeline().enqueue({
            kind: 'local_queue',
            phase: 'merge',
            name: options.getNodeKey(),
            data: batch,
        });
        if (merged.retryable
            || (merged.pendingIds?.length ?? 0) > 0
            || (merged.capacityDeferredIds?.length ?? 0) > 0) {
            throw new Error('failed to merge local Gatekeeper queue');
        }

        options.syncStats.queueOpsRelayed += batch.length;
        for (const sample of collectQueueDelaySamples(batch)) {
            addAggregateSample(options.syncStats.queueDelayMs, sample);
        }

        const pages = chunkOperationsForPush(batch, {
            maxOpsPerPush: options.maxOpsPerPage,
            maxBytesPerPush: options.maxBytesPerPage,
        });
        const hashes = batch
            .map(operation => operation.signature?.hash)
            .filter((hash): hash is string => !!hash);
        await options.gatekeeper.clearQueue(options.registry, hashes);
        for (const page of pages) {
            await options.relay({
                ...options.createQueueMessage(),
                data: page,
            });
        }
    }

    return { flush, handleMessage };
}
