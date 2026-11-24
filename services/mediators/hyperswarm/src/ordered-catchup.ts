import type {
    SyncOperationRecord,
    SyncStoreOrderedCursor,
} from './db/types.js';
import {
    NEG_SYNC_ID_RE,
    type NegotiatedPeerCapabilities,
} from './negentropy/protocol.js';

export type OrderedCatchupDecisionReason =
    | 'cold_start'
    | 'substantially_behind'
    | 'peer_unsupported'
    | 'peer_unready'
    | 'peer_counts_missing'
    | 'peer_ordered_count_mismatch'
    | 'peer_not_ahead'
    | 'not_far_behind';

export type ExpectedOrderedCatchupRequestReason =
    | 'cold_start'
    | 'substantially_behind'
    | 'local_unready'
    | 'peer_unsupported'
    | 'peer_counts_missing'
    | 'peer_not_behind'
    | 'not_far_behind';

export interface OrderedCatchupDecisionOptions {
    localOperationCount: number;
    peerCapabilities: NegotiatedPeerCapabilities;
    windowSize: number;
}

export interface OrderedCatchupDecision {
    useOrderedCatchup: boolean;
    reason: OrderedCatchupDecisionReason;
    gap: number;
}

export interface ExpectedOrderedCatchupRequestOptions {
    localOperationCount: number;
    localOrderedOperationCount: number;
    peerCapabilities: NegotiatedPeerCapabilities;
    windowSize: number;
}

export interface ExpectedOrderedCatchupRequestDecision {
    expectRequest: boolean;
    reason: ExpectedOrderedCatchupRequestReason;
    gap: number;
}

const ORDERED_CATCHUP_MIN_MISSING_RATIO = 0.5;

export function parseOrderedCatchupCursor(cursor: unknown): SyncStoreOrderedCursor | undefined | null {
    if (cursor == null) {
        return undefined;
    }

    if (typeof cursor !== 'object') {
        return null;
    }

    const raw = cursor as Partial<SyncStoreOrderedCursor>;
    if (!Number.isSafeInteger(raw.syncOrder) || raw.syncOrder! < 0) {
        return null;
    }

    if (typeof raw.id !== 'string' || !NEG_SYNC_ID_RE.test(raw.id)) {
        return null;
    }

    return {
        syncOrder: raw.syncOrder!,
        id: raw.id.toLowerCase(),
    };
}

export function getOrderedCursorFromRow(row: SyncOperationRecord): SyncStoreOrderedCursor | null {
    if (!Number.isSafeInteger(row.syncOrder)) {
        return null;
    }

    return {
        syncOrder: row.syncOrder!,
        id: row.id,
    };
}

export function isOrderedCursorAfter(next: SyncStoreOrderedCursor, previous: SyncStoreOrderedCursor): boolean {
    return next.syncOrder > previous.syncOrder
        || (next.syncOrder === previous.syncOrder && next.id > previous.id);
}

export function getOrderedCatchupDecision(options: OrderedCatchupDecisionOptions): OrderedCatchupDecision {
    const peer = options.peerCapabilities.ordered;
    const localOperationCount = normalizeCount(options.localOperationCount);
    const windowSize = Math.max(1, normalizeCount(options.windowSize));

    if (!peer) {
        return { useOrderedCatchup: false, reason: 'peer_unsupported', gap: 0 };
    }

    if (!peer.sourceReady) {
        return { useOrderedCatchup: false, reason: 'peer_unready', gap: 0 };
    }

    const gap = peer.count - localOperationCount;
    if (gap <= 0) {
        return { useOrderedCatchup: false, reason: 'peer_not_ahead', gap };
    }

    const reason = getOrderedCatchupReason(localOperationCount, peer.count, windowSize);
    if (reason) {
        return { useOrderedCatchup: true, reason, gap };
    }

    return { useOrderedCatchup: false, reason: 'not_far_behind', gap };
}

export function getExpectedOrderedCatchupRequestDecision(
    options: ExpectedOrderedCatchupRequestOptions,
): ExpectedOrderedCatchupRequestDecision {
    const peer = options.peerCapabilities.ordered;
    const localOperationCount = normalizeCount(options.localOperationCount);
    const localOrderedOperationCount = normalizeCount(options.localOrderedOperationCount);
    const windowSize = Math.max(1, normalizeCount(options.windowSize));

    if (localOperationCount === 0 || localOperationCount !== localOrderedOperationCount) {
        return { expectRequest: false, reason: 'local_unready', gap: 0 };
    }

    if (!peer) {
        return { expectRequest: false, reason: 'peer_unsupported', gap: 0 };
    }

    const gap = localOperationCount - peer.count;
    if (gap <= 0) {
        return { expectRequest: false, reason: 'peer_not_behind', gap };
    }

    const reason = getOrderedCatchupReason(peer.count, localOperationCount, windowSize);
    if (reason) {
        return { expectRequest: true, reason, gap };
    }

    return { expectRequest: false, reason: 'not_far_behind', gap };
}

function getOrderedCatchupReason(
    receiverOperationCount: number,
    sourceOperationCount: number,
    windowSize: number,
): 'cold_start' | 'substantially_behind' | null {
    if (receiverOperationCount < windowSize) {
        return 'cold_start';
    }

    const gap = sourceOperationCount - receiverOperationCount;
    return gap / sourceOperationCount >= ORDERED_CATCHUP_MIN_MISSING_RATIO
        ? 'substantially_behind'
        : null;
}

function normalizeCount(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
