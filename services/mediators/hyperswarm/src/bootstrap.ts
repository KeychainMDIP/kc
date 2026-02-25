import type { GatekeeperEvent } from '@mdip/gatekeeper/types';
import type { OperationSyncStore } from './db/types.js';
import { mapAcceptedOperationsToSyncRecords } from './sync-persistence.js';

const DEFAULT_DRIFT_THRESHOLD_PCT = 0.01; // 1%
const BOOTSTRAP_DID_BATCH_SIZE = 500;

export interface BootstrapGatekeeper {
    getDIDs(): Promise<string[]>;
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

interface BootstrapBatchTotals {
    exported: number;
    mapped: number;
    invalid: number;
    canonicalCount: number;
}

interface BootstrapImportTotals extends BootstrapBatchTotals {
    inserted: number;
}

function toOperations(events: GatekeeperEvent[]): NonNullable<GatekeeperEvent['operation']>[] {
    return events
        .map(event => event.operation)
        .filter((operation): operation is NonNullable<GatekeeperEvent['operation']> => !!operation);
}

async function exportBatchForDids(
    gatekeeper: BootstrapGatekeeper,
    dids: string[],
    batchIndex: number,
    batchCount: number,
): Promise<NonNullable<GatekeeperEvent['operation']>[]> {
    try {
        const events = await gatekeeper.exportBatch(dids);
        return toOperations(events);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `bootstrap exportBatch failed for DID batch ${batchIndex + 1}/${batchCount} (${dids.length} dids): ${message}`
        );
    }
}

async function scanGatekeeperBatches(
    gatekeeper: BootstrapGatekeeper,
    dids: string[],
): Promise<BootstrapBatchTotals> {
    let exported = 0;
    let mapped = 0;
    let invalid = 0;
    const batchCount = dids.length === 0 ? 0 : Math.ceil(dids.length / BOOTSTRAP_DID_BATCH_SIZE);

    for (let offset = 0, batchIndex = 0; offset < dids.length; offset += BOOTSTRAP_DID_BATCH_SIZE, batchIndex += 1) {
        const didBatch = dids.slice(offset, offset + BOOTSTRAP_DID_BATCH_SIZE);
        const operations = await exportBatchForDids(gatekeeper, didBatch, batchIndex, batchCount);
        exported += operations.length;

        const { records, invalid: invalidBatch } = mapAcceptedOperationsToSyncRecords(operations);
        mapped += records.length;
        invalid += invalidBatch;
    }

    return {
        exported,
        mapped,
        invalid,
        canonicalCount: mapped,
    };
}

async function importGatekeeperBatches(
    gatekeeper: BootstrapGatekeeper,
    syncStore: OperationSyncStore,
    dids: string[],
): Promise<BootstrapImportTotals> {
    let exported = 0;
    let mapped = 0;
    let invalid = 0;
    let inserted = 0;
    const batchCount = dids.length === 0 ? 0 : Math.ceil(dids.length / BOOTSTRAP_DID_BATCH_SIZE);

    for (let offset = 0, batchIndex = 0; offset < dids.length; offset += BOOTSTRAP_DID_BATCH_SIZE, batchIndex += 1) {
        const didBatch = dids.slice(offset, offset + BOOTSTRAP_DID_BATCH_SIZE);
        const operations = await exportBatchForDids(gatekeeper, didBatch, batchIndex, batchCount);
        exported += operations.length;

        const { records, invalid: invalidBatch } = mapAcceptedOperationsToSyncRecords(operations);
        mapped += records.length;
        invalid += invalidBatch;

        if (records.length > 0) {
            inserted += await syncStore.upsertMany(records);
        }
    }

    return {
        exported,
        mapped,
        invalid,
        inserted,
        canonicalCount: mapped,
    };
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
    const dids = await gatekeeper.getDIDs();

    let exported = 0;
    let mapped = 0;
    let invalid = 0;
    let inserted = 0;
    let canonicalCount = 0;

    if (countBefore > 0) {
        const scanned = await scanGatekeeperBatches(gatekeeper, dids);
        exported = scanned.exported;
        mapped = scanned.mapped;
        invalid = scanned.invalid;
        canonicalCount = scanned.canonicalCount;
    } else {
        const imported = await importGatekeeperBatches(gatekeeper, syncStore, dids);
        exported = imported.exported;
        mapped = imported.mapped;
        invalid = imported.invalid;
        inserted = imported.inserted;
        canonicalCount = imported.canonicalCount;
    }

    const driftPct = Math.abs(countBefore - canonicalCount) / Math.max(canonicalCount, 1);

    if (countBefore > 0 && driftPct < driftThresholdPct) {
        return {
            skipped: true,
            reason: 'store_within_drift_tolerance',
            countBefore,
            countAfter: countBefore,
            exported,
            mapped,
            invalid,
            inserted: 0,
            driftPct,
            driftThresholdPct,
            durationMs: Date.now() - startedAt,
        };
    }

    if (countBefore > 0) {
        await syncStore.reset();
        const imported = await importGatekeeperBatches(gatekeeper, syncStore, dids);
        exported = imported.exported;
        mapped = imported.mapped;
        invalid = imported.invalid;
        inserted = imported.inserted;
    }
    const countAfter = await syncStore.count();

    return {
        skipped: false,
        countBefore,
        countAfter,
        exported,
        mapped,
        invalid,
        inserted,
        driftPct,
        driftThresholdPct,
        durationMs: Date.now() - startedAt,
    };
}
