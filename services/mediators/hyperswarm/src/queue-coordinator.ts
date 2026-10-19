import type CipherNode from '@mdip/cipher/node';
import { childLogger } from '@mdip/common/logger';
import type GatekeeperClient from '@mdip/gatekeeper/client';

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
const MAX_ADMITTED_GOSSIP = 2;
const MAX_RECENT_GOSSIP_OUTCOMES = 4_096;

interface QueueCoordinatorOptions {
    registry: string;
    maxOpsPerPage: number;
    maxBytesPerPage: number;
    repairIntervalMs: number;
    gatekeeper: Pick<GatekeeperClient, 'getQueue' | 'clearQueue'>;
    cipher: Pick<CipherNode, 'hashJSON'>;
    syncStats: MediatorSyncStats;
    bulkReads: BulkWorkScheduler;
    operationPages: OperationPageBudget;
    getImportPipeline(): ImportPipeline;
    getNodeKey(): string;
    getConnection(peerKey: string): ConnectionInfo | undefined;
    requestRepair(peerKey: string, connection: ConnectionInfo): Promise<boolean>;
    createQueueMessage(): Omit<QueueMessage, 'data'>;
    relay(message: QueueMessage): Promise<void>;
    onProtocolViolation(peerKey: string, reason: string, connection: ConnectionInfo): void;
    now?: () => number;
    maxRecentOutcomes?: number;
}

interface GossipSource {
    peerKey: string;
    connection: ConnectionInfo;
}

interface InFlightGossip {
    source: GossipSource;
    alternative?: GossipSource;
}

interface PendingRepair {
    connection: ConnectionInfo;
}

type RecentGossipOutcome = {
    kind: 'completed';
} | {
    kind: 'retry';
    retryAfter: number;
};

