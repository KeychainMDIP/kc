import asyncLib from 'async';

import type GatekeeperClient from '@mdip/gatekeeper/client';
import type CipherNode from '@mdip/cipher/node';
import type { EventQueueStatus, Operation } from '@mdip/gatekeeper/types';
import { generateCID } from '@mdip/ipfs/utils';
import { childLogger } from '@mdip/common/logger';
import { waitForTimeout } from '@mdip/common/utils';
import { bootstrapSyncStoreFromGatekeeper, HYPR_INDEX_SYNC_STATE_KEYS, type BootstrapResult } from './bootstrap.js';
import type { OperationSyncStore, SyncOperationWriteRecord } from './db/types.js';
import {
    addAggregateSample,
    collectQueueDelaySamples,
} from './negentropy/observability.js';
import {
    dedupeOperationsByHash,
    filterKnownOperations,
    hasContentVerifiedOperationId,
    mapAcceptedOperationsToSyncRecords,
    partitionImportBatchOperations,
    prunePersistedSyncRecords,
} from './sync-persistence.js';
import { mapOperationToSyncKey } from './sync-mapping.js';
import { resolveAcceptedOperationsToPersist } from './sync-store-mirroring.js';
import type { MediatorSyncStats } from './sync-stats.js';
import { chunkOperationsForPush, estimateOperationBytes } from './negentropy/transfer.js';

const log = childLogger({ service: 'hyperswarm-mediator' });
const REGISTRY = 'hyperswarm';
const GATEKEEPER_BATCH_SIZE = 100;
const KNOWN_OPERATION_LOOKUP_LIMIT = 300;
const RETRY_LOOKUP_LIMIT = 1_000;
const MAX_PENDING_SYNC_RECORDS = 1_000;
const PROCESSING_RECOVERY_MS = 5 * 60_000;
const STATUS_TIMEOUT_MS = 5_000;
const MAX_RECOVERY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_IDS = 25_000;
const MAX_RESULT_OPERATIONS = 300;
const MAX_RESULT_BYTES = 512 * 1024;
export const TERMINAL_REJECTED_SYNC_ORDER = Number.MAX_SAFE_INTEGER;

export interface ImportQueueResult {
    knownIds: string[];
    persistedIds: string[];
    pendingIds: string[];
    capacityDeferredIds: string[];
    acceptedOperations: Operation[];
    portableTerminalOperations: Operation[];
    unaddressableOperations: Operation[];
    retryable: boolean;
    indexEpochChanged?: boolean;
    dependencyUnavailable?: boolean;
    indexRefreshRequired?: boolean;
}

interface PersistProcessedOperationsResult {
    persistedIds: string[];
    acceptedOperations: Operation[];
    portableTerminalOperations: Operation[];
    unaddressableOperations: Operation[];
}

interface ImportRequestBase {
    name: string;
    data: Operation[];
    indexEpoch?: string;
}

export interface PersistedOperationsPage {
    acceptedOperations: Operation[];
    portableTerminalOperations: Operation[];
}

interface RemoteImportRequest extends ImportRequestBase {
    kind: 'remote';
    node?: string;
    queueGossip?: boolean;
    cancelled?: () => boolean;
    onPersistedPage?: (page: PersistedOperationsPage) => Promise<void>;
}

interface LocalQueueImportRequest extends ImportRequestBase {
    kind: 'local_queue';
    phase: 'persist' | 'merge';
}

interface TerminalImportRequest extends ImportRequestBase {
    kind: 'terminal';
    cancelled?: () => boolean;
}

type ImportPipelineRequest =
    | RemoteImportRequest
    | LocalQueueImportRequest
    | TerminalImportRequest;

type PipelineWork =
    | { kind: 'import'; request: ImportPipelineRequest; indexEpoch?: string }
    | { kind: 'refresh'; source: string };

export interface ImportPipelineOptions {
    gatekeeper: Pick<GatekeeperClient, 'exportIndex' | 'importBatch' | 'isReady' | 'processEvents' | 'getStatus'>;
    signal?: AbortSignal;
    syncStore: OperationSyncStore;
    cipher: Pick<CipherNode, 'canonicalizeJSON' | 'hashJSON'>;
    syncStats: MediatorSyncStats;
    retryDelayMs: number;
    beginStoreMutation(source: string): () => void;
    onStoreChanged(source: string): void;
}

export interface ImportPipeline {
    readonly indexEpoch?: string;
    readonly queued: number;
    readonly running: number;
    readonly available: boolean;
    readonly recovering: boolean;
    getMetrics(): { activeRetryDelayedIds: number; persistenceRetries: number };
    enqueue(
        request: ImportPipelineRequest,
        onComplete?: (result: ImportQueueResult) => void,
    ): Promise<ImportQueueResult>;
    waitForIdle(): Promise<void>;
    filterRetryDelayedIds(ids: string[]): {
        eligibleIds: string[];
        pendingIds: string[];
        capacityDeferredIds: string[];
    };
    refreshIndex(source: string): Promise<BootstrapResult>;
    shutdown(): Promise<void>;
}

function emptyResult(retryable = false): ImportQueueResult {
    return {
        knownIds: [],
        persistedIds: [],
        pendingIds: [],
        capacityDeferredIds: [],
        acceptedOperations: [],
        portableTerminalOperations: [],
        unaddressableOperations: [],
        retryable,
    };
}

