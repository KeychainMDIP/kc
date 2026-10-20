import {
    buildSyncStatsSnapshot,
    createMediatorSyncStats,
    recordProtocolStrike,
} from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';
import { createPeerAdmissionPolicy } from '../../services/mediators/hyperswarm/src/peer-admission.ts';

describe('hardening metrics', () => {
    it('uses fixed strike categories without retaining remote details', () => {
        const stats = createMediatorSyncStats();
        recordProtocolStrike(stats, 'malformed_framed_message');
        recordProtocolStrike(stats, 'invalid_message_envelope');
        recordProtocolStrike(stats, 'invalid_queue_payload', 'operation page exceeds 300 operations');
        recordProtocolStrike(stats, 'invalid_queue_operation: content ID mismatch');
        recordProtocolStrike(stats, 'unsolicited_ordered_catchup_push');
        recordProtocolStrike(stats, 'invalid_ops_req: ID list exceeds 1000 entries');
        recordProtocolStrike(stats, 'ops_push contains an unsolicited or duplicate operation');
        recordProtocolStrike(stats, 'unrecognized error with remote text');
        recordProtocolStrike(stats, 'invalid_ops_push: operation at index 0 exceeds 524288 bytes');

        expect(stats.hardening).toMatchObject({
            oversizedOperationMessages: 2,
            oversizedIdMessages: 1,
            unsolicitedOrderedResponses: 1,
            unauthorizedNegentropyMessages: 1,
            malformedQueueOperations: 1,
            protocolStrikes: { framing: 1, envelope: 1, queue: 2, ordered: 1, negentropy: 3, other: 1 },
        });
        const snapshot = buildSyncStatsSnapshot(stats);
        expect(snapshot).toMatchObject({ hardening: stats.hardening });
        stats.hardening.protocolStrikes.other += 1;
        expect(snapshot).toMatchObject({ hardening: { protocolStrikes: { other: 1 } } });
        expect(JSON.stringify(snapshot)).not.toContain('remote text');
    });

    it('reports current admitted bytes and cumulative capacity failures', () => {
        const budget = createOperationPageBudget(1, 100);
        const reservation = budget.reserve(80)!;
        expect(budget.reserve(1)).toBeNull();
        expect(budget.getMetrics()).toEqual({ pages: 1, bytes: 80, admissionFailures: 1 });
        reservation.release();
        expect(budget.getMetrics()).toEqual({ pages: 0, bytes: 0, admissionFailures: 1 });
    });

    it('reports quarantine evictions without extending cooldowns during snapshots', () => {
        let now = 0;
        const policy = createPeerAdmissionPolicy({ maxEntries: 1, now: () => now });
        policy.noteViolation('one', 'test');
        policy.noteViolation('two', 'test');
        expect(policy.evictions).toBe(1);
        expect(policy.counts()).toEqual({ punitive: 1, compatibility: 0, retainedStrikes: 0, total: 1 });
        now = 60_000;
        expect(policy.counts()).toEqual({ punitive: 0, compatibility: 0, retainedStrikes: 1, total: 1 });
    });
});
