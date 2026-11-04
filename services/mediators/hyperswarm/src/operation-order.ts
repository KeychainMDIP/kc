import type { Operation } from '@mdip/gatekeeper/types';
import type { SyncOperationRecord } from './db/types.js';
import { dedupeOperationsByHash } from './sync-persistence.js';

function hasSyncOrder(record: SyncOperationRecord): record is SyncOperationRecord & { syncOrder: number } {
    return Number.isSafeInteger(record.syncOrder);
}

function getSignedTimestamp(record: SyncOperationRecord): number {
    return record.signedTs ?? record.ts;
}

export function compareSyncOperationRecordsForPush(
    left: SyncOperationRecord,
    right: SyncOperationRecord,
): number {
    const leftHasSyncOrder = hasSyncOrder(left);
    const rightHasSyncOrder = hasSyncOrder(right);

    if (leftHasSyncOrder && rightHasSyncOrder && left.syncOrder !== right.syncOrder) {
        return left.syncOrder - right.syncOrder;
    }

    const leftSignedTs = getSignedTimestamp(left);
    const rightSignedTs = getSignedTimestamp(right);
    if (leftSignedTs !== rightSignedTs) {
        return leftSignedTs - rightSignedTs;
    }

    return left.id.localeCompare(right.id);
}

export function orderSyncRecordsForPush(records: SyncOperationRecord[]): SyncOperationRecord[] {
    return [...records].sort(compareSyncOperationRecordsForPush);
}

export function normalizeInboundOpsPushBatch(data: unknown): Operation[] {
    return dedupeOperationsByHash(Array.isArray(data) ? data : []);
}
