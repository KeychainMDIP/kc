import type CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { Operation } from '@mdip/gatekeeper/types';
import { childLogger } from '@mdip/common/logger';

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

const log = childLogger({ service: 'hyperswarm-mediator' });

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

    async function relayPersistedPage(
        peerKey: string,
        persisted: { acceptedOperations: Operation[]; portableTerminalOperations: Operation[] },
    ): Promise<boolean> {
        const shareable = dedupeOperationsByHash([
            ...persisted.acceptedOperations,
            ...persisted.portableTerminalOperations,
        ]);
        let pages: Operation[][];
        try {
            pages = chunkOperationsForPush(shareable, {
                maxOpsPerPush: options.maxOpsPerPage,
                maxBytesPerPush: options.maxBytesPerPage,
            });
        }
        catch (error) {
            log.error({ error, peer: peerKey }, 'persisted queue gossip cannot be relayed');
            return false;
        }
        let relayed = true;
        for (const data of pages) {
            try {
                await options.relay({
                    ...options.createQueueMessage(),
                    relays: [peerKey],
                    data,
                });
            }
            catch (error) {
                relayed = false;
                log.error({ error, peer: peerKey }, 'persisted queue gossip relay failed');
            }
        }
        return relayed;
    }

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
        const content = validateOperationContentIds(page.value.operations, options.cipher);
        if (!content.ok) {
            options.onProtocolViolation(peerKey, `invalid_queue_operation: ${content.reason}`, connection);
            return;
        }
        if (admittedGossip >= 2) {
            return;
        }
        if (!options.getImportPipeline().available) {
            return;
        }
        const reservation = options.operationPages.reserve(page.value.bytes);
        if (!reservation) {
            return;
        }
        admittedGossip += 1;
        try {
            const batchHash = reserveBatch(page.value.operations);
            if (!batchHash) {
                return;
            }

            let relayFailed = false;
            let imported;
            try {
                imported = await options.getImportPipeline().enqueue({
                    kind: 'remote',
                    name: peerKey,
                    node: message.node,
                    data: message.data,
                    queueGossip: true,
                    onPersistedPage: async persisted => {
                        if (!await relayPersistedPage(peerKey, persisted)) {
                            relayFailed = true;
                        }
                    },
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
            const complete = (imported.pendingIds?.length ?? 0) === 0
            && (imported.capacityDeferredIds?.length ?? 0) === 0
            && (imported.unaddressableOperations?.length ?? 0) === 0
            && message.data.every(operation => {
                const mapped = mapOperationToSyncKey(operation);
                return mapped.ok
                    && hasContentVerifiedOperationId(operation, options.cipher)
                    && handledIds.has(mapped.value.idHex);
            });
            if (!complete) {
                batchesSeen.delete(batchHash);
            }
            if ((imported.acceptedOperations?.length ?? 0) > 0
                || (imported.portableTerminalOperations?.length ?? 0) > 0) {
                if (!await relayPersistedPage(peerKey, {
                    acceptedOperations: imported.acceptedOperations ?? [],
                    portableTerminalOperations: imported.portableTerminalOperations ?? [],
                })) {
                    relayFailed = true;
                }
            }
            if (relayFailed) {
                batchesSeen.delete(batchHash);
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

            // Accepted local operations remain Gatekeeper's responsibility while pending.
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
            if (!options.getImportPipeline().available) return;
            try {
                if (indexEpoch === undefined) await options.gatekeeper.clearQueue(options.registry, hashes);
                else await options.gatekeeper.clearQueue(options.registry, hashes, indexEpoch);
            }
            catch (error) {
                const conflict = error as { error?: string; code?: string } | null;
                if ((conflict?.error ?? conflict?.code) === 'gatekeeper_index_epoch_changed') return;
                throw error;
            }
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
