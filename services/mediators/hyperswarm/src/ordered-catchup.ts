import type { NegotiatedPeerCapabilities } from './negentropy/protocol.js';

export type OrderedCatchupDecisionReason =
    | 'enabled'
    | 'disabled'
    | 'peer_unsupported'
    | 'peer_unready'
    | 'peer_counts_missing'
    | 'peer_ordered_count_mismatch'
    | 'peer_not_ahead'
    | 'not_far_behind';

export type ExpectedOrderedCatchupRequestReason =
    | 'enabled'
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
    threshold: number;
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
    threshold: number;
}

export interface ExpectedOrderedCatchupRequestDecision {
    expectRequest: boolean;
    reason: ExpectedOrderedCatchupRequestReason;
    gap: number;
}

export function getOrderedCatchupDecision(options: OrderedCatchupDecisionOptions): OrderedCatchupDecision {
    const peer = options.peerCapabilities;
    const localOperationCount = normalizeCount(options.localOperationCount);
    const peerOperationCount = peer.operationCount;
    const peerOrderedOperationCount = peer.orderedOperationCount;
    const threshold = Math.max(1, normalizeCount(options.threshold));

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

    if (localOperationCount === 0 || gap >= threshold) {
        return { useOrderedCatchup: true, reason: 'enabled', gap };
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
    const threshold = Math.max(1, normalizeCount(options.threshold));

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

    if (peerOperationCount === 0 || gap >= threshold) {
        return { expectRequest: true, reason: 'enabled', gap };
    }

    return { expectRequest: false, reason: 'not_far_behind', gap };
}

function normalizeCount(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
