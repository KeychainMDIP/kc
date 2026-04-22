import type { SyncStoreCursor } from '../db/types.js';

export function compareSyncCursor(a: SyncStoreCursor, b: SyncStoreCursor): number {
    if (a.ts !== b.ts) {
        return a.ts - b.ts;
    }

    if (a.id < b.id) {
        return -1;
    }

    if (a.id > b.id) {
        return 1;
    }

    return 0;
}

function cloneCursor(cursor?: SyncStoreCursor | null): SyncStoreCursor | null {
    if (!cursor) {
        return null;
    }

    return {
        ts: cursor.ts,
        id: cursor.id,
    };
}

function minCursor(a: SyncStoreCursor | null, b: SyncStoreCursor | null): SyncStoreCursor | null {
    if (!a) {
        return cloneCursor(b);
    }

    if (!b) {
        return cloneCursor(a);
    }

    return compareSyncCursor(a, b) <= 0
        ? cloneCursor(a)
        : cloneCursor(b);
}

function maxCursor(a: SyncStoreCursor | null, b: SyncStoreCursor | null): SyncStoreCursor | null {
    if (!a) {
        return cloneCursor(b);
    }

    if (!b) {
        return cloneCursor(a);
    }

    return compareSyncCursor(a, b) >= 0
        ? cloneCursor(a)
        : cloneCursor(b);
}

export interface ContinuationCursorDecisionInput {
    windowName: string;
    windowAfter: SyncStoreCursor | null;
    windowMaxRecords: number;
    localCappedByRecords: boolean;
    localLastCursor: SyncStoreCursor | null;
    remoteCappedByRecords: boolean;
    remoteLastCursor: SyncStoreCursor | null;
    receivedPushCount: number;
    receivedKnownPushCount: number;
    receivedPushMaxCursor: SyncStoreCursor | null;
}

export interface ContinuationCursorDecision {
    chosenCursor: SyncStoreCursor | null;
    blockedByAfter: boolean;
}

export function getContinuationCursorDecision(input: ContinuationCursorDecisionInput): ContinuationCursorDecision {
    let cursor: SyncStoreCursor | null = null;
    const allReceivedPushesAlreadyKnown = input.receivedPushCount > 0
        && input.receivedKnownPushCount === input.receivedPushCount;

    if (input.localCappedByRecords && input.localLastCursor) {
        cursor = cloneCursor(input.localLastCursor);
    }

    if (input.remoteCappedByRecords && input.remoteLastCursor) {
        cursor = allReceivedPushesAlreadyKnown
            ? maxCursor(cursor, input.remoteLastCursor)
            : minCursor(cursor, input.remoteLastCursor);
    }

    if (!cursor && input.windowName === 'history_paged' && input.receivedPushCount >= input.windowMaxRecords) {
        cursor = cloneCursor(input.receivedPushMaxCursor);
    }

    let blockedByAfter = false;
    if (cursor && input.windowAfter && compareSyncCursor(cursor, input.windowAfter) <= 0) {
        blockedByAfter = true;
        cursor = null;
    }

    return {
        chosenCursor: cursor,
        blockedByAfter,
    };
}
