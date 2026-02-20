import { Operation } from '@mdip/gatekeeper/types';

export interface SyncOperationRecord {
    id: string;
    ts: number;
    operation: Operation;
    insertedAt: number;
}

export interface SyncStoreCursor {
    ts: number;
    id: string;
}

export interface SyncStoreListOptions {
    after?: SyncStoreCursor;
    limit?: number;
    fromTs?: number;
    toTs?: number;
}

export interface OperationSyncStore {
    start(): Promise<void>;
    stop(): Promise<void>;
    reset(): Promise<void>;
    upsertMany(records: Array<Omit<SyncOperationRecord, 'insertedAt'> | SyncOperationRecord>): Promise<number>;
    getByIds(ids: string[]): Promise<SyncOperationRecord[]>;
    iterateSorted(options?: SyncStoreListOptions): Promise<SyncOperationRecord[]>;
    has(id: string): Promise<boolean>;
    count(): Promise<number>;
}
