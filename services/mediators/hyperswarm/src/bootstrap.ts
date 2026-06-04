import type {
    GatekeeperEvent,
    IndexExportRequest,
    IndexExportResponse,
    Operation,
} from '@mdip/gatekeeper/types';
import type { OperationSyncStore } from './db/types.js';
import {
    mapAcceptedOperationsToSyncRecords,
    mapIndexExportOperationsToSyncRecords,
} from './sync-persistence.js';

const DEFAULT_INDEX_EXPORT_PAGE_LIMIT = 500;

export const HYPR_INDEX_SYNC_STATE_KEYS = {
    snapshotComplete: 'index.snapshot.complete',
    snapshotCursor: 'index.snapshot.cursor',
    snapshotCheckpointCursor: 'index.snapshot.checkpointCursor',
    changesCursor: 'index.changes.cursor',
} as const;

export interface BootstrapResult {
    countBefore: number;
    countAfter: number;
    mode: 'snapshot' | 'changes';
    pages: number;
    exported: number;
    mapped: number;
    invalid: number;
    inserted: number;
    updated: number;
    snapshotComplete: boolean;
    durationMs: number;
}

export interface BootstrapOptions {
    pageLimit?: number;
}

export interface BootstrapGatekeeper {
    exportIndex(request: IndexExportRequest): Promise<IndexExportResponse>;
}

interface ImportTotals {
    pages: number;
    exported: number;
    mapped: number;
    invalid: number;
    inserted: number;
    updated: number;
}

function toOperations(events: GatekeeperEvent[]): Operation[] {
    return events
        .map(event => event.operation)
        .filter((operation): operation is Operation => !!operation);
}

function getDIDOperations(response: IndexExportResponse): Operation[] {
    return response.dids.flatMap(record => toOperations(record.events));
}

async function applySnapshotPage(
    syncStore: OperationSyncStore,
    response: IndexExportResponse,
    syncStateUpdates: Record<string, string | null>
): Promise<Omit<ImportTotals, 'pages'>> {
    const operations = getDIDOperations(response);
    const { records, invalid } = mapAcceptedOperationsToSyncRecords(operations);
    const result = await syncStore.applySyncPage({
        records,
        syncStateUpdates,
    });

    return {
        exported: operations.length,
        mapped: records.length,
        invalid,
        inserted: result.inserted,
        updated: result.updated,
    };
}

async function applyChangesPage(
    syncStore: OperationSyncStore,
    response: IndexExportResponse,
    syncStateUpdates: Record<string, string | null>
): Promise<Omit<ImportTotals, 'pages'>> {
    if (response.mode !== 'changes' || !Array.isArray(response.operations)) {
        throw new Error('Changes export response missing operations');
    }

    const { records, invalid } = mapIndexExportOperationsToSyncRecords(response.operations);
    const result = await syncStore.applySyncPage({
        records,
        syncStateUpdates,
    });

    return {
        exported: response.operations.length,
        mapped: records.length,
        invalid,
        inserted: result.inserted,
        updated: result.updated,
    };
}

function addTotals(totals: ImportTotals, page: Omit<ImportTotals, 'pages'>): void {
    totals.exported += page.exported;
    totals.mapped += page.mapped;
    totals.invalid += page.invalid;
    totals.inserted += page.inserted;
    totals.updated += page.updated;
    totals.pages += 1;
}

