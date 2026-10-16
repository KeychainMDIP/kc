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
import {
    dedupeOperationsByHash,
    hasContentVerifiedOperationId,
} from './sync-persistence.js';
import { mapOperationToSyncKey } from './sync-mapping.js';
import {
    chunkOperationsForPush,
    validateOperationPage,
} from './negentropy/transfer.js';
import { validateOperationContentIds } from './protocol-validation.js';
import type { OperationPageBudget } from './operation-page-budget.js';
import type { BulkWorkScheduler } from './bulk-work-scheduler.js';

interface QueueCoordinatorOptions {
    registry: string;
    maxOpsPerPage: number;
    maxBytesPerPage: number;
    gatekeeper: Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>;
    cipher: Pick<CipherNode, 'hashJSON'>;
    syncStats: MediatorSyncStats;
    bulkReads: BulkWorkScheduler;
    operationPages: OperationPageBudget;
    getImportPipeline(): ImportPipeline;
    getNodeKey(): string;
    createQueueMessage(): Omit<QueueMessage, 'data'>;
    relay(message: QueueMessage): Promise<void>;
    onProtocolViolation(peerKey: string, reason: string, connection: ConnectionInfo): void;
}

export function createQueueCoordinator(options: QueueCoordinatorOptions) {
    const batchesSeen = new Set<string>();
    const activeWork = new Set<Promise<unknown>>();
    let admittedGossip = 0;
    let accepting = true;
    let shutdownPromise: Promise<void> | null = null;

    function trackWork<T>(work: Promise<T>): Promise<T> {
        activeWork.add(work);
        work.then(
            () => activeWork.delete(work),
            () => activeWork.delete(work),
        );
        return work;
    }

    function reserveBatch(batch: Operation[]): string | null {
        const hash = options.cipher.hashJSON(batch);
        if (batchesSeen.has(hash)) {
            return null;
        }
        batchesSeen.add(hash);
        return hash;
    }

    async function processMessage(
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
        if (admittedGossip >= 2) {
            return;
        }
        const reservation = options.operationPages.reserve(page.value.bytes);
        if (!reservation) {
            return;
        }
        admittedGossip += 1;
        try {
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
            if (imported.retryable) {
                batchesSeen.delete(batchHash);
                return;
            }
            const handledIds = new Set([...imported.knownIds, ...imported.persistedIds]);
            const complete = imported.pendingIds.length === 0
            && imported.capacityDeferredIds.length === 0
            && imported.unaddressableOperations.length === 0
            && message.data.every(operation => {
                const mapped = mapOperationToSyncKey(operation);
                return mapped.ok
                    && hasContentVerifiedOperationId(operation, options.cipher)
                    && handledIds.has(mapped.value.idHex);
            });
            if (!complete) {
                batchesSeen.delete(batchHash);
            }
            const shareable = dedupeOperationsByHash([
                ...imported.acceptedOperations,
                ...imported.portableTerminalOperations,
            ]);
            for (const data of chunkOperationsForPush(shareable, {
                maxOpsPerPush: options.maxOpsPerPage,
                maxBytesPerPush: options.maxBytesPerPage,
            })) {
                await options.relay({
                    ...options.createQueueMessage(),
                    relays: [peerKey],
                    data,
                });
            }
        }
        finally {
            admittedGossip -= 1;
            reservation.release();
        }
    }

    async function buildAndRelayLocalQueue(): Promise<void> {
        const reservation = options.operationPages.reserve(options.maxBytesPerPage);
        if (!reservation) {
            return;
        }

        try {
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
            || merged.pendingIds.length > 0
            || merged.capacityDeferredIds.length > 0) {
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
        finally {
            reservation.release();
        }
    }

    async function processFlush(): Promise<void> {
        await options.bulkReads.run(`queue:${options.registry}`, buildAndRelayLocalQueue);
    }

    return {
        flush(): Promise<void> {
            return accepting ? trackWork(processFlush()) : Promise.resolve();
        },
        handleMessage(
            peerKey: string,
            message: QueueMessage,
            connection: ConnectionInfo,
        ): Promise<void> {
            return accepting
                ? trackWork(processMessage(peerKey, message, connection))
                : Promise.resolve();
        },
        shutdown(): Promise<void> {
            if (!shutdownPromise) {
                accepting = false;
                options.bulkReads.cancel(`queue:${options.registry}`);
                shutdownPromise = Promise.allSettled([...activeWork]).then(() => undefined);
            }
            return shutdownPromise;
        },
    };
}
