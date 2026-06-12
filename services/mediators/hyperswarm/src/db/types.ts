import { Operation } from '@mdip/gatekeeper/types';

export interface SyncOperationRecord {
    id: string;
    syncOrder?: number;
    signedTs: number;
    // Compatibility alias for the current negentropy cursor/window code.
    ts: number;
    operation: Operation;
    insertedAt: number;
}

export interface SyncOperationWriteRecord {
    id: string;
    syncOrder?: number;
    signedTs?: number;
    ts?: number;
    operation: Operation;
    insertedAt?: number;
}

export interface SyncStoreCursor {
    ts: number;
    id: string;
}

export interface SyncStoreOrderedCursor {
    syncOrder: number;
    id: string;
}

export interface SyncStoreListOptions {
    after?: SyncStoreCursor;
    limit?: number;
    fromTs?: number;
    toTs?: number;
}

export interface SyncStoreOrderedListOptions {
    after?: SyncStoreOrderedCursor;
    limit?: number;
}

export interface SyncStorePage {
    records: SyncOperationWriteRecord[];
    syncStateUpdates?: Record<string, string | null>;
}

export interface SyncStoreWriteResult {
    inserted: number;
    updated: number;
}

export type ApplySyncStorePageResult = SyncStoreWriteResult;

export interface OperationSyncStore {
    start(): Promise<void>;
    stop(): Promise<void>;
    reset(): Promise<void>;
    /**
     * Inserts missing operations and preserves existing operation identity. Existing
     * rows may only be updated to backfill a missing syncOrder from an incoming
     * ordered gatekeeper export row.
     */
    upsertMany(records: SyncOperationWriteRecord[]): Promise<SyncStoreWriteResult>;
    applySyncPage(page: SyncStorePage): Promise<ApplySyncStorePageResult>;
    loadSyncState(key: string): Promise<string | null>;
    saveSyncState(key: string, value: string | null): Promise<void>;
    getByIds(ids: string[]): Promise<SyncOperationRecord[]>;
    iterateSorted(options?: SyncStoreListOptions): Promise<SyncOperationRecord[]>;
    iterateOrdered(options?: SyncStoreOrderedListOptions): Promise<SyncOperationRecord[]>;
    has(id: string): Promise<boolean>;
    count(): Promise<number>;
    countOrdered(): Promise<number>;
}
