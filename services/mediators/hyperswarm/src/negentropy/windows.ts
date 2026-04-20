import type { SyncStoreCursor } from '../db/types.js';
import type { ReconciliationWindow } from './adapter.js';

export const MDIP_EPOCH_SECONDS = 1_704_067_200; // 2024-01-01T00:00:00Z

function cloneCursor(cursor?: SyncStoreCursor | null): SyncStoreCursor | null {
    if (!cursor) {
        return null;
    }

    return {
        ts: cursor.ts,
        id: cursor.id,
    };
}

export function buildInitialHistoryWindow(
    fromTs: number,
    toTs: number,
    maxRecords: number,
    after?: SyncStoreCursor | null,
    order = 0,
): ReconciliationWindow {
    return {
        name: 'history_paged',
        fromTs,
        toTs,
        maxRecords,
        order,
        after: cloneCursor(after) ?? undefined,
    };
}

export function buildNextHistoryPage(window: ReconciliationWindow, after: SyncStoreCursor, order: number): ReconciliationWindow {
    return {
        name: window.name,
        fromTs: window.fromTs,
        toTs: window.toTs,
        maxRecords: window.maxRecords,
        order,
        after: cloneCursor(after) ?? undefined,
    };
}

export function buildRoundCapSplitWindow(window: ReconciliationWindow): ReconciliationWindow | null {
    const splitMaxRecords = Math.ceil(window.maxRecords / 2);
    if (splitMaxRecords >= window.maxRecords) {
        return null;
    }

    return {
        name: window.name,
        fromTs: window.fromTs,
        toTs: window.toTs,
        maxRecords: splitMaxRecords,
        order: window.order,
        after: cloneCursor(window.after) ?? undefined,
    };
}
