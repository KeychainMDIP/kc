import {
    shouldSchedulePeriodicRepair,
    shouldStartConnectTimeNegentropy,
    shouldStartPostOrderedCatchupNegentropy,
} from '../../services/mediators/hyperswarm/src/negentropy/policy.ts';

describe('negentropy sync policy', () => {
    it('starts connect-time negentropy only for initiator without active session', () => {
        expect(shouldStartConnectTimeNegentropy(false, true)).toBe(true);
        expect(shouldStartConnectTimeNegentropy(true, true)).toBe(false);
        expect(shouldStartConnectTimeNegentropy(false, false)).toBe(false);
    });

    it('suppresses normal negentropy while ordered catch-up is active', () => {
        const repairBase = {
            hasActiveSession: false,
            importQueueLength: 0,
            activeNegentropySessions: 0,
            lastAttemptAtMs: 0,
            nowMs: 1_000_000,
            repairIntervalMs: 300_000,
            isInitiator: true,
            syncCompleted: false,
        };
        expect(shouldStartConnectTimeNegentropy(false, true, true)).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...repairBase, orderedCatchupActive: true })).toBe(false);
    });

    it('schedules periodic repair only when all guards pass', () => {
        const base = {
            hasActiveSession: false,
            importQueueLength: 0,
            activeNegentropySessions: 0,
            lastAttemptAtMs: 0,
            nowMs: 1_000_000,
            repairIntervalMs: 300_000,
            isInitiator: true,
            syncCompleted: false,
        };

        expect(shouldSchedulePeriodicRepair(base)).toBe(true);
        expect(shouldSchedulePeriodicRepair({ ...base, isInitiator: false })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, hasActiveSession: true })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, importQueueLength: 1 })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, importQueueRunning: 1 })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, activeNegentropySessions: 1 })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, syncCompleted: true })).toBe(false);
        expect(shouldSchedulePeriodicRepair({
            ...base,
            lastAttemptAtMs: base.nowMs - 10_000,
        })).toBe(false);
    });

    it('starts post ordered catch-up negentropy only after import work drains', () => {
        const base = {
            peerReady: true,
            hasActiveSession: false,
            importQueueLength: 0,
            importQueueRunning: 0,
            activeNegentropySessions: 0,
            syncCompleted: false,
        };

        expect(shouldStartPostOrderedCatchupNegentropy(base)).toBe(true);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, peerReady: false })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, hasActiveSession: true })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, importQueueLength: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, importQueueRunning: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, activeNegentropySessions: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, syncCompleted: true })).toBe(false);
    });

});
