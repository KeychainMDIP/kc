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
export const TERMINAL_REJECTED_SYNC_ORDER = Number.MAX_SAFE_INTEGER;

interface ImportQueueResult {
    knownIds: string[];
    persistedIds: string[];
    retryable: boolean;
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
    refreshIndex(source: string): Promise<BootstrapResult>;
    shutdown(): Promise<void>;
}

function emptyResult(retryable = false): ImportQueueResult {
    return { knownIds: [], persistedIds: [], retryable };
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
        onStoreChanged,
    } = options;
    const pendingSyncRecords = new Map<string, SyncOperationWriteRecord>();
    const terminalOperationCids = new Set<string>();
    const activeIndexRefreshes = new Set<Promise<BootstrapResult>>();
    let accepting = true;
    let shutdownPromise: Promise<void> | null = null;

    async function generateOperationCid(operation: Operation): Promise<string> {
        const canonical = cipher.canonicalizeJSON(operation);
        return generateCID(JSON.parse(canonical));
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
        const response = await gatekeeper.importBatch(events);
        log.debug({ durationMs: Date.now() - importStart }, 'importBatch');
        log.debug(`* ${JSON.stringify(response)}`);
        syncStats.opsRejected += response.rejected ?? 0;

        return partitionImportBatchOperations(batch, response.rejectedIndices);
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
    ): Promise<string[]> {
        const accepted = mapAcceptedOperationsToSyncRecords(acceptedOperations);
        const verifiedRejectedOperations = rejectedOperations.filter(
            operation => hasContentVerifiedOperationId(operation, cipher)
        );
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
            return [];
        }

        let result;
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

        for (const record of attemptedRecords) {
            if (pendingSyncRecords.get(record.id) === record) {
                pendingSyncRecords.delete(record.id);
            }
        }
        const terminalRecordIds = new Set(
            attemptedRecords
                .filter(record => record.syncOrder === TERMINAL_REJECTED_SYNC_ORDER)
                .map(record => record.id)
        );
        await recordTerminalOperationCids(
            verifiedRejectedOperations.filter(operation => {
                const mapped = mapOperationToSyncKey(operation);
                return mapped.ok && terminalRecordIds.has(mapped.value.idHex);
            }),
            source,
        );

        if (result.inserted > 0 || result.updated > 0) {
            onStoreChanged(`persist_${source}`);
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
        return attemptedRecords.map(record => record.id);
    }

    async function mergeBatch(batch: Operation[]): Promise<string[]> {
        const processCandidates: Operation[] = [];
        const structurallyRejected: Operation[] = [];

        for (let offset = 0; offset < batch.length; offset += GATEKEEPER_BATCH_SIZE) {
            const imported = await importBatch(batch.slice(offset, offset + GATEKEEPER_BATCH_SIZE));
            processCandidates.push(...imported.processCandidates);
            structurallyRejected.push(...imported.rejectedOperations);
        }

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
            processCandidates,
            response.acceptedHashes,
            response.acceptedEvents,
        );
        const rejectedToPersist = dedupeOperationsByHash([
            ...structurallyRejected,
            ...dedupeOperationsByHash(response.rejectedOperations ?? []),
        ]);
        const retryIds = new Set<string>();
        for (const operation of batch) {
            const mapped = mapOperationToSyncKey(operation);
            if (mapped.ok) {
                retryIds.add(mapped.value.idHex);
            }
        }
        return persistProcessedOperations(
            acceptedToPersist,
            rejectedToPersist,
            'mergeBatch',
            retryIds,
        );
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
                result.persistedIds = request.phase === 'persist'
                    ? await persistProcessedOperations(request.data, [], 'flushQueue')
                    : await mergeBatch(request.data);
                return result;
            }
            if (request.kind === 'terminal') {
                const filtered = await filterKnownOperations(
                    request.data,
                    syncStore,
                    KNOWN_OPERATION_LOOKUP_LIMIT,
                );
                result.knownIds = filtered.knownIds;
                if (request.cancelled?.()) {
                    return result;
                }
                const terminal = await collectTerminalOperations(filtered.operations);
                if (request.cancelled?.()) {
                    return result;
                }
                result.persistedIds = await persistProcessedOperations(
                    [],
                    terminal,
                    'negentropy_terminal_unresolved',
                );
                return result;
            }

            if (request.queueGossip) {
                syncStats.queueOpsImported += request.data.length;
                for (const sample of collectQueueDelaySamples(request.data)) {
                    addAggregateSample(syncStats.queueDelayMs, sample);
                }
            }

            const filtered = await filterKnownOperations(
                request.data,
                syncStore,
                KNOWN_OPERATION_LOOKUP_LIMIT,
            );
            result.knownIds = filtered.knownIds;
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
            result.persistedIds = await mergeBatch(filtered.operations);
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
        const sync = await bootstrapSyncStoreFromGatekeeper(syncStore, gatekeeper);
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
                })();
            }
            return shutdownPromise;
        },
    };
}
