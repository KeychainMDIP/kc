import type { GatekeeperEvent } from '@mdip/gatekeeper/types';
import type { OperationSyncStore } from './db/types.js';
import { mapAcceptedOperationsToSyncRecords } from './sync-persistence.js';

export interface BootstrapGatekeeper {
    exportBatch(dids?: string[]): Promise<GatekeeperEvent[]>;
}

export interface BootstrapResult {
    skipped: boolean;
    reason?: 'store_not_empty';
    countBefore: number;
    countAfter: number;
    exported: number;
    mapped: number;
    invalid: number;
    inserted: number;
    durationMs: number;
}

export async function bootstrapSyncStoreIfEmpty(
    syncStore: OperationSyncStore,
    gatekeeper: BootstrapGatekeeper,
): Promise<BootstrapResult> {
    const startedAt = Date.now();
    const countBefore = await syncStore.count();

    if (countBefore > 0) {
        return {
            skipped: true,
            reason: 'store_not_empty',
            countBefore,
            countAfter: countBefore,
            exported: 0,
            mapped: 0,
            invalid: 0,
            inserted: 0,
            durationMs: Date.now() - startedAt,
        };
    }

    const exportedEvents = await gatekeeper.exportBatch();
    const operations = exportedEvents
        .map(event => event.operation)
        .filter((operation): operation is NonNullable<GatekeeperEvent['operation']> => !!operation);

    const { records, invalid } = mapAcceptedOperationsToSyncRecords(operations);
    const inserted = records.length > 0 ? await syncStore.upsertMany(records) : 0;
    const countAfter = await syncStore.count();

    return {
        skipped: false,
        countBefore,
        countAfter,
        exported: operations.length,
        mapped: records.length,
        invalid,
        inserted,
        durationMs: Date.now() - startedAt,
    };
}
