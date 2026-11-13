import {
    IndexExportOperationRecord,
    IndexExportRemovedOperationRecord,
    Operation,
} from '@mdip/gatekeeper/types';
import type {
    OperationSyncStore,
    SyncOperationWriteRecord,
} from './db/types.js';
import { mapOperationToSyncKey } from './sync-mapping.js';

export interface SyncPersistenceRecord {
    id: string;
    syncOrder?: number;
    signedTs: number;
    // Compatibility alias for the current negentropy cursor/window code.
    ts: number;
    operation: Operation;
}

export interface AcceptedOperationWithSyncOrder {
    operation: Operation;
    syncOrder?: number;
}

export type AcceptedOperationInput = Operation | AcceptedOperationWithSyncOrder;

export interface MapAcceptedResult {
    records: SyncPersistenceRecord[];
    invalid: number;
}

export interface MapIndexExportChangesResult extends MapAcceptedResult {
    deleteIds: string[];
}

// shortcut: active cursors must stay below 2**52 - 1, widen ordering before reaching that range.
export const RETIRED_SYNC_ORDER_OFFSET = 2 ** 52;

function isRetiredSyncOrder(order: number | undefined): boolean {
    return order !== undefined && order >= RETIRED_SYNC_ORDER_OFFSET && order < Number.MAX_SAFE_INTEGER;
}

function requireActiveSyncOrder(order: number): number {
    if (!Number.isSafeInteger(order) || order < 0 || order >= RETIRED_SYNC_ORDER_OFFSET - 1) {
        throw new Error('Gatekeeper sync order exceeds the active history range');
    }
    return order;
}

export interface FilterKnownOperationsResult {
    operations: Operation[];
    knownIds: string[];
    mapped: number;
    known: number;
    invalid: number;
}

export function hasContentVerifiedOperationId(
    operation: Operation,
    hashProvider: { hashJSON(value: unknown): string },
): boolean {
    const claimedHash = operation.signature?.hash;
    if (typeof claimedHash !== 'string') {
        return false;
    }

    try {
        const unsignedOperation = { ...operation };
        delete unsignedOperation.signature;
        return hashProvider.hashJSON(unsignedOperation).toLowerCase() === claimedHash.toLowerCase();
    }
    catch {
        return false;
    }
}

export async function prunePersistedSyncRecords(
    pending: Map<string, SyncOperationWriteRecord>,
    syncStore: Pick<OperationSyncStore, 'getByIds'>,
    lookupChunkSize: number,
): Promise<{ checked: number; removed: number }> {
    const snapshot = new Map(pending);
    const ids = Array.from(snapshot.keys());
    let removed = 0;

    for (let i = 0; i < ids.length; i += lookupChunkSize) {
        const rows = await syncStore.getByIds(ids.slice(i, i + lookupChunkSize));
        for (const row of rows) {
            const captured = snapshot.get(row.id);
            if (captured && pending.get(row.id) === captured) {
                pending.delete(row.id);
                removed += 1;
            }
        }
    }

    return { checked: ids.length, removed };
}

export function partitionImportBatchOperations(
    batch: Operation[],
    rejectedIndices: number[] = [],
): { processCandidates: Operation[]; rejectedOperations: Operation[] } {
    const rejectedSet = new Set<number>();
    for (const index of rejectedIndices) {
        if (Number.isInteger(index) && index >= 0 && index < batch.length) {
            rejectedSet.add(index);
        }
    }

    const processCandidates: Operation[] = [];
    const rejectedOperations: Operation[] = [];
    batch.forEach((operation, index) => {
        (rejectedSet.has(index) ? rejectedOperations : processCandidates).push(operation);
    });
    return { processCandidates, rejectedOperations };
}

export function filterOperationsByAcceptedHashes(
    operations: Operation[],
    acceptedHashes: string[] = [],
): Operation[] {
    if (!Array.isArray(operations) || operations.length === 0) {
        return [];
    }

    if (!Array.isArray(acceptedHashes) || acceptedHashes.length === 0) {
        return [];
    }

    const acceptedSet = new Set(
        acceptedHashes
            .filter((hash): hash is string => hash !== '')
            .map(hash => hash.toLowerCase())
    );

    if (acceptedSet.size === 0) {
        return [];
    }

    return operations.filter(operation => {
        const hash = operation.signature?.hash;
        return typeof hash === 'string' && acceptedSet.has(hash.toLowerCase());
    });
}

