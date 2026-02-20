import {
    shouldAcceptLegacySync,
    shouldSchedulePeriodicRepair,
    shouldStartConnectTimeNegentropy,
} from '../../services/mediators/hyperswarm/src/negentropy/policy.ts';

describe('negentropy sync policy', () => {
    it('accepts legacy sync only when enabled and mode is explicitly legacy', () => {
        expect(shouldAcceptLegacySync('legacy', true)).toBe(true);
        expect(shouldAcceptLegacySync('unknown', true)).toBe(false);
        expect(shouldAcceptLegacySync('negentropy', true)).toBe(false);
        expect(shouldAcceptLegacySync('legacy', false)).toBe(false);
    });

    it('starts connect-time negentropy only for initiator without active session', () => {
        expect(shouldStartConnectTimeNegentropy('negentropy', false, true)).toBe(true);
        expect(shouldStartConnectTimeNegentropy('negentropy', true, true)).toBe(false);
        expect(shouldStartConnectTimeNegentropy('negentropy', false, false)).toBe(false);
        expect(shouldStartConnectTimeNegentropy('legacy', false, true)).toBe(false);
    });

    it('schedules periodic repair only when all guards pass', () => {
        const base = {
            syncMode: 'negentropy' as const,
            hasActiveSession: false,
            importQueueLength: 0,
            activeNegentropySessions: 0,
            lastRepairAtMs: 0,
            nowMs: 1_000_000,
            repairIntervalMs: 300_000,
            isInitiator: true,
        };

        expect(shouldSchedulePeriodicRepair(base)).toBe(true);
        expect(shouldSchedulePeriodicRepair({ ...base, isInitiator: false })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, hasActiveSession: true })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, importQueueLength: 1 })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, activeNegentropySessions: 1 })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, syncMode: 'legacy' })).toBe(false);
        expect(shouldSchedulePeriodicRepair({
            ...base,
            lastRepairAtMs: base.nowMs - 10_000,
        })).toBe(false);
    });
});
