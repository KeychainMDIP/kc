import type { GatekeeperEvent, GatekeeperInterface, MdipDocument } from '@mdip/gatekeeper/types';
import type { OperationSyncStore } from './db/types.js';
import { mapAcceptedOperationsToSyncRecords } from './sync-persistence.js';

const BOOTSTRAP_DID_BATCH_SIZE = 500;

export type BootstrapGatekeeper = Pick<GatekeeperInterface, 'getDIDs' | 'exportBatch'>;

export interface BootstrapResult {
    countBefore: number;
    countAfter: number;
    exported: number;
    mapped: number;
    invalid: number;
    inserted: number;
    durationMs: number;
}

interface BootstrapImportTotals {
    exported: number;
    mapped: number;
    invalid: number;
    inserted: number;
}

function toOperations(events: GatekeeperEvent[]): NonNullable<GatekeeperEvent['operation']>[] {
    return events
        .map(event => event.operation)
        .filter((operation): operation is NonNullable<GatekeeperEvent['operation']> => !!operation);
}

function normalizeDids(input: string[] | MdipDocument[]): string[] {
    const dids = input
        .map(item => {
            if (typeof item === 'string') {
                return item;
            }
            return item?.didDocument?.id;
        })
        .filter((did): did is string => typeof did === 'string' && did !== '');

    return Array.from(new Set(dids));
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
    };
}

export async function bootstrapSyncStoreFromGatekeeper(
    syncStore: OperationSyncStore,
    gatekeeper: BootstrapGatekeeper,
): Promise<BootstrapResult> {
    const startedAt = Date.now();
    const countBefore = await syncStore.count();
    const dids = normalizeDids(await gatekeeper.getDIDs());

    await syncStore.reset();

    const imported = await importGatekeeperBatches(gatekeeper, syncStore, dids);
    const countAfter = await syncStore.count();

    return {
        countBefore,
        countAfter,
        exported: imported.exported,
        mapped: imported.mapped,
        invalid: imported.invalid,
        inserted: imported.inserted,
        durationMs: Date.now() - startedAt,
    };
}
