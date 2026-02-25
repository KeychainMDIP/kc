import { OperationSyncStore, SyncOperationRecord, SyncStoreListOptions } from './types.js';

export default class InMemoryOperationSyncStore implements OperationSyncStore {
    private readonly records = new Map<string, SyncOperationRecord>();

    async start(): Promise<void> {
        // no-op
    }

    async stop(): Promise<void> {
        // no-op
    }

    async reset(): Promise<void> {
        this.records.clear();
    }

    async upsertMany(records: Array<Omit<SyncOperationRecord, 'insertedAt'> | SyncOperationRecord>): Promise<number> {
        if (!Array.isArray(records) || records.length === 0) {
            return 0;
        }

        let inserted = 0;
        const now = Date.now();

        for (const record of records) {
            if (this.records.has(record.id)) {
                continue;
            }

            inserted += 1;
            const insertedAt = 'insertedAt' in record ? record.insertedAt : now;
            this.records.set(record.id, {
                id: record.id,
                ts: record.ts,
                operation: record.operation,
                insertedAt,
            });
        }

        return inserted;
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

    async has(id: string): Promise<boolean> {
        return this.records.has(id);
    }

    async count(): Promise<number> {
        return this.records.size;
    }
}
