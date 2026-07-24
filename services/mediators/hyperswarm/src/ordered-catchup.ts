import type { NegotiatedPeerCapabilities } from './negentropy/protocol.js';

export type OrderedCatchupDecisionReason =
    | 'cold_start'
    | 'substantially_behind'
    | 'disabled'
    | 'peer_unsupported'
    | 'peer_unready'
    | 'peer_counts_missing'
    | 'peer_ordered_count_mismatch'
    | 'peer_not_ahead'
    | 'not_far_behind';

export type ExpectedOrderedCatchupRequestReason =
    | 'cold_start'
    | 'substantially_behind'
    | 'disabled'
    | 'local_unready'
    | 'peer_unsupported'
    | 'peer_counts_missing'
    | 'peer_not_behind'
    | 'not_far_behind';

export interface OrderedCatchupDecisionOptions {
    enabled: boolean;
    localOperationCount: number;
    peerCapabilities: NegotiatedPeerCapabilities;
    requiredVersion: number;
    windowSize: number;
}

export interface OrderedCatchupDecision {
    useOrderedCatchup: boolean;
    reason: OrderedCatchupDecisionReason;
    gap: number;
}

export interface ExpectedOrderedCatchupRequestOptions {
    enabled: boolean;
    localOperationCount: number;
    localOrderedOperationCount: number;
    peerCapabilities: NegotiatedPeerCapabilities;
    requiredVersion: number;
    windowSize: number;
}

export interface ExpectedOrderedCatchupRequestDecision {
    expectRequest: boolean;
    reason: ExpectedOrderedCatchupRequestReason;
    gap: number;
}

const ORDERED_CATCHUP_MIN_MISSING_RATIO = 0.5;

export function getOrderedCatchupDecision(options: OrderedCatchupDecisionOptions): OrderedCatchupDecision {
    const peer = options.peerCapabilities;
    const localOperationCount = normalizeCount(options.localOperationCount);
    const peerOperationCount = peer.operationCount;
    const peerOrderedOperationCount = peer.orderedOperationCount;
    const windowSize = Math.max(1, normalizeCount(options.windowSize));

    if (!options.enabled) {
        return { useOrderedCatchup: false, reason: 'disabled', gap: 0 };
    }

    if (peer.orderedCatchup !== true || peer.orderedCatchupVersion !== options.requiredVersion) {
        return { useOrderedCatchup: false, reason: 'peer_unsupported', gap: 0 };
    }

    if (peer.orderedCatchupReady !== true) {
        return { useOrderedCatchup: false, reason: 'peer_unready', gap: 0 };
    }

    if (peerOperationCount === null || peerOrderedOperationCount === null) {
        return { useOrderedCatchup: false, reason: 'peer_counts_missing', gap: 0 };
    }

    if (peerOperationCount !== peerOrderedOperationCount) {
        return { useOrderedCatchup: false, reason: 'peer_ordered_count_mismatch', gap: 0 };
    }

    const gap = peerOperationCount - localOperationCount;
    if (gap <= 0) {
        return { useOrderedCatchup: false, reason: 'peer_not_ahead', gap };
    }

    const reason = getOrderedCatchupReason(localOperationCount, peerOperationCount, windowSize);
    if (reason) {
        return { useOrderedCatchup: true, reason, gap };
    }

    return { useOrderedCatchup: false, reason: 'not_far_behind', gap };
}

export function getExpectedOrderedCatchupRequestDecision(
    options: ExpectedOrderedCatchupRequestOptions,
): ExpectedOrderedCatchupRequestDecision {
    const peer = options.peerCapabilities;
    const localOperationCount = normalizeCount(options.localOperationCount);
    const localOrderedOperationCount = normalizeCount(options.localOrderedOperationCount);
    const peerOperationCount = peer.operationCount;
    const windowSize = Math.max(1, normalizeCount(options.windowSize));

    if (!options.enabled) {
        return { expectRequest: false, reason: 'disabled', gap: 0 };
    }

    if (localOperationCount === 0 || localOperationCount !== localOrderedOperationCount) {
        return { expectRequest: false, reason: 'local_unready', gap: 0 };
    }

    if (peer.orderedCatchup !== true || peer.orderedCatchupVersion !== options.requiredVersion) {
        return { expectRequest: false, reason: 'peer_unsupported', gap: 0 };
    }

    if (peerOperationCount === null) {
        return { expectRequest: false, reason: 'peer_counts_missing', gap: 0 };
    }

    const gap = localOperationCount - peerOperationCount;
    if (gap <= 0) {
        return { expectRequest: false, reason: 'peer_not_behind', gap };
    }

    const reason = getOrderedCatchupReason(peerOperationCount, localOperationCount, windowSize);
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
