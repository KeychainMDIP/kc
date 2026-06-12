import {
    ApplySyncStorePageResult,
    OperationSyncStore,
    SyncOperationRecord,
    SyncOperationWriteRecord,
    SyncStoreListOptions,
    SyncStoreOrderedListOptions,
    SyncStorePage,
    SyncStoreWriteResult,
} from './types.js';

export default class InMemoryOperationSyncStore implements OperationSyncStore {
    private readonly records = new Map<string, SyncOperationRecord>();
    private readonly syncState = new Map<string, string>();

    async start(): Promise<void> {
        // no-op
    }

    async stop(): Promise<void> {
        // no-op
    }

    async reset(): Promise<void> {
        this.records.clear();
        this.syncState.clear();
    }

    async upsertMany(records: SyncOperationWriteRecord[]): Promise<SyncStoreWriteResult> {
        if (!Array.isArray(records) || records.length === 0) {
            return { inserted: 0, updated: 0 };
        }

        let inserted = 0;
        let updated = 0;
        const now = Date.now();

        for (const record of records) {
            const existing = this.records.get(record.id);
            const syncOrder = this.getSyncOrder(record);

            if (existing) {
                if (existing.syncOrder === undefined && syncOrder !== undefined) {
                    existing.syncOrder = syncOrder;
                    updated += 1;
                }
                continue;
            }

            inserted += 1;
            const insertedAt = record.insertedAt ?? now;
            const signedTs = this.getSignedTs(record);
            this.records.set(record.id, {
                id: record.id,
                syncOrder,
                signedTs,
                ts: signedTs,
                operation: record.operation,
                insertedAt,
            });
        }

        return { inserted, updated };
    }

    async applySyncPage(page: SyncStorePage): Promise<ApplySyncStorePageResult> {
        const result = await this.upsertMany(page.records);

        for (const [key, value] of Object.entries(page.syncStateUpdates ?? {})) {
            await this.saveSyncState(key, value);
        }

        return result;
    }

    async loadSyncState(key: string): Promise<string | null> {
        return this.syncState.get(key) ?? null;
    }

    async saveSyncState(key: string, value: string | null): Promise<void> {
        if (value === null) {
            this.syncState.delete(key);
            return;
        }

        this.syncState.set(key, value);
    }

    async getByIds(ids: string[]): Promise<SyncOperationRecord[]> {
        if (!Array.isArray(ids) || ids.length === 0) {
            return [];
        }

        const out: SyncOperationRecord[] = [];
        for (const id of ids) {
            const row = this.records.get(id);
            if (row) {
                out.push(row);
            }
        }
        return out;
    }

    async iterateSorted(options: SyncStoreListOptions = {}): Promise<SyncOperationRecord[]> {
        const limit = options.limit ?? 1000;
        const after = options.after;
        const fromTs = options.fromTs;
        const toTs = options.toTs;

        const sorted = Array.from(this.records.values()).sort((a, b) => {
            if (a.ts !== b.ts) {
                return a.ts - b.ts;
            }
            return a.id.localeCompare(b.id);
        });

        const filtered = sorted.filter(item => {
            if (after && !(item.ts > after.ts || (item.ts === after.ts && item.id > after.id))) {
                return false;
            }

            if (typeof fromTs === 'number' && item.ts < fromTs) {
                return false;
            }

            return !(typeof toTs === 'number' && item.ts > toTs);
        });

        return filtered.slice(0, limit);
    }

    async iterateOrdered(options: SyncStoreOrderedListOptions = {}): Promise<SyncOperationRecord[]> {
        const limit = options.limit ?? 1000;
        const after = options.after;

        const sorted = Array.from(this.records.values())
            .filter((item): item is SyncOperationRecord & { syncOrder: number } => item.syncOrder !== undefined)
            .sort((a, b) => {
                if (a.syncOrder !== b.syncOrder) {
                    return a.syncOrder - b.syncOrder;
                }
                return a.id.localeCompare(b.id);
            });

        const filtered = sorted.filter(item => {
            if (!after) {
                return true;
            }

            return item.syncOrder > after.syncOrder
                || (item.syncOrder === after.syncOrder && item.id > after.id);
        });

        return filtered.slice(0, limit);
    }

    async has(id: string): Promise<boolean> {
        return this.records.has(id);
    }

    async count(): Promise<number> {
        return this.records.size;
    }

    async countOrdered(): Promise<number> {
        return Array.from(this.records.values())
            .filter(record => record.syncOrder !== undefined)
            .length;
    }

    private getSignedTs(record: SyncOperationWriteRecord): number {
        const signedTs = record.signedTs ?? record.ts;

        if (typeof signedTs !== 'number' || !Number.isSafeInteger(signedTs)) {
            throw new Error('Sync operation record signedTs must be an integer');
        }

        return signedTs;
    }

    private getSyncOrder(record: SyncOperationWriteRecord): number | undefined {
        return Number.isSafeInteger(record.syncOrder) && record.syncOrder! >= 0
            ? record.syncOrder
            : undefined;
    }
}
