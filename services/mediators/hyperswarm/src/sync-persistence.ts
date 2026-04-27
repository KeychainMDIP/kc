import { Operation } from '@mdip/gatekeeper/types';
import type { OperationSyncStore } from './db/types.js';
import { mapOperationToSyncKey } from './sync-mapping.js';

export interface SyncPersistenceRecord {
    id: string;
    ts: number;
    operation: Operation;
}

export interface MapAcceptedResult {
    records: SyncPersistenceRecord[];
    invalid: number;
}

export interface FilterKnownOperationsResult {
    operations: Operation[];
    mapped: number;
    known: number;
    invalid: number;
}

export function filterIndexRejectedOperations(batch: Operation[], rejectedIndices: number[] = []): Operation[] {
    if (!Array.isArray(batch) || batch.length === 0) {
        return [];
    }

    if (!Array.isArray(rejectedIndices) || rejectedIndices.length === 0) {
        return [...batch];
    }

    const rejectedSet = new Set<number>();
    for (const index of rejectedIndices) {
        if (Number.isInteger(index) && index >= 0 && index < batch.length) {
            rejectedSet.add(index);
        }
    }

    return batch.filter((_operation, index) => !rejectedSet.has(index));
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

export function mapAcceptedOperationsToSyncRecords(operations: Operation[]): MapAcceptedResult {
    const records: SyncPersistenceRecord[] = [];
    let invalid = 0;

    for (const operation of operations) {
        const mapped = mapOperationToSyncKey(operation);
        if (!mapped.ok) {
            invalid += 1;
            continue;
        }

        records.push({
            id: mapped.value.idHex,
            ts: mapped.value.ts,
            operation,
        });
    }

    return { records, invalid };
}

export async function filterKnownOperations(
    operations: Operation[],
    syncStore: Pick<OperationSyncStore, 'getByIds'>,
    lookupChunkSize: number = 100,
): Promise<FilterKnownOperationsResult> {
    if (!Array.isArray(operations) || operations.length === 0) {
        return {
            operations: [],
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
    let known = 0;

    for (const [index, operation] of operations.entries()) {
        const mappedId = mappedIdsByIndex.get(index);
        if (mappedId && existingIds.has(mappedId)) {
            known += 1;
            continue;
        }

        filtered.push(operation);
    }

    return {
        operations: filtered,
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
