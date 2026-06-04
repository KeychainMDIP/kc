import {
    getOrderedCatchupDecision,
} from '../../services/mediators/hyperswarm/src/ordered-catchup.ts';
import type { NegotiatedPeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';

function makePeer(overrides: Partial<NegotiatedPeerCapabilities> = {}): NegotiatedPeerCapabilities {
    return {
        advertised: true,
        negentropy: true,
        version: 2,
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
            threshold: 25,
        })).toMatchObject({
            useOrderedCatchup: true,
            reason: 'enabled',
            gap: 100,
        });
    });

    it('enables ordered catch-up for a far-behind local node', () => {
        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 70,
            peerCapabilities: makePeer(),
            requiredVersion: 1,
            threshold: 25,
        })).toMatchObject({
            useOrderedCatchup: true,
            reason: 'enabled',
            gap: 30,
        });
    });

    it('does not use ordered catch-up when the local node is not far behind', () => {
        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 90,
            peerCapabilities: makePeer(),
            requiredVersion: 1,
            threshold: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'not_far_behind',
            gap: 10,
        });
    });

    it('requires peer protocol support and readiness', () => {
        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer({ orderedCatchup: false }),
            requiredVersion: 1,
            threshold: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_unsupported',
        });

        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer({ orderedCatchupReady: false }),
            requiredVersion: 1,
            threshold: 25,
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
            threshold: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_counts_missing',
        });

        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 0,
            peerCapabilities: makePeer({ orderedOperationCount: 99 }),
            requiredVersion: 1,
            threshold: 25,
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
            threshold: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'disabled',
        });

        expect(getOrderedCatchupDecision({
            enabled: true,
            localOperationCount: 100,
            peerCapabilities: makePeer(),
            requiredVersion: 1,
            threshold: 25,
        })).toMatchObject({
            useOrderedCatchup: false,
            reason: 'peer_not_ahead',
            gap: 0,
        });
    });
});
