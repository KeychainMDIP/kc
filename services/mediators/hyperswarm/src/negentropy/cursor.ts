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
