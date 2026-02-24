import type { GatekeeperEvent } from '@mdip/gatekeeper/types';
import type { OperationSyncStore } from './db/types.js';
import { mapAcceptedOperationsToSyncRecords } from './sync-persistence.js';

const DEFAULT_DRIFT_THRESHOLD_PCT = 0.01; // 1%

export interface BootstrapGatekeeper {
    exportBatch(dids?: string[]): Promise<GatekeeperEvent[]>;
}

export interface BootstrapResult {
    skipped: boolean;
    reason?: 'store_within_drift_tolerance';
    countBefore: number;
    countAfter: number;
    exported: number;
    mapped: number;
    invalid: number;
    inserted: number;
    driftPct: number;
    driftThresholdPct: number;
    durationMs: number;
}

export interface BootstrapOptions {
    driftThresholdPct?: number;
}

function assertValidDriftThreshold(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('Invalid driftThresholdPct; expected a number between 0 and 1');
    }
}

export async function bootstrapSyncStoreIfEmpty(
    syncStore: OperationSyncStore,
    gatekeeper: BootstrapGatekeeper,
    options: BootstrapOptions = {},
): Promise<BootstrapResult> {
    const driftThresholdPct = options.driftThresholdPct ?? DEFAULT_DRIFT_THRESHOLD_PCT;
    assertValidDriftThreshold(driftThresholdPct);

    const startedAt = Date.now();
    const countBefore = await syncStore.count();

    const exportedEvents = await gatekeeper.exportBatch();
    const operations = exportedEvents
        .map(event => event.operation)
        .filter((operation): operation is NonNullable<GatekeeperEvent['operation']> => !!operation);

    const { records, invalid } = mapAcceptedOperationsToSyncRecords(operations);
    const canonicalCount = records.length;
    const driftPct = Math.abs(countBefore - canonicalCount) / Math.max(canonicalCount, 1);

    if (countBefore > 0 && driftPct < driftThresholdPct) {
        return {
            skipped: true,
            reason: 'store_within_drift_tolerance',
            countBefore,
            countAfter: countBefore,
            exported: operations.length,
            mapped: canonicalCount,
            invalid,
            inserted: 0,
            driftPct,
            driftThresholdPct,
            durationMs: Date.now() - startedAt,
        };
    }

    if (countBefore > 0) {
        await syncStore.reset();
    }

    const inserted = canonicalCount > 0 ? await syncStore.upsertMany(records) : 0;
    const countAfter = await syncStore.count();

    return {
        skipped: false,
        countBefore,
        countAfter,
        exported: operations.length,
        mapped: canonicalCount,
        invalid,
        inserted,
        driftPct,
        driftThresholdPct,
        durationMs: Date.now() - startedAt,
    };
}
