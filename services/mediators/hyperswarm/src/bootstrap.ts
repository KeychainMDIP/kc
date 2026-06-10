import type {
    GatekeeperEvent,
    IndexExportRequest,
    IndexExportResponse,
    Operation,
} from '@mdip/gatekeeper/types';
import { childLogger } from '@mdip/common/logger';
import type { OperationSyncStore } from './db/types.js';
import {
    mapAcceptedOperationsToSyncRecords,
    mapIndexExportOperationsToSyncRecords,
} from './sync-persistence.js';

const DEFAULT_INDEX_EXPORT_PAGE_LIMIT = 500;
const log = childLogger({ service: 'hyperswarm-bootstrap' });
const STALE_SYNC_STORE_RESET_REASON = 'gatekeeper_checkpoint_behind_sync_cursor';
type BootstrapLogLevel = 'debug' | 'error' | 'warn';

function writeLog(
    level: BootstrapLogLevel,
    payload: Record<string, unknown>,
    message: string
): void {
    const method = log[level] as unknown;

    if (typeof method === 'function') {
        method.call(log, payload, message);
    }
}

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
    resetReason?: string;
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

class StaleSyncStoreError extends Error {
    readonly savedCursor: string;
    readonly gatekeeperCheckpointCursor: string;

    constructor(savedCursor: string, gatekeeperCheckpointCursor: string) {
        super('Stored hyperswarm sync cursor is ahead of gatekeeper checkpoint');
        this.name = 'StaleSyncStoreError';
        this.savedCursor = savedCursor;
        this.gatekeeperCheckpointCursor = gatekeeperCheckpointCursor;
    }
}

interface SnapshotLogState {
    pageLimit: number;
    pages: number;
    exported: number;
    mapped: number;
    invalid: number;
    inserted: number;
    updated: number;
    requestCursor: string | null | undefined;
    nextCursor: string | null | undefined;
    checkpointCursor: string | null | undefined;
    hasMore: boolean | null;
    snapshotComplete: boolean;
    durationMs: number;
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

function parseNonNegativeCursor(cursor: string | null | undefined): number | null {
    if (cursor === null || cursor === undefined || cursor === '') {
        return 0;
    }

    if (!/^\d+$/.test(cursor)) {
        return null;
    }

    const parsed = Number(cursor);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function assertSyncStoreCursorWithinGatekeeperCheckpoint(
    savedCursor: string | null,
    checkpointCursor: string | null | undefined
): void {
    const saved = parseNonNegativeCursor(savedCursor);
    const checkpoint = parseNonNegativeCursor(checkpointCursor);

    if (saved === null || checkpoint === null) {
        return;
    }

    if (saved > checkpoint) {
        throw new StaleSyncStoreError(savedCursor ?? '0', checkpointCursor ?? '0');
    }
}

function buildSnapshotLogState(params: {
    totals: ImportTotals;
    pageLimit: number;
    requestCursor?: string | null;
    nextCursor?: string | null;
    checkpointCursor?: string | null;
    hasMore?: boolean | null;
    snapshotComplete: boolean;
    startedAt: number;
}): SnapshotLogState {
    return {
        pageLimit: params.pageLimit,
        pages: params.totals.pages,
        exported: params.totals.exported,
        mapped: params.totals.mapped,
        invalid: params.totals.invalid,
        inserted: params.totals.inserted,
        updated: params.totals.updated,
        requestCursor: params.requestCursor,
        nextCursor: params.nextCursor,
        checkpointCursor: params.checkpointCursor,
        hasMore: params.hasMore ?? null,
        snapshotComplete: params.snapshotComplete,
        durationMs: Date.now() - params.startedAt,
    };
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
    let requestCursor: string | null | undefined = cursor;
    let nextCursor: string | null | undefined = cursor;
    let responseHasMore: boolean | null = null;
    const startedAt = Date.now();

    if (cursor && !checkpointCursor) {
        throw new Error('Snapshot cursor found without checkpointCursor');
    }
    if (!cursor && checkpointCursor) {
        throw new Error('Snapshot checkpointCursor found without cursor');
    }

    writeLog('debug', {
        snapshot: buildSnapshotLogState({
            totals,
            pageLimit,
            requestCursor,
            nextCursor,
            checkpointCursor,
            hasMore: null,
            snapshotComplete: false,
            startedAt,
        }),
    }, 'snapshot bootstrap starting');

    try {
        while (true) {
            requestCursor = cursor;
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

            nextCursor = response.cursor;
            responseHasMore = response.hasMore;
            const syncStateUpdates: Record<string, string | null> = {
                [HYPR_INDEX_SYNC_STATE_KEYS.snapshotCursor]: nextCursor,
                [HYPR_INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor]: checkpointCursor,
            };

            if (!response.hasMore) {
                syncStateUpdates[HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete] = 'true';
                syncStateUpdates[HYPR_INDEX_SYNC_STATE_KEYS.changesCursor] = checkpointCursor;
            }

            const page = await applySnapshotPage(syncStore, response, syncStateUpdates);
            addTotals(totals, page);

            writeLog('debug', {
                snapshot: {
                    ...buildSnapshotLogState({
                        totals,
                        pageLimit,
                        requestCursor,
                        nextCursor,
                        checkpointCursor,
                        hasMore: response.hasMore,
                        snapshotComplete: !response.hasMore,
                        startedAt,
                    }),
                    page,
                },
            }, 'snapshot bootstrap page imported');

            if (!response.hasMore) {
                writeLog('debug', {
                    snapshot: buildSnapshotLogState({
                        totals,
                        pageLimit,
                        requestCursor,
                        nextCursor,
                        checkpointCursor,
                        hasMore: response.hasMore,
                        snapshotComplete: true,
                        startedAt,
                    }),
                }, 'snapshot bootstrap complete');
                return totals;
            }

            if (!nextCursor || nextCursor === cursor) {
                throw new Error('Snapshot export did not advance cursor');
            }

            cursor = nextCursor;
        }
    }
    catch (error) {
        writeLog('error', {
            error,
            snapshot: buildSnapshotLogState({
                totals,
                pageLimit,
                requestCursor,
                nextCursor,
                checkpointCursor,
                hasMore: responseHasMore,
                snapshotComplete: false,
                startedAt,
            }),
        }, 'snapshot bootstrap partially complete');
        throw error;
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
        if (response.checkpointCursor === undefined) {
            throw new Error('Changes export response missing checkpointCursor');
        }

        assertSyncStoreCursorWithinGatekeeperCheckpoint(cursor, response.checkpointCursor);

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
    let mode: BootstrapResult['mode'] = snapshotCompleteBefore ? 'changes' : 'snapshot';
    let resetReason: string | undefined;
    let imported: ImportTotals;

    try {
        imported = snapshotCompleteBefore
            ? await syncChanges(syncStore, gatekeeper, pageLimit)
            : await syncSnapshot(syncStore, gatekeeper, pageLimit);
    }
    catch (error) {
        if (!(error instanceof StaleSyncStoreError)) {
            throw error;
        }

        resetReason = STALE_SYNC_STORE_RESET_REASON;
        writeLog('warn', {
            reason: resetReason,
            savedCursor: error.savedCursor,
            gatekeeperCheckpointCursor: error.gatekeeperCheckpointCursor,
            countBefore,
        }, 'resetting stale hyperswarm sync store');

        await syncStore.reset();
        mode = 'snapshot';
        imported = await syncSnapshot(syncStore, gatekeeper, pageLimit);
    }

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
        ...(resetReason ? { resetReason } : {}),
    };
}