export function createQueueCoordinator(options: QueueCoordinatorOptions) {
    const now = options.now ?? (() => Date.now());
    const maxRecentOutcomes = options.maxRecentOutcomes ?? MAX_RECENT_GOSSIP_OUTCOMES;
    if (!Number.isSafeInteger(maxRecentOutcomes) || maxRecentOutcomes < 1) {
        throw new Error('maxRecentOutcomes must be a positive safe integer');
    }

    const inFlight = new Map<string, InFlightGossip>();
    const recentOutcomes = new Map<string, RecentGossipOutcome>();
    const repairNeeded = new Map<string, PendingRepair>();
    const activeWork = new Set<Promise<unknown>>();
    let admittedGossip = 0;
    let repairYieldNeeded = false;
    let repairWork: Promise<void> | null = null;
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

    function pruneExpiredOutcomes(at = now()): void {
        for (const [hash, outcome] of recentOutcomes) {
            if (outcome.kind === 'retry' && outcome.retryAfter <= at) {
                recentOutcomes.delete(hash);
            }
        }
    }

    function rememberOutcome(hash: string, outcome: RecentGossipOutcome): void {
        recentOutcomes.delete(hash);
        recentOutcomes.set(hash, outcome);
        if (recentOutcomes.size > maxRecentOutcomes) {
            pruneExpiredOutcomes();
        }
        while (recentOutcomes.size > maxRecentOutcomes) {
            const oldest = recentOutcomes.keys().next().value!;
            recentOutcomes.delete(oldest);
        }
    }

    function getRecentOutcome(hash: string): RecentGossipOutcome | undefined {
        const outcome = recentOutcomes.get(hash);
        if (outcome?.kind === 'retry' && outcome.retryAfter <= now()) {
            recentOutcomes.delete(hash);
            return undefined;
        }
        return outcome;
    }

    function connectedSource(source: GossipSource): GossipSource | undefined {
        const connection = options.getConnection(source.peerKey);
        return connection ? { peerKey: source.peerKey, connection } : undefined;
    }

    function rememberRepair(source: GossipSource): boolean {
        const connected = connectedSource(source);
        if (!connected) {
            return false;
        }
        const existing = repairNeeded.get(connected.peerKey);
        repairNeeded.set(connected.peerKey, {
            connection: connected.connection,
        });
        return !existing;
    }

    function rememberRetry(hash: string, source?: GossipSource): boolean {
        rememberOutcome(hash, {
            kind: 'retry',
            retryAfter: now() + options.repairIntervalMs,
        });
        return source ? rememberRepair(source) : false;
    }

    function chooseRepairSource(batch: InFlightGossip): GossipSource | undefined {
        return connectedSource(batch.source)
            ?? (batch.alternative ? connectedSource(batch.alternative) : undefined);
    }

    async function attemptOldestRepair(): Promise<void> {
        for (const [peerKey, recorded] of repairNeeded) {
            const connection = options.getConnection(peerKey);
            if (!connection) {
                repairNeeded.delete(peerKey);
                continue;
            }
            if (connection !== recorded.connection) {
                recorded.connection = connection;
            }
            if (await options.requestRepair(peerKey, connection)) {
                if (repairNeeded.get(peerKey) === recorded) {
                    repairNeeded.delete(peerKey);
                }
            }
            return;
        }
    }

    function startRepairOpportunity(): Promise<void> {
        if (!accepting || admittedGossip > 0 || repairWork) {
            return repairWork ?? Promise.resolve();
        }
        repairYieldNeeded = false;
        const work = (async () => {
            try {
                await attemptOldestRepair();
            }
            catch (error) {
                log.error({ error }, 'queue gossip repair attempt failed');
            }
        })();
        repairWork = work;
        activeWork.add(work);
        work.finally(() => {
            if (repairWork === work) {
                repairWork = null;
            }
            activeWork.delete(work);
            if (repairYieldNeeded && admittedGossip === 0) {
                void startRepairOpportunity();
            }
        });
        return work;
    }

    function noteAdmissionDrop(hash: string, source: GossipSource): void {
        if (!rememberRetry(hash, source)) {
            return;
        }
        repairYieldNeeded = true;
        if (admittedGossip === 0) {
            void startRepairOpportunity();
        }
    }

    function rememberAlternative(batch: InFlightGossip, source: GossipSource): void {
        if (batch.source.peerKey === source.peerKey) {
            batch.source = source;
            return;
        }
        if ((!batch.alternative || !connectedSource(batch.alternative))
            && options.getConnection(source.peerKey) === source.connection) {
            batch.alternative = source;
        }
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

        const source = { peerKey, connection };
        const batchHash = options.cipher.hashJSON(page.value.operations);
        const recent = getRecentOutcome(batchHash);
        if (recent?.kind === 'completed') {
            return;
        }
        if (recent?.kind === 'retry') {
            return;
        }
        const existing = inFlight.get(batchHash);
        if (existing) {
            rememberAlternative(existing, source);
            return;
        }
        if (repairYieldNeeded || admittedGossip >= MAX_ADMITTED_GOSSIP) {
            noteAdmissionDrop(batchHash, source);
            return;
        }
        const reservation = options.operationPages.reserve(page.value.bytes);
        if (!reservation) {
            noteAdmissionDrop(batchHash, source);
            return;
        }

        const current: InFlightGossip = { source };
        inFlight.set(batchHash, current);
        admittedGossip += 1;
        try {
            let imported;
            try {
                imported = await options.getImportPipeline().enqueue({
                    kind: 'remote',
                    name: peerKey,
                    node: message.node,
                    data: page.value.operations,
                    queueGossip: true,
                });
            }
            catch (error) {
                rememberRetry(batchHash, chooseRepairSource(current));
                log.error({ error, peer: peerKey }, 'queue gossip import failed');
                return;
            }
            if (imported.retryable) {
                const repairSource = chooseRepairSource(current);
                rememberRetry(batchHash, repairSource);
                return;
            }

            const handledIds = new Set([...imported.knownIds, ...imported.persistedIds]);
            const complete = imported.pendingIds.length === 0
                && imported.capacityDeferredIds.length === 0
                && imported.unaddressableOperations.length === 0
                && page.value.operations.every(operation => {
                    const mapped = mapOperationToSyncKey(operation);
                    return mapped.ok
                        && hasContentVerifiedOperationId(operation, options.cipher)
                        && handledIds.has(mapped.value.idHex);
                });
            if (complete) {
                rememberOutcome(batchHash, { kind: 'completed' });
            }
            else {
                const repairSource = chooseRepairSource(current);
                rememberRetry(batchHash, repairSource);
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
            if (inFlight.get(batchHash) === current) {
                inFlight.delete(batchHash);
            }
            admittedGossip -= 1;
            reservation.release();
            if (repairYieldNeeded && admittedGossip === 0) {
                void startRepairOpportunity();
            }
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
                rememberOutcome(options.cipher.hashJSON(page), { kind: 'completed' });
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
        handleDisconnected(
            peerKey: string,
            reason: string,
            connection: ConnectionInfo,
        ): void {
            if (reason === 'connection_replaced') {
                return;
            }
            const current = options.getConnection(peerKey);
            if (!current || current === connection) {
                repairNeeded.delete(peerKey);
            }
        },
        runRepairs(): Promise<void> {
            return accepting ? startRepairOpportunity() : Promise.resolve();
        },
        shutdown(): Promise<void> {
            if (!shutdownPromise) {
                accepting = false;
                options.bulkReads.cancel(`queue:${options.registry}`);
                shutdownPromise = Promise.allSettled([...activeWork]).then(() => {
                    inFlight.clear();
                    recentOutcomes.clear();
                    repairNeeded.clear();
                    repairYieldNeeded = false;
                });
            }
            return shutdownPromise;
        },
    };
}