async function syncSnapshot(
    syncStore: OperationSyncStore,
    gatekeeper: BootstrapGatekeeper,
    pageLimit: number
): Promise<ImportTotals> {
    const totals: ImportTotals = {
        pages: 0,
        exported: 0,
        mapped: 0,
        invalid: 0,
        inserted: 0,
        updated: 0,
    };
    let cursor = await syncStore.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCursor);
    let checkpointCursor = await syncStore.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor);

    if (cursor && !checkpointCursor) {
        throw new Error('Snapshot cursor found without checkpointCursor');
    }
    if (!cursor && checkpointCursor) {
        throw new Error('Snapshot checkpointCursor found without cursor');
    }

    while (true) {
        const response = await gatekeeper.exportIndex({
            mode: 'snapshot',
            cursor,
            ...(checkpointCursor ? { checkpointCursor } : {}),
            limit: pageLimit,
        });

        if (response.mode !== 'snapshot') {
            throw new Error(`Expected snapshot export response, got ${response.mode}`);
        }
        if (response.checkpointCursor === undefined) {
            throw new Error('Snapshot export response missing checkpointCursor');
        }

        const responseCheckpointCursor = response.checkpointCursor ?? '0';
        if (checkpointCursor && responseCheckpointCursor !== checkpointCursor) {
            throw new Error(
                `Snapshot export checkpoint changed from ${checkpointCursor} to ${responseCheckpointCursor}`
            );
        }
        checkpointCursor = checkpointCursor ?? responseCheckpointCursor;

        const nextCursor = response.cursor;
        const syncStateUpdates: Record<string, string | null> = {
            [HYPR_INDEX_SYNC_STATE_KEYS.snapshotCursor]: nextCursor,
            [HYPR_INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor]: checkpointCursor,
        };

        if (!response.hasMore) {
            syncStateUpdates[HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete] = 'true';
            syncStateUpdates[HYPR_INDEX_SYNC_STATE_KEYS.changesCursor] = checkpointCursor;
        }

        addTotals(totals, await applySnapshotPage(syncStore, response, syncStateUpdates));

        if (!response.hasMore) {
            return totals;
        }

        if (!nextCursor || nextCursor === cursor) {
            throw new Error('Snapshot export did not advance cursor');
        }

        cursor = nextCursor;
    }
}

async function syncChanges(
    syncStore: OperationSyncStore,
    gatekeeper: BootstrapGatekeeper,
    pageLimit: number
): Promise<ImportTotals> {
    const totals: ImportTotals = {
        pages: 0,
        exported: 0,
        mapped: 0,
        invalid: 0,
        inserted: 0,
        updated: 0,
    };
    let cursor = await syncStore.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor);

    while (true) {
        const response = await gatekeeper.exportIndex({
            mode: 'changes',
            cursor,
            limit: pageLimit,
            includeOperations: true,
        });

        if (response.mode !== 'changes') {
            throw new Error(`Expected changes export response, got ${response.mode}`);
        }

        const nextCursor = response.cursor ?? cursor ?? '0';
        addTotals(totals, await applyChangesPage(syncStore, response, {
            [HYPR_INDEX_SYNC_STATE_KEYS.changesCursor]: nextCursor,
        }));

        if (!response.hasMore) {
            return totals;
        }

        if (!nextCursor || nextCursor === cursor) {
            throw new Error('Changes export did not advance cursor');
        }

        cursor = nextCursor;
    }
}

export async function bootstrapSyncStoreFromGatekeeper(
    syncStore: OperationSyncStore,
    gatekeeper: BootstrapGatekeeper,
    options: BootstrapOptions = {},
): Promise<BootstrapResult> {
    const startedAt = Date.now();
    const countBefore = await syncStore.count();
    const pageLimit = options.pageLimit ?? DEFAULT_INDEX_EXPORT_PAGE_LIMIT;
    const snapshotCompleteBefore = await syncStore.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete) === 'true';
    const mode = snapshotCompleteBefore ? 'changes' : 'snapshot';
    const imported = snapshotCompleteBefore
        ? await syncChanges(syncStore, gatekeeper, pageLimit)
        : await syncSnapshot(syncStore, gatekeeper, pageLimit);
    const countAfter = await syncStore.count();
    const snapshotCompleteAfter = await syncStore.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete) === 'true';

    return {
        countBefore,
        countAfter,
        mode,
        pages: imported.pages,
        exported: imported.exported,
        mapped: imported.mapped,
        invalid: imported.invalid,
        inserted: imported.inserted,
        updated: imported.updated,
        snapshotComplete: snapshotCompleteAfter,
        durationMs: Date.now() - startedAt,
    };
}
