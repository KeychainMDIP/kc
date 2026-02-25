import { Operation } from '@mdip/gatekeeper/types';
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
            ts: mapped.value.tsSec,
            operation,
        });
    }

    return { records, invalid };
}