function shortName(value: string): string {
    return value.slice(0, 4) + '-' + value.slice(-4);
}

export function createImportPipeline(options: ImportPipelineOptions): ImportPipeline {
    const {
        gatekeeper,
        syncStore,
        cipher,
        syncStats,
        retryDelayMs,
        beginStoreMutation,
        onStoreChanged,
    } = options;
    const pendingSyncRecords = new Map<string, SyncOperationWriteRecord>();
    const retryDelays = new Map<string, { kind: 'pending' | 'capacity'; deadline: number }>();
    const terminalOperationCids = new Set<string>();
    const activeIndexRefreshes = new Set<Promise<BootstrapResult>>();
    let accepting = true;
    let indexEpoch: string | undefined;
    let invalidatedEpoch: string | undefined;
    let processRetryNeeded = false;
    let shutdownPromise: Promise<void> | null = null;
    let processingState: 'ready' | 'recovering' | 'paused' = 'ready';
    let recoveryGeneration = 0;
    let mirroredRecoveryGeneration = 0;
    let nextRecoveryProbeAt = 0;
    let lastProcessingQueue: EventQueueStatus | undefined;
    const recoveryAbort = new AbortController();
    const recoverySignal = options.signal
        ? AbortSignal.any([options.signal, recoveryAbort.signal])
        : recoveryAbort.signal;

    function processingUnavailable(): Error {
        return Object.assign(new Error('Gatekeeper processing is unavailable'), {
            code: 'gatekeeper_processing_unavailable',
        });
    }

    async function processingIdle(): Promise<boolean> {
        nextRecoveryProbeAt = Date.now() + MAX_RECOVERY_DELAY_MS;
        try {
            const status = await gatekeeper.getStatus({
                timeoutMs: STATUS_TIMEOUT_MS,
                maxResponseBytes: 64 * 1024,
                signal: recoverySignal,
            });
            const state = status?.eventsQueue;
            lastProcessingQueue = state && typeof state.active === 'boolean'
                && [state.staged, state.pending, state.processing, state.total].every(count => Number.isSafeInteger(count) && count >= 0)
                ? { staged: state.staged, pending: state.pending, processing: state.processing, total: state.total, active: state.active }
                : undefined;
            return state?.active === false;
        }
        catch (err) {
            recoverySignal.throwIfAborted();
            log.debug({ err }, 'Gatekeeper processing recovery probe failed');
            return false;
        }
    }

    async function processEvents(expectedIndexEpoch: string | undefined, source: string) {
        let recoveryStartedAt: number | undefined;
        let delayMs = 1_000;
        try {
            for (;;) {
                recoverySignal.throwIfAborted();
                assertCurrentEpoch(expectedIndexEpoch);
                try {
                    const response = expectedIndexEpoch === undefined
                        ? await gatekeeper.processEvents()
                        : await gatekeeper.processEvents(expectedIndexEpoch);
                    assertCurrentEpoch(expectedIndexEpoch);
                    if (!response.busy) {
                        if (recoveryStartedAt !== undefined) {
                            processingState = 'ready';
                            log.info({ source, expectedIndexEpoch, durationMs: Date.now() - recoveryStartedAt, eventsQueue: lastProcessingQueue },
                                'Gatekeeper processing recovered');
                        }
                        return { response, recovered: recoveryStartedAt !== undefined };
                    }
                }
                catch (err) {
                    // GatekeeperClient exposes request deadlines as strings, not Axios errors.
                    if (typeof err !== 'string' || !/^timeout of \d+ms exceeded$/.test(err)) throw err;
                }

                if (recoveryStartedAt === undefined) {
                    recoveryStartedAt = Date.now();
                    lastProcessingQueue = undefined;
                    processingState = 'recovering';
                    recoveryGeneration += 1;
                    log.warn({ source, expectedIndexEpoch }, 'Waiting for Gatekeeper processing after timeout or busy response');
                }
                for (;;) {
                    recoverySignal.throwIfAborted();
                    const remainingMs = PROCESSING_RECOVERY_MS - (Date.now() - recoveryStartedAt);
                    if (remainingMs <= 0) throw processingUnavailable();
                    await waitForTimeout(Math.min(delayMs, remainingMs), recoverySignal);
                    if (Date.now() - recoveryStartedAt >= PROCESSING_RECOVERY_MS) throw processingUnavailable();
                    const idle = await processingIdle();
                    if (Date.now() - recoveryStartedAt >= PROCESSING_RECOVERY_MS) throw processingUnavailable();
                    delayMs = Math.min(delayMs * 2, MAX_RECOVERY_DELAY_MS);
                    if (idle) break;
                }
            }
        }
        finally {
            if (processingState === 'recovering') {
                processingState = 'paused';
                if (!recoverySignal.aborted) {
                    log.warn({ source, expectedIndexEpoch, durationMs: Date.now() - recoveryStartedAt!, eventsQueue: lastProcessingQueue },
                        'Gatekeeper processing recovery interrupted, imports paused until index refresh');
                }
            }
        }
    }

    async function generateOperationCid(operation: Operation): Promise<string> {
        const canonical = cipher.canonicalizeJSON(operation);
        return generateCID(JSON.parse(canonical));
    }

    function assertCurrentEpoch(expected?: string): void {
        if (expected !== undefined && (expected !== indexEpoch || expected === invalidatedEpoch)) {
            throw Object.assign(new Error('Synchronization work belongs to an old Gatekeeper epoch'), {
                code: 'stale_import_epoch',
            });
        }
    }

    function getVerifiedOperationId(operation: Operation): string | undefined {
        const mapped = mapOperationToSyncKey(operation);
        return mapped.ok && hasContentVerifiedOperationId(operation, cipher)
            ? mapped.value.idHex
            : undefined;
    }

    function recordRetryDelay(ids: Iterable<string>, kind: 'pending' | 'capacity'): void {
        const deadline = Date.now() + retryDelayMs;
        for (const id of new Set(ids)) {
            retryDelays.delete(id);
            retryDelays.set(id, { kind, deadline });
            while (retryDelays.size > MAX_RETRY_DELAY_IDS) {
                const oldestId = retryDelays.keys().next().value!;
                retryDelays.delete(oldestId);
                syncStats.hardening.retryDelayEvictions += 1;
            }
        }
    }

    function clearRetryDelays(ids: Iterable<string>): void {
        for (const id of ids) {
            retryDelays.delete(id);
        }
    }

    function filterRetryDelayedOperations(operations: Operation[]): {
        operations: Operation[];
        pendingIds: string[];
        capacityDeferredIds: string[];
    } {
        const now = Date.now();
        const eligible: Operation[] = [];
        const pendingIds: string[] = [];
        const capacityDeferredIds: string[] = [];

        for (const operation of operations) {
            const id = getVerifiedOperationId(operation);
            const delayed = id ? retryDelays.get(id) : undefined;
            if (!delayed || delayed.deadline <= now) {
                if (id && delayed) {
                    retryDelays.delete(id);
                }
                eligible.push(operation);
                continue;
            }
            (delayed.kind === 'pending' ? pendingIds : capacityDeferredIds).push(id!);
        }

        return {
            operations: eligible,
            pendingIds: Array.from(new Set(pendingIds)),
            capacityDeferredIds: Array.from(new Set(capacityDeferredIds)),
        };
    }

    function filterRetryDelayedIds(ids: string[]): {
        eligibleIds: string[];
        pendingIds: string[];
        capacityDeferredIds: string[];
    } {
        const now = Date.now();
        const eligibleIds: string[] = [];
        const pendingIds: string[] = [];
        const capacityDeferredIds: string[] = [];

        for (const id of ids) {
            const delayed = retryDelays.get(id);
            if (!delayed || delayed.deadline <= now) {
                if (delayed) {
                    retryDelays.delete(id);
                }
                eligibleIds.push(id);
                continue;
            }
            (delayed.kind === 'pending' ? pendingIds : capacityDeferredIds).push(id);
        }

        return { eligibleIds, pendingIds, capacityDeferredIds };
    }

    async function importBatch(batch: Operation[], expectedIndexEpoch?: string) {
        const hash = cipher.hashJSON(batch);
        const now = new Date();
        const isoTime = now.toISOString();
        const ordTime = now.getTime();
        const events = batch.map((operation, index) => ({
            registry: REGISTRY,
            time: isoTime,
            ordinal: [ordTime, index],
            operation,
        }));

        log.debug(`importBatch: ${shortName(hash)} merging ${events.length} events...`);
        const importStart = Date.now();
        const response = await (expectedIndexEpoch === undefined
            ? gatekeeper.importBatch(events)
            : gatekeeper.importBatch(events, expectedIndexEpoch)).catch(error => {
            // The server may have admitted work before its response was lost.
            processRetryNeeded = true;
            throw error;
        });
        log.debug({ durationMs: Date.now() - importStart }, 'importBatch');
        log.debug(`* ${JSON.stringify(response)}`);
        syncStats.opsRejected += response.rejected ?? 0;
        syncStats.hardening.gatekeeperCapacityOutcomes += response.capacityDeferred
            ?? response.capacityDeferredIndices?.length ?? 0;

        return {
            response,
            ...partitionImportBatchOperations(
                batch,
                response.rejectedIndices,
                response.capacityDeferredIndices,
                response.processedIndices,
            ),
        };
    }

    async function recordTerminalOperationCids(operations: Operation[], source: string): Promise<void> {
        for (const operation of operations) {
            try {
                terminalOperationCids.add(await generateOperationCid(operation));
            }
            catch (error) {
                log.warn({ error, source }, 'failed to record terminal operation CID');
            }
        }
    }

    async function persistProcessedOperations(
        acceptedOperations: Operation[],
        rejectedOperations: Operation[],
        source: string,
        retryIds: Iterable<string> = [],
    ): Promise<PersistProcessedOperationsResult> {
        const accepted = mapAcceptedOperationsToSyncRecords(acceptedOperations);
        const verifiedRejectedOperations: Operation[] = [];
        const unaddressableOperations: Operation[] = [];
        for (const operation of rejectedOperations) {
            (hasContentVerifiedOperationId(operation, cipher)
                ? verifiedRejectedOperations
                : unaddressableOperations).push(operation);
        }
        const rejectedHashMismatches = rejectedOperations.length - verifiedRejectedOperations.length;
        const rejected = mapAcceptedOperationsToSyncRecords(verifiedRejectedOperations.map(operation => ({
            operation,
            syncOrder: TERMINAL_REJECTED_SYNC_ORDER,
        })));
        if (rejectedHashMismatches > 0) {
            log.warn(
                { source, rejectedHashMismatches },
                'skipping terminal sync records with unverified operation IDs'
            );
        }

        const records = [...rejected.records, ...accepted.records];
        const invalid = accepted.invalid + rejected.invalid;
        const operationCount = acceptedOperations.length + rejectedOperations.length;
        const recordsToPersist = new Map<string, SyncOperationWriteRecord>();
        for (const record of records) {
            pendingSyncRecords.delete(record.id);
            pendingSyncRecords.set(record.id, record);
            recordsToPersist.set(record.id, record);
        }

        let retryCandidates = 0;
        for (const id of new Set(retryIds)) {
            const pending = pendingSyncRecords.get(id);
            if (!pending || recordsToPersist.has(id)) {
                continue;
            }
            retryCandidates += 1;
            recordsToPersist.set(id, pending);
        }

        const attemptedRecords = Array.from(recordsToPersist.values());
        if (attemptedRecords.length === 0) {
            log.debug({
                source,
                accepted: acceptedOperations.length,
                rejected: rejectedOperations.length,
                rejectedHashMismatches,
                attempted: operationCount,
                invalid,
            }, 'sync-store persist skipped');
            return {
                persistedIds: [],
                acceptedOperations: [],
                portableTerminalOperations: [],
                unaddressableOperations,
            };
        }

        let result;
        const storeChangeSource = `persist_${source}`;
        const finishStoreMutation = beginStoreMutation(storeChangeSource);
        try {
            result = await syncStore.upsertMany(attemptedRecords);
        }
        catch (error) {
            const pendingBeforeTrim = pendingSyncRecords.size;
            while (pendingSyncRecords.size > MAX_PENDING_SYNC_RECORDS) {
                const oldestId = pendingSyncRecords.keys().next().value;
                if (oldestId === undefined) {
                    break;
                }
                pendingSyncRecords.delete(oldestId);
            }
            log.error(
                {
                    error,
                    source,
                    accepted: acceptedOperations.length,
                    rejected: rejectedOperations.length,
                    rejectedHashMismatches,
                    attempted: operationCount,
                    mapped: records.length,
                    retryCandidates,
                    recordsAttempted: attemptedRecords.length,
                    pending: pendingSyncRecords.size,
                    pendingEvicted: pendingBeforeTrim - pendingSyncRecords.size,
                },
                'sync-store persist processed ops failed'
            );
            throw error;
        }
        finally {
            finishStoreMutation();
        }

        for (const record of attemptedRecords) {
            if (pendingSyncRecords.get(record.id) === record) {
                pendingSyncRecords.delete(record.id);
            }
        }
        const portableTerminalOperations = attemptedRecords
            .filter(record => record.syncOrder === TERMINAL_REJECTED_SYNC_ORDER)
            .map(record => record.operation);
        const persistedAcceptedOperations = attemptedRecords
            .filter(record => record.syncOrder !== TERMINAL_REJECTED_SYNC_ORDER)
            .map(record => record.operation);
        await recordTerminalOperationCids(portableTerminalOperations, source);
        syncStats.hardening.terminalRecordsPersisted += portableTerminalOperations.length;

        if (result.inserted > 0 || result.updated > 0) {
            onStoreChanged(storeChangeSource);
        }
        log.debug(
            {
                source,
                accepted: acceptedOperations.length,
                rejected: rejectedOperations.length,
                rejectedHashMismatches,
                attempted: operationCount,
                mapped: records.length,
                retryCandidates,
                recordsAttempted: attemptedRecords.length,
                pendingRemaining: pendingSyncRecords.size,
                invalid,
                inserted: result.inserted,
                updated: result.updated,
            },
            'sync-store persist processed ops'
        );
        const persistedIds = attemptedRecords.map(record => record.id);
        clearRetryDelays(persistedIds);
        return {
            persistedIds,
            acceptedOperations: persistedAcceptedOperations,
            portableTerminalOperations,
            unaddressableOperations,
        };
    }

    async function mergeBatch(
        batch: Operation[],
        requestIds: Set<string>,
        expectedIndexEpoch?: string,
        cancelled?: () => boolean,
        source = 'local_queue',
        onPersistedPage?: RemoteImportRequest['onPersistedPage'],
    ): Promise<Omit<ImportQueueResult, 'knownIds'>> {
        const persistedIds = new Set<string>();
        const pendingIds = new Set<string>();
        const capacityDeferredIds = new Set<string>();
        const acceptedOperations: Operation[] = [];
        const portableTerminalOperations: Operation[] = [];
        const unaddressableOperations: Operation[] = [];
        let requestFingerprints: Set<string> | undefined;
        const resultKeys = new Set<string>();
        let resultBytes = 0;
        let retryable = false;
        let indexRefreshRequired = false;

        function retainResult(operation: Operation, target: Operation[], key: string): void {
            if (resultKeys.has(key)) return;
            const bytes = estimateOperationBytes(operation);
            if (resultKeys.size >= MAX_RESULT_OPERATIONS || resultBytes + bytes > MAX_RESULT_BYTES) return;
            resultKeys.add(key);
            resultBytes += bytes;
            target.push(operation);
        }

        async function publishPersistedPage(persisted: PersistProcessedOperationsResult): Promise<void> {
            for (const operation of persisted.unaddressableOperations) {
                requestFingerprints ??= new Set(batch.map(item => cipher.hashJSON(item)));
                const fingerprint = cipher.hashJSON(operation);
                if (requestFingerprints.has(fingerprint)) {
                    retainResult(operation, unaddressableOperations, `operation:${fingerprint}`);
                }
            }
            if (onPersistedPage) {
                const accepted = new Set(persisted.acceptedOperations);
                for (const operations of chunkOperationsForPush([
                    ...persisted.acceptedOperations,
                    ...persisted.portableTerminalOperations,
                ], { maxOpsPerPush: MAX_RESULT_OPERATIONS, maxBytesPerPush: MAX_RESULT_BYTES })) {
                    await onPersistedPage({
                        acceptedOperations: operations.filter(operation => accepted.has(operation)),
                        portableTerminalOperations: operations.filter(operation => !accepted.has(operation)),
                    });
                }
                return;
            }
            for (const [operations, target] of [
                [persisted.acceptedOperations, acceptedOperations],
                [persisted.portableTerminalOperations, portableTerminalOperations],
            ] as const) {
                for (const operation of operations) {
                    const id = getVerifiedOperationId(operation);
                    if (id && requestIds.has(id)) retainResult(operation, target, `id:${id}`);
                }
            }
        }

        for (let offset = 0; offset < batch.length || processRetryNeeded; offset += GATEKEEPER_BATCH_SIZE) {
            assertCurrentEpoch(expectedIndexEpoch);
            if (cancelled?.()) break;
            const chunk = batch.slice(offset, offset + GATEKEEPER_BATCH_SIZE);
            const imported = chunk.length > 0 ? await importBatch(chunk, expectedIndexEpoch) : {
                response: {
                    queued: 0, processed: 0, rejected: 0, total: 0, rejectedIndices: [] as number[],
                    capacityDeferred: 0, capacityDeferredIndices: [] as number[], processedIndices: [] as number[],
                },
                processCandidates: [], processedOperations: [], rejectedOperations: [], capacityDeferredOperations: [],
            };
            assertCurrentEpoch(expectedIndexEpoch);
            const chunkIds = new Set(chunk.map(getVerifiedOperationId).filter((id): id is string => !!id));
            const provisionalIds = new Set([
                ...imported.processCandidates,
                ...imported.processedOperations,
            ].map(getVerifiedOperationId).filter((id): id is string => !!id));
            const chunkCapacityIds = new Set(
                imported.capacityDeferredOperations
                    .map(getVerifiedOperationId)
                    .filter((id): id is string => !!id)
            );
            const retryIds = new Set(chunk.map(mapOperationToSyncKey)
                .filter(mapped => mapped.ok)
                .map(mapped => mapped.value.idHex));
            let structuralRejected = imported.rejectedOperations;
            let capacityReported = (imported.response.capacityDeferred ?? 0) > 0
                || (imported.response.capacityDeferredIndices?.length ?? 0) > 0;

            if (imported.response.queued > 0 || imported.response.processed > 0 || capacityReported || processRetryNeeded) {
                try {
                    let hasMore = true;
                    while (hasMore) {
                        const processStart = Date.now();
                        const { response, recovered } = await processEvents(expectedIndexEpoch, source);
                        assertCurrentEpoch(expectedIndexEpoch);
                        indexRefreshRequired ||= recovered;
                        log.debug({ durationMs: Date.now() - processStart }, 'processEvents');
                        const processSummary = { ...response };
                        delete processSummary.acceptedHashes;
                        delete processSummary.acceptedEvents;
                        delete processSummary.rejectedOperations;
                        delete processSummary.rejectedEvents;
                        log.debug(`mergeBatch: ${JSON.stringify(processSummary)}`);
                        syncStats.opsApplied += (response.added ?? 0) + (response.merged ?? 0);
                        syncStats.opsRejected += response.rejected ?? 0;

                        const acceptedToPersist = resolveAcceptedOperationsToPersist(
                            imported.processCandidates,
                            response.acceptedHashes,
                            response.acceptedEvents,
                        );
                        const rejectedToPersist = dedupeOperationsByHash([
                            ...structuralRejected,
                            ...dedupeOperationsByHash(response.rejectedOperations ?? []),
                        ]);
                        structuralRejected = [];
                        const pagePersisted = await persistProcessedOperations(
                            acceptedToPersist,
                            rejectedToPersist,
                            'mergeBatch',
                            retryIds,
                        );
                        await publishPersistedPage(pagePersisted);
                        for (const id of pagePersisted.persistedIds) {
                            if (requestIds.has(id)) {
                                persistedIds.add(id);
                            }
                        }
                        const pageCapacityHashes = response.capacityDeferredHashes ?? [];
                        syncStats.hardening.gatekeeperCapacityOutcomes += response.capacityDeferred
                            ?? pageCapacityHashes.length;
                        let chunkCapacityReported = false;
                        for (const hash of pageCapacityHashes) {
                            const id = hash.toLowerCase();
                            if (chunkIds.has(id)) {
                                chunkCapacityIds.add(id);
                                chunkCapacityReported = true;
                            }
                        }
                        // Without hashes, an older response cannot attribute backpressure to a request.
                        capacityReported ||= chunkCapacityReported
                            || (response.capacityDeferred ?? 0) > 0 && pageCapacityHashes.length === 0;
                        hasMore = response.hasMore === true;
                    }
                    processRetryNeeded = false;
                }
                catch (error) {
                    processRetryNeeded = true;
                    throw error;
                }
            }
            else if (structuralRejected.length > 0) {
                const rejectedPersisted = await persistProcessedOperations(
                    [],
                    structuralRejected,
                    'mergeBatch',
                    retryIds,
                );
                await publishPersistedPage(rejectedPersisted);
                for (const id of rejectedPersisted.persistedIds) {
                    if (requestIds.has(id)) {
                        persistedIds.add(id);
                    }
                }
            }

            for (const id of chunkCapacityIds) {
                if (!persistedIds.has(id)) {
                    capacityDeferredIds.add(id);
                }
            }
            for (const id of provisionalIds) {
                if (!persistedIds.has(id) && !capacityDeferredIds.has(id)) {
                    pendingIds.add(id);
                }
            }

            if (capacityReported) {
                for (const operation of batch.slice(offset + chunk.length)) {
                    const id = getVerifiedOperationId(operation);
                    if (id) {
                        capacityDeferredIds.add(id);
                    }
                    else {
                        const fingerprint = cipher.hashJSON(operation);
                        retainResult(operation, unaddressableOperations, `operation:${fingerprint}`);
                    }
                }
                break;
            }
        }

        for (const id of persistedIds) {
            pendingIds.delete(id);
            capacityDeferredIds.delete(id);
        }
        recordRetryDelay(pendingIds, 'pending');
        recordRetryDelay(capacityDeferredIds, 'capacity');
        clearRetryDelays(persistedIds);

        return {
            persistedIds: Array.from(persistedIds),
            pendingIds: Array.from(pendingIds),
            capacityDeferredIds: Array.from(capacityDeferredIds),
            acceptedOperations: dedupeOperationsByHash(acceptedOperations),
            portableTerminalOperations: dedupeOperationsByHash(portableTerminalOperations),
            unaddressableOperations,
            retryable,
            ...(indexRefreshRequired && { indexRefreshRequired: true }),
        };
    }

    async function mergeWithRetryDelays(
        batch: Operation[], expectedIndexEpoch?: string, cancelled?: () => boolean, source = 'local_queue',
        onPersistedPage?: RemoteImportRequest['onPersistedPage'],
    ): Promise<Omit<ImportQueueResult, 'knownIds'>> {
        const delayed = filterRetryDelayedOperations(batch);
        if (delayed.operations.length === 0) {
            return {
                persistedIds: [],
                pendingIds: delayed.pendingIds,
                capacityDeferredIds: delayed.capacityDeferredIds,
                acceptedOperations: [],
                portableTerminalOperations: [],
                unaddressableOperations: [],
                retryable: false,
            };
        }

        const requestIds = new Set(batch.map(getVerifiedOperationId).filter((id): id is string => !!id));
        const merged = await mergeBatch(
            delayed.operations, requestIds, expectedIndexEpoch, cancelled, source, onPersistedPage,
        );
        const persistedIds = new Set(merged.persistedIds);
        return {
            persistedIds: merged.persistedIds,
            pendingIds: Array.from(new Set([...delayed.pendingIds, ...merged.pendingIds]))
                .filter(id => !persistedIds.has(id)),
            capacityDeferredIds: Array.from(new Set([
                ...delayed.capacityDeferredIds,
                ...merged.capacityDeferredIds,
            ])).filter(id => !persistedIds.has(id)),
            acceptedOperations: merged.acceptedOperations,
            portableTerminalOperations: merged.portableTerminalOperations,
            unaddressableOperations: merged.unaddressableOperations,
            retryable: merged.retryable,
            ...(merged.indexRefreshRequired && { indexRefreshRequired: true }),
        };
    }

    async function collectTerminalOperations(operations: Operation[]): Promise<Operation[]> {
        const operationsByPrevid = new Map<string, Array<{ id: string; operation: Operation }>>();
        const selected = new Map<string, Operation>();
        const queuedCids = new Set<string>();
        const cidQueue: string[] = [];
        const queueCid = (cid: string): void => {
            if (!queuedCids.has(cid)) {
                queuedCids.add(cid);
                cidQueue.push(cid);
            }
        };

        for (const cid of terminalOperationCids) {
            queueCid(cid);
        }

        for (const operation of operations) {
            const mapped = mapOperationToSyncKey(operation);
            if (!mapped.ok || !hasContentVerifiedOperationId(operation, cipher)) {
                continue;
            }
            if (operation.type !== 'create' && operation.previd === undefined) {
                selected.set(mapped.value.idHex, operation);
                try {
                    queueCid(await generateOperationCid(operation));
                }
                catch (error) {
                    log.warn({ error, id: mapped.value.idHex }, 'failed to derive terminal legacy operation CID');
                }
                continue;
            }
            if (typeof operation.previd === 'string') {
                const children = operationsByPrevid.get(operation.previd) ?? [];
                children.push({ id: mapped.value.idHex, operation });
                operationsByPrevid.set(operation.previd, children);
            }
        }

        for (let queueIndex = 0; queueIndex < cidQueue.length; queueIndex += 1) {
            const cid = cidQueue[queueIndex];
            for (const child of operationsByPrevid.get(cid) ?? []) {
                if (selected.has(child.id)) {
                    continue;
                }
                selected.set(child.id, child.operation);
                try {
                    queueCid(await generateOperationCid(child.operation));
                }
                catch (error) {
                    log.warn({ error, id: child.id }, 'failed to derive terminal fork descendant CID');
                }
            }
        }

        return Array.from(selected.values());
    }

    async function processRequest(request: ImportPipelineRequest, expectedIndexEpoch?: string): Promise<ImportQueueResult> {
        const result = emptyResult();
        if ((request.kind === 'remote' || request.kind === 'terminal') && request.cancelled?.()) {
            return result;
        }

        try {
            assertCurrentEpoch(expectedIndexEpoch);
            if (processingState !== 'ready') return { ...emptyResult(true), dependencyUnavailable: true };
            if (request.kind === 'remote' && !await gatekeeper.isReady()) {
                return emptyResult(true);
            }
            if (request.data.length === 0) {
                return result;
            }

            if (request.kind === 'local_queue') {
                if (request.phase === 'persist') {
                    Object.assign(result, await persistProcessedOperations(request.data, [], 'flushQueue'));
                }
                else {
                    Object.assign(result, await mergeWithRetryDelays(request.data, expectedIndexEpoch));
                }
                return result;
            }
            if (request.kind === 'terminal') {
                const filtered = await filterKnownOperations(
                    request.data,
                    syncStore,
                    KNOWN_OPERATION_LOOKUP_LIMIT,
                );
                result.knownIds = filtered.knownIds;
                clearRetryDelays(result.knownIds);
                if (request.cancelled?.()) {
                    return result;
                }
                const terminal = await collectTerminalOperations(filtered.operations);
                if (request.cancelled?.()) {
                    return result;
                }
                Object.assign(result, await persistProcessedOperations(
                    [],
                    terminal,
                    'negentropy_terminal_unresolved',
                ));
                return result;
            }

            if (request.queueGossip) {
                syncStats.queueOpsImported += request.data.length;
                for (const sample of collectQueueDelaySamples(request.data)) {
                    addAggregateSample(syncStats.queueDelayMs, sample);
                }
            }

            const addressableOperations = request.data.filter(operation => {
                if (getVerifiedOperationId(operation)) return true;
                result.unaddressableOperations.push(operation);
                return false;
            });
            const filtered = await filterKnownOperations(
                addressableOperations,
                syncStore,
                KNOWN_OPERATION_LOOKUP_LIMIT,
            );
            result.knownIds = filtered.knownIds;
            clearRetryDelays(result.knownIds);
            if (filtered.known > 0) {
                log.debug(
                    {
                        peer: shortName(request.name),
                        node: request.node || 'anon',
                        received: request.data.length,
                        forwarded: filtered.operations.length,
                        knownDropped: filtered.known,
                        mapped: filtered.mapped,
                        invalid: filtered.invalid,
                    },
                    'filtered inbound operations against sync-store'
                );
            }
            if (filtered.operations.length === 0) {
                return result;
            }

            log.debug(
                `* merging batch (${filtered.operations.length}/${request.data.length} events) from: ${shortName(request.name)} (${request.node || 'anon'}) *`
            );
            const merged = await mergeWithRetryDelays(
                filtered.operations, expectedIndexEpoch, request.cancelled, request.name, request.onPersistedPage,
            );
            result.persistedIds = merged.persistedIds;
            result.pendingIds = merged.pendingIds;
            result.capacityDeferredIds = merged.capacityDeferredIds;
            result.acceptedOperations = merged.acceptedOperations;
            result.portableTerminalOperations = merged.portableTerminalOperations;
            result.unaddressableOperations.push(...merged.unaddressableOperations);
            result.retryable = merged.retryable;
            if (merged.indexRefreshRequired) result.indexRefreshRequired = true;
        }
        catch (error) {
            result.retryable = true;
            const code = (error as { code?: string; error?: string } | null)?.code
                ?? (error as { error?: string } | null)?.error;
            if (code === 'gatekeeper_processing_unavailable') {
                result.dependencyUnavailable = true;
                return result;
            }
            if (code === 'gatekeeper_index_epoch_changed' || code === 'stale_import_epoch') {
                result.indexEpochChanged = true;
            }
            else if (processingState === 'paused') {
                result.dependencyUnavailable = true;
            }
            if (code === 'gatekeeper_index_epoch_changed') {
                invalidatedEpoch = expectedIndexEpoch;
                log.info({ expectedIndexEpoch }, 'Gatekeeper reset interrupted synchronization');
            }
            else if (recoverySignal.aborted) {
                log.debug({ err: error }, 'Gatekeeper import cancelled during shutdown');
            }
            else if (code !== 'stale_import_epoch') {
                log.error({ error, kind: request.kind, peer: shortName(request.name), operations: request.data.length },
                    'mergeBatch error');
            }
        }
        return result;
    }

    // Mirror resets and accepted-operation persistence must share the import boundary.
    const queue = asyncLib.queue<PipelineWork, ImportQueueResult | BootstrapResult>(async work => work.kind === 'refresh'
        ? runIndexRefresh(work.source)
        : processRequest(work.request, work.indexEpoch), 1);

    async function waitForIdle(): Promise<void> {
        if (!queue.idle()) {
            await queue.drain();
        }
    }

    async function runIndexRefresh(source: string): Promise<BootstrapResult> {
        if (processingState === 'paused'
            && (Date.now() < nextRecoveryProbeAt || !await processingIdle())) {
            throw processingUnavailable();
        }
        let sync: BootstrapResult;
        for (;;) {
            sync = await bootstrapSyncStoreFromGatekeeper(syncStore, gatekeeper, {
                beginStoreMutation: () => beginStoreMutation(`refresh_${source}`),
            });
            indexEpoch = (await syncStore.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.gatekeeperIndexEpoch)) ?? undefined;
            invalidatedEpoch = undefined;
            if (sync.resetReason) {
                pendingSyncRecords.clear();
                retryDelays.clear();
                processRetryNeeded = false;
                terminalOperationCids.clear();
                break;
            }
            if (!processRetryNeeded) break;
            try {
                // A lost processing response may leave shared staged work after every requested ID is known.
                await mergeBatch([], new Set<string>(), indexEpoch, undefined, source);
            }
            catch (error) {
                const code = (error as { code?: string; error?: string } | null)?.code
                    ?? (error as { error?: string } | null)?.error;
                if (code === 'gatekeeper_index_epoch_changed') invalidatedEpoch = indexEpoch;
                throw error;
            }
        }
        if (pendingSyncRecords.size > 0) {
            try {
                const pruned = await prunePersistedSyncRecords(
                    pendingSyncRecords,
                    syncStore,
                    RETRY_LOOKUP_LIMIT,
                );
                log.debug({ source, ...pruned, remaining: pendingSyncRecords.size }, 'pruned persisted sync-store retries');
            }
            catch (error) {
                log.warn(
                    { error, source, remaining: pendingSyncRecords.size },
                    'failed to prune persisted sync-store retries'
                );
            }
        }
        if (retryDelays.size > 0) {
            try {
                const ids = Array.from(retryDelays.keys());
                let removed = 0;
                for (let offset = 0; offset < ids.length; offset += RETRY_LOOKUP_LIMIT) {
                    const rows = await syncStore.getByIds(ids.slice(offset, offset + RETRY_LOOKUP_LIMIT));
                    for (const row of rows) {
                        if (retryDelays.delete(row.id)) {
                            removed += 1;
                        }
                    }
                }
                log.debug({ source, checked: ids.length, removed, remaining: retryDelays.size }, 'pruned persisted import delays');
            }
            catch (error) {
                log.warn({ error, source, remaining: retryDelays.size }, 'failed to prune persisted import delays');
            }
        }
        if (processingState === 'paused') {
            processingState = 'ready';
            log.info({ source, indexEpoch, eventsQueue: lastProcessingQueue }, 'Gatekeeper processing available after index refresh');
        }
        if (mirroredRecoveryGeneration < recoveryGeneration) {
            mirroredRecoveryGeneration = recoveryGeneration;
            return { ...sync, processingRecoveryGeneration: recoveryGeneration };
        }
        return sync;
    }

    return {
        get indexEpoch(): string | undefined {
            return indexEpoch;
        },
        getMetrics() {
            let activeRetryDelayedIds = 0;
            const at = Date.now();
            for (const delayed of retryDelays.values()) {
                if (delayed.deadline > at) {
                    activeRetryDelayedIds += 1;
                }
            }
            return { activeRetryDelayedIds, persistenceRetries: pendingSyncRecords.size };
        },
        get queued(): number {
            return queue.length();
        },
        get running(): number {
            return queue.running();
        },
        get available(): boolean {
            return processingState === 'ready';
        },
        get recovering(): boolean {
            return processingState === 'recovering';
        },
        enqueue(request, onComplete): Promise<ImportQueueResult> {
            if (!accepting || processingState === 'paused') {
                const result = { ...emptyResult(true), dependencyUnavailable: processingState === 'paused' };
                onComplete?.(result);
                return Promise.resolve(result);
            }
            return new Promise((resolve, reject) => {
                queue.push<ImportQueueResult>({ kind: 'import', request, indexEpoch: request.indexEpoch ?? indexEpoch }, (error, result) => {
                    if (error || !result) {
                        reject(error ?? new Error('import queue completed without a result'));
                        return;
                    }
                    try {
                        onComplete?.(result);
                        resolve(result);
                    }
                    catch (completionError) {
                        reject(completionError);
                    }
                });
            });
        },
        waitForIdle,
        filterRetryDelayedIds,
        refreshIndex(source): Promise<BootstrapResult> {
            if (!accepting) {
                return Promise.reject(new Error('import pipeline is shutting down'));
            }

            const refresh = new Promise<BootstrapResult>((resolve, reject) => {
                queue.push<BootstrapResult>({ kind: 'refresh', source }, (error, result) => {
                    if (error || !result) reject(error ?? new Error('index refresh completed without a result'));
                    else resolve(result);
                });
            });
            activeIndexRefreshes.add(refresh);
            refresh.then(
                () => activeIndexRefreshes.delete(refresh),
                () => activeIndexRefreshes.delete(refresh),
            );
            return refresh;
        },
        shutdown(): Promise<void> {
            if (!shutdownPromise) {
                accepting = false;
                recoveryAbort.abort();
                shutdownPromise = (async () => {
                    await waitForIdle();
                    await Promise.allSettled([...activeIndexRefreshes]);
                    pendingSyncRecords.clear();
                    retryDelays.clear();
                    terminalOperationCids.clear();
                    retryDelays.clear();
                })();
            }
            return shutdownPromise;
        },
    };
}
