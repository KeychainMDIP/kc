import {
    getExpectedOrderedCatchupRequestDecision,
    getOrderedCatchupDecision,
} from '../../services/mediators/hyperswarm/src/ordered-catchup.ts';
import type { NegotiatedPeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';

function makePeer(overrides: Partial<NegotiatedPeerCapabilities> = {}): NegotiatedPeerCapabilities {
    return {
        advertised: true,
        negentropy: true,
        version: 1,
        orderedCatchup: true,
        orderedCatchupVersion: 1,
        orderedCatchupReady: true,
        operationCount: 100,
        orderedOperationCount: 100,
        ...overrides,
    };
}

describe('ordered catch-up decision', () => {
    it('enables ordered catch-up for a clean local node', () => {
        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer(),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup: true,
            reason: 'cold_start',
            gap: 100,
        });
    });

    it.each([
        ['below one window', 24, 25, true, 'cold_start'],
        ['at one window with a small gap', 25, 26, false, 'not_far_behind'],
        ['exactly half behind', 50, 100, true, 'substantially_behind'],
        ['just under half behind', 51, 100, false, 'not_far_behind'],
        ['substantially behind a large peer', 100_000, 275_000, true, 'substantially_behind'],
        ['one window behind a large peer', 250_000, 275_000, false, 'not_far_behind'],
    ] as const)('selects the expected mode when local is %s', (
        _case,
        localOperationCount,
        peerOperationCount,
        useOrderedCatchup,
        reason,
    ) => {
        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount,
            peerCapabilities: makePeer({
                operationCount: peerOperationCount,
                orderedOperationCount: peerOperationCount,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup,
            reason,
            gap: peerOperationCount - localOperationCount,
        });
    });

    it('requires peer protocol support and readiness', () => {
        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer({ orderedCatchup: false }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_unsupported',
        });

        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer({ orderedCatchupReady: false }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_unready',
        });
    });

    it('requires complete ordered peer history counts', () => {
        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer({ operationCount: null }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_counts_missing',
        });

        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer({ orderedOperationCount: 99 }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_ordered_count_mismatch',
        });
    });

    it('does not use ordered catch-up when disabled or peer is not ahead', () => {
        expect(getOrderedCatchupDecision({
            enabled: false,
            localOperationCount: 0,
            peerCapabilities: makePeer(),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'disabled',
        });

        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 100,
            peerCapabilities: makePeer(),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_not_ahead',
            gap: 0,
        });
    });
});

describe('expected ordered catch-up request decision', () => {
    it('does not expect a request when ordered catch-up is disabled', () => {
        expect(getExpectedOrderedCatchupRequestDecision({
            enabled: false,
            localOperationCount: 100,
            localOrderedOperationCount: 100,
            peerCapabilities: makePeer({
                operationCount: 0,
                orderedOperationCount: 0,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            expectRequest: false,
            reason: 'disabled',
            gap: 0,
        });
    });

    it('expects an empty ordered-catchup peer to request from a ready local node', () => {
        expect(getExpectedOrderedCatchupRequestDecision({
            enabled: true,
            localOperationCount: 100,
            localOrderedOperationCount: 100,
            peerCapabilities: makePeer({
                orderedCatchupReady: false,
                operationCount: 0,
                orderedOperationCount: 0,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            expectRequest: true,
            reason: 'cold_start',
            gap: 100,
        });
    });

    it.each([
        ['below one window', 24, 25, true, 'cold_start'],
        ['at one window with a small gap', 25, 26, false, 'not_far_behind'],
        ['exactly half behind', 50, 100, true, 'substantially_behind'],
        ['just under half behind', 51, 100, false, 'not_far_behind'],
        ['substantially behind a large source', 100_000, 275_000, true, 'substantially_behind'],
        ['one window behind a large source', 250_000, 275_000, false, 'not_far_behind'],
    ] as const)('expects the matching request decision when the peer is %s', (
        _case,
        peerOperationCount,
        localOperationCount,
        expectRequest,
        reason,
    ) => {
        expect(getExpectedOrderedCatchupRequestDecision({
            enabled: true,
            localOperationCount,
            localOrderedOperationCount: localOperationCount,
            peerCapabilities: makePeer({
                operationCount: peerOperationCount,
                orderedOperationCount: peerOperationCount,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            expectRequest,
            reason,
            gap: localOperationCount - peerOperationCount,
        });
    });

    it('does not expect a request when the local node is not fully ordered', () => {
        expect(getExpectedOrderedCatchupRequestDecision({
            enabled: true,
            localOperationCount: 100,
            localOrderedOperationCount: 99,
            peerCapabilities: makePeer({
                operationCount: 0,
                orderedOperationCount: 0,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            expectRequest: false,
            reason: 'local_unready',
            gap: 0,
        });
    });

    it('requires peer support and operation count metadata before expecting a request', () => {
        expect(getExpectedOrderedCatchupRequestDecision({
            enabled: true,
            localOperationCount: 100,
            localOrderedOperationCount: 100,
            peerCapabilities: makePeer({
                orderedCatchup: false,
                operationCount: 0,
                orderedOperationCount: 0,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            expectRequest: false,
            reason: 'peer_unsupported',
            gap: 0,
        });

        expect(getExpectedOrderedCatchupRequestDecision({
            enabled: true,
            localOperationCount: 100,
            localOrderedOperationCount: 100,
            peerCapabilities: makePeer({
                operationCount: null,
                orderedOperationCount: null,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            expectRequest: false,
            reason: 'peer_counts_missing',
            gap: 0,
        });
    });

    it('does not expect a request when the peer is not behind', () => {
        expect(getExpectedOrderedCatchupRequestDecision({
            enabled: true,
            localOperationCount: 100,
            localOrderedOperationCount: 100,
            peerCapabilities: makePeer({
                operationCount: 100,
                orderedOperationCount: 100,
            }),
            requiredVersion: 1,
            windowSize: 25,
        })).toMatchObject({
            expectRequest: false,
            reason: 'peer_not_behind',
            gap: 0,
        });
    });
});
