import asyncLib from 'async';

import type GatekeeperClient from '@mdip/gatekeeper/client';
import type CipherNode from '@mdip/cipher/node';
import type { Operation } from '@mdip/gatekeeper/types';
import { generateCID } from '@mdip/ipfs/utils';
import { childLogger } from '@mdip/common/logger';
import { bootstrapSyncStoreFromGatekeeper, type BootstrapResult } from './bootstrap.js';
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

const log = childLogger({ service: 'hyperswarm-mediator' });
const REGISTRY = 'hyperswarm';
const GATEKEEPER_BATCH_SIZE = 100;
const KNOWN_OPERATION_LOOKUP_LIMIT = 300;
const RETRY_LOOKUP_LIMIT = 1_000;
const MAX_PENDING_SYNC_RECORDS = 1_000;
const MAX_RETRY_DELAY_IDS = 25_000;
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
}

interface RemoteImportRequest extends ImportRequestBase {
    kind: 'remote';
    node?: string;
    queueGossip?: boolean;
    cancelled?: () => boolean;
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

export interface ImportPipelineOptions {
    gatekeeper: Pick<GatekeeperClient, 'exportIndex' | 'importBatch' | 'isReady' | 'processEvents'>;
    syncStore: OperationSyncStore;
    cipher: Pick<CipherNode, 'canonicalizeJSON' | 'hashJSON'>;
    syncStats: MediatorSyncStats;
    retryDelayMs: number;
    beginStoreMutation(source: string): () => void;
    onStoreChanged(source: string): void;
}

export interface ImportPipeline {
    readonly queued: number;
    readonly running: number;
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
    let processRetryNeeded = false;
    let shutdownPromise: Promise<void> | null = null;

    async function generateOperationCid(operation: Operation): Promise<string> {
        const canonical = cipher.canonicalizeJSON(operation);
        return generateCID(JSON.parse(canonical));
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

    async function importBatch(batch: Operation[]) {
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
        const response = await gatekeeper.importBatch(events).catch(error => {
            // The server may have admitted work before its response was lost.
            processRetryNeeded = true;
            throw error;
        });
        log.debug({ durationMs: Date.now() - importStart }, 'importBatch');
        log.debug(`* ${JSON.stringify(response)}`);
        syncStats.opsRejected += response.rejected ?? 0;

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
    ): Promise<Omit<ImportQueueResult, 'knownIds'>> {
        const persistedIds = new Set<string>();
        const pendingIds = new Set<string>();
        const capacityDeferredIds = new Set<string>();
        const acceptedOperations: Operation[] = [];
        const portableTerminalOperations: Operation[] = [];
        const unaddressableOperations: Operation[] = [];
        let retryable = false;

        for (let offset = 0; offset < batch.length; offset += GATEKEEPER_BATCH_SIZE) {
            const chunk = batch.slice(offset, offset + GATEKEEPER_BATCH_SIZE);
            const imported = await importBatch(chunk);
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
            if (imported.capacityDeferredOperations.some(operation => !getVerifiedOperationId(operation))) {
                retryable = true;
            }
            const retryIds = new Set(chunk.map(mapOperationToSyncKey)
                .filter(mapped => mapped.ok)
                .map(mapped => mapped.value.idHex));
            let structuralRejected = imported.rejectedOperations;
            let capacityReported = (imported.response.capacityDeferred ?? 0) > 0
                || (imported.response.capacityDeferredIndices?.length ?? 0) > 0;

            if (imported.response.queued > 0 || processRetryNeeded) {
                try {
                    let hasMore = true;
                    while (hasMore) {
                        const processStart = Date.now();
                        const response = await gatekeeper.processEvents();
                        log.debug({ durationMs: Date.now() - processStart }, 'processEvents');
                        if (response.busy) {
                            throw new Error('gatekeeper processEvents busy');
                        }
                        const processSummary = { ...response };
                        delete processSummary.acceptedHashes;
                        delete processSummary.acceptedEvents;
                        delete processSummary.rejectedOperations;
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
                        acceptedOperations.push(...pagePersisted.acceptedOperations);
                        portableTerminalOperations.push(...pagePersisted.portableTerminalOperations);
                        unaddressableOperations.push(...pagePersisted.unaddressableOperations);
                        for (const id of pagePersisted.persistedIds) {
                            if (requestIds.has(id)) {
                                persistedIds.add(id);
                            }
                        }
                        const pageCapacityHashes = response.capacityDeferredHashes ?? [];
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
                portableTerminalOperations.push(...rejectedPersisted.portableTerminalOperations);
                unaddressableOperations.push(...rejectedPersisted.unaddressableOperations);
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
                        retryable = true;
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
        };
    }

    async function mergeWithRetryDelays(
        batch: Operation[],
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
        const merged = await mergeBatch(delayed.operations, requestIds);
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

    async function processRequest(request: ImportPipelineRequest): Promise<ImportQueueResult> {
        const result = emptyResult();
        if ((request.kind === 'remote' || request.kind === 'terminal') && request.cancelled?.()) {
            return result;
        }

        try {
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
                    Object.assign(result, await mergeWithRetryDelays(request.data));
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
                if (getVerifiedOperationId(operation)) {
                    return true;
                }
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
            const merged = await mergeWithRetryDelays(filtered.operations);
            result.persistedIds = merged.persistedIds;
            result.pendingIds = merged.pendingIds;
            result.capacityDeferredIds = merged.capacityDeferredIds;
            result.acceptedOperations = merged.acceptedOperations;
            result.portableTerminalOperations = merged.portableTerminalOperations;
            result.unaddressableOperations.push(...merged.unaddressableOperations);
            result.retryable = merged.retryable;
        }
        catch (error) {
            result.retryable = true;
            log.error({ error }, 'mergeBatch error');
        }
        return result;
    }

    const queue = asyncLib.queue<ImportPipelineRequest, ImportQueueResult>(processRequest, 1);

    async function waitForIdle(): Promise<void> {
        if (!queue.idle()) {
            await queue.drain();
        }
    }

    async function runIndexRefresh(source: string): Promise<BootstrapResult> {
        const sync = await bootstrapSyncStoreFromGatekeeper(syncStore, gatekeeper, {
            beginStoreMutation: () => beginStoreMutation(`refresh_${source}`),
        });
        if (sync.resetReason) {
            pendingSyncRecords.clear();
            terminalOperationCids.clear();
        }
        else if (pendingSyncRecords.size > 0) {
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
        return sync;
    }

    return {
        get queued(): number {
            return queue.length();
        },
        get running(): number {
            return queue.running();
        },
        enqueue(request, onComplete): Promise<ImportQueueResult> {
            if (!accepting) {
                const result = emptyResult(true);
                onComplete?.(result);
                return Promise.resolve(result);
            }
            return new Promise((resolve, reject) => {
                queue.push<ImportQueueResult>(request, (error, result) => {
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

            const refresh = runIndexRefresh(source);
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
                shutdownPromise = (async () => {
                    await waitForIdle();
                    await Promise.allSettled([...activeIndexRefreshes]);
                    pendingSyncRecords.clear();
                    terminalOperationCids.clear();
                    retryDelays.clear();
                })();
            }
            return shutdownPromise;
        },
    };
}