export function dedupeOperationsByHash(operations: Operation[]): Operation[] {
    if (!Array.isArray(operations) || operations.length === 0) {
        return [];
    }

    const unique: Operation[] = [];
    const seen = new Set<string>();

    for (const operation of operations) {
        const hash = operation?.signature?.hash;
        if (typeof hash !== 'string' || hash === '') {
            unique.push(operation);
            continue;
        }

        const normalized = hash.toLowerCase();
        if (seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        unique.push(operation);
    }

    return unique;
}

function normalizeAcceptedOperation(input: AcceptedOperationInput): AcceptedOperationWithSyncOrder {
    if (input && typeof input === 'object' && 'operation' in input) {
        return input;
    }

    return { operation: input as Operation };
}

function getSyncOrder(input: AcceptedOperationWithSyncOrder): number | undefined {
    return Number.isSafeInteger(input.syncOrder) && input.syncOrder! >= 0
        ? input.syncOrder
        : undefined;
}

export function mapAcceptedOperationsToSyncRecords(operations: AcceptedOperationInput[]): MapAcceptedResult {
    const records: SyncPersistenceRecord[] = [];
    let invalid = 0;

    for (const input of operations) {
        const normalized = normalizeAcceptedOperation(input);
        const operation = normalized.operation;
        const mapped = mapOperationToSyncKey(operation);
        if (!mapped.ok) {
            invalid += 1;
            continue;
        }

        records.push({
            id: mapped.value.idHex,
            syncOrder: getSyncOrder(normalized),
            signedTs: mapped.value.ts,
            ts: mapped.value.ts,
            operation,
        });
    }

    return { records, invalid };
}

export function mapIndexExportOperationsToSyncRecords(operations: IndexExportOperationRecord[]): MapAcceptedResult {
    return mapAcceptedOperationsToSyncRecords(operations.map(record => ({
        operation: record.event.operation,
        syncOrder: record.seq,
    })));
}

export function mapIndexExportChangesToSyncPage(
    operations: IndexExportOperationRecord[],
    removedOperations: IndexExportRemovedOperationRecord[] = [],
    existingRecords: readonly SyncPersistenceRecord[] = [],
): MapIndexExportChangesResult {
    const actions = new Map<string, SyncPersistenceRecord>();
    const existing = new Map(existingRecords.map(record => [record.id, record]));
    const replacements = new Set<string>();
    let invalid = 0;
    const changes = [
        ...operations.map(record => ({ kind: 'upsert' as const, record })),
        ...removedOperations.map(record => ({ kind: 'delete' as const, record })),
    ].sort((a, b) => a.record.seq - b.record.seq);

    for (const change of changes) {
        if (change.kind === 'delete') {
            if (typeof change.record.operationHash !== 'string') {
                invalid += 1;
                continue;
            }
            const id = change.record.operationHash.toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(id)) {
                invalid += 1;
                continue;
            }
            const previous = actions.get(id) ?? existing.get(id);
            // An unknown removal is not proof of an operation's contents or acceptance.
            if (!previous || previous.syncOrder === undefined ||
                previous.syncOrder === Number.MAX_SAFE_INTEGER || isRetiredSyncOrder(previous.syncOrder)) {
                continue;
            }
            actions.set(id, {
                ...previous,
                syncOrder: RETIRED_SYNC_ORDER_OFFSET + requireActiveSyncOrder(previous.syncOrder),
            });
            replacements.add(id);
            continue;
        }

        const mapped = mapIndexExportOperationsToSyncRecords([change.record]);
        invalid += mapped.invalid;
        if (mapped.records[0]) {
            const record = mapped.records[0];
            requireActiveSyncOrder(record.syncOrder!);
            const previous = actions.get(record.id) ?? existing.get(record.id);
            if (isRetiredSyncOrder(previous?.syncOrder) || previous?.syncOrder === Number.MAX_SAFE_INTEGER) {
                replacements.add(record.id);
            }
            actions.set(record.id, record);
        }
    }

    // applySyncPage atomically replaces ordering metadata without losing retained history.
    return { records: Array.from(actions.values()), deleteIds: Array.from(replacements), invalid };
}

export async function filterKnownOperations(
    operations: Operation[],
    syncStore: Pick<OperationSyncStore, 'getByIds'>,
    lookupChunkSize: number = 100,
): Promise<FilterKnownOperationsResult> {
    if (!Array.isArray(operations) || operations.length === 0) {
        return {
            operations: [],
            knownIds: [],
            mapped: 0,
            known: 0,
            invalid: 0,
        };
    }

    const mappedIdsByIndex = new Map<number, string>();
    const uniqueMappedIds = new Set<string>();
    let invalid = 0;

    for (const [index, operation] of operations.entries()) {
        const mapped = mapOperationToSyncKey(operation);
        if (!mapped.ok) {
            invalid += 1;
            continue;
        }

        mappedIdsByIndex.set(index, mapped.value.idHex);
        uniqueMappedIds.add(mapped.value.idHex);
    }

    if (mappedIdsByIndex.size === 0) {
        return {
            operations: [...operations],
            knownIds: [],
            mapped: 0,
            known: 0,
            invalid,
        };
    }

    const existingIds = new Set<string>();
    const ids = Array.from(uniqueMappedIds);
    const chunkSize = Number.isInteger(lookupChunkSize) && lookupChunkSize > 0
        ? lookupChunkSize
        : 100;

    for (let i = 0; i < ids.length; i += chunkSize) {
        const rows = await syncStore.getByIds(ids.slice(i, i + chunkSize));
        for (const row of rows) {
            existingIds.add(row.id);
        }
    }

    const filtered: Operation[] = [];
    const knownIds = new Set<string>();
    let known = 0;

    for (const [index, operation] of operations.entries()) {
        const mappedId = mappedIdsByIndex.get(index);
        if (mappedId && existingIds.has(mappedId)) {
            knownIds.add(mappedId);
            known += 1;
            continue;
        }

        filtered.push(operation);
    }

    return {
        operations: filtered,
        knownIds: Array.from(knownIds),
        mapped: mappedIdsByIndex.size,
        known,
        invalid,
    };
}

export function sortOperationsBySyncKey(operations: Operation[]): Operation[] {
    if (!Array.isArray(operations) || operations.length <= 1) {
        return Array.isArray(operations) ? [...operations] : [];
    }

    return operations
        .map((operation, index) => ({
            operation,
            index,
            mapped: mapOperationToSyncKey(operation),
        }))
        .sort((a, b) => {
            if (a.mapped.ok && b.mapped.ok) {
                if (a.mapped.value.ts !== b.mapped.value.ts) {
                    return a.mapped.value.ts - b.mapped.value.ts;
                }

                if (a.mapped.value.idHex < b.mapped.value.idHex) {
                    return -1;
                }

                if (a.mapped.value.idHex > b.mapped.value.idHex) {
                    return 1;
                }
            } else if (a.mapped.ok !== b.mapped.ok) {
                return a.mapped.ok ? -1 : 1;
            }

            return a.index - b.index;
        })
        .map(item => item.operation);
}
