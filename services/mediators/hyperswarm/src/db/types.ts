import { Operation } from '@mdip/gatekeeper/types';

export interface SyncOperationRecord {
    id: string;
    syncOrder?: number;
    signedTs: number;
    operation: Operation;
    insertedAt: number;
}

export interface SyncOperationWriteRecord {
    id: string;
    syncOrder?: number;
    signedTs: number;
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
    deleteIds?: string[];
    syncStateUpdates?: Record<string, string | null>;
}

export interface SyncStateEntry {
    key: string;
    value: string;
}

export interface SyncStateListOptions {
    after?: string;
    limit: number;
}

export interface SyncStoreWriteResult {
    inserted: number;
    updated: number;
}

export interface ApplySyncStorePageResult extends SyncStoreWriteResult {
    deleted: number;
}

export interface OperationSyncStore {
    start(): Promise<void>;
    stop(): Promise<void>;
    reset(): Promise<void>;
    deleteBySyncOrder(syncOrder: number): Promise<number>;
    /**
     * Inserts missing operations and preserves existing operation identity. Existing
     * rows may only be updated to backfill a missing syncOrder from an incoming
     * ordered gatekeeper export row.
     */
    upsertMany(records: SyncOperationWriteRecord[]): Promise<SyncStoreWriteResult>;
    applySyncPage(page: SyncStorePage): Promise<ApplySyncStorePageResult>;
    loadSyncState(key: string): Promise<string | null>;
    loadSyncStateByPrefix(prefix: string, options: SyncStateListOptions): Promise<SyncStateEntry[]>;
    saveSyncState(key: string, value: string | null): Promise<void>;
    getByIds(ids: string[]): Promise<SyncOperationRecord[]>;
    iterateSortedKeys(options?: SyncStoreListOptions): Promise<SyncStoreCursor[]>;
    iterateOrdered(options?: SyncStoreOrderedListOptions): Promise<SyncOperationRecord[]>;
    has(id: string): Promise<boolean>;
    count(): Promise<number>;
    countOrdered(): Promise<number>;
    getLatestSignedTimestamp(): Promise<number | null>;
}
