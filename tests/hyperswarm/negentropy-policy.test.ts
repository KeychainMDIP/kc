import {
    decideInboundNegOpenConflict,
    hasActiveOrderedCatchupSession,
    shouldSchedulePeriodicRepair,
    shouldStartConnectTimeNegentropy,
    shouldStartPostOrderedCatchupNegentropy,
} from '../../services/mediators/hyperswarm/src/negentropy/policy.ts';

describe('negentropy sync policy', () => {
    it('detects active ordered catch-up in either direction', () => {
        expect(hasActiveOrderedCatchupSession({
            orderedCatchupClientSessionId: null,
            orderedCatchupServerSessionId: null,
        })).toBe(false);
        expect(hasActiveOrderedCatchupSession({
            orderedCatchupClientSessionId: 'client-session',
            orderedCatchupServerSessionId: null,
        })).toBe(true);
        expect(hasActiveOrderedCatchupSession({
            orderedCatchupClientSessionId: null,
            orderedCatchupServerSessionId: 'server-session',
        })).toBe(true);
    });

    it('decides inbound neg_open conflicts without replacing active ordered catch-up', () => {
        expect(decideInboundNegOpenConflict({
            activeSessionMode: null,
            activeSessionId: null,
            activeOrderedCatchupSessionId: null,
            remoteSessionId: 'remote-negentropy',
        })).toStrictEqual({ action: 'accept' });

        expect(decideInboundNegOpenConflict({
            activeSessionMode: 'negentropy',
            activeSessionId: 'remote-negentropy',
            activeOrderedCatchupSessionId: null,
            remoteSessionId: 'remote-negentropy',
        })).toStrictEqual({ action: 'accept' });

        expect(decideInboundNegOpenConflict({
            activeSessionMode: 'negentropy',
            activeSessionId: 'local-negentropy',
            activeOrderedCatchupSessionId: null,
            remoteSessionId: 'remote-negentropy',
        })).toStrictEqual({ action: 'replace' });

        expect(decideInboundNegOpenConflict({
            activeSessionMode: 'ordered_catchup',
            activeSessionId: 'ordered-client',
            activeOrderedCatchupSessionId: 'ordered-client',
            remoteSessionId: 'remote-negentropy',
        })).toStrictEqual({ action: 'ignore', reason: 'ordered_catchup_active' });

        expect(decideInboundNegOpenConflict({
            activeSessionMode: null,
            activeSessionId: null,
            activeOrderedCatchupSessionId: 'ordered-server',
            remoteSessionId: 'remote-negentropy',
        })).toStrictEqual({ action: 'ignore', reason: 'ordered_catchup_active' });
    });

    it('starts connect-time negentropy only for initiator without active session', () => {
        expect(shouldStartConnectTimeNegentropy('negentropy', false, true)).toBe(true);
        expect(shouldStartConnectTimeNegentropy('negentropy', true, true)).toBe(false);
        expect(shouldStartConnectTimeNegentropy('negentropy', false, false)).toBe(false);
    });

    it('suppresses normal negentropy while ordered catch-up is active', () => {
        const repairBase = {
            syncMode: 'negentropy' as const,
            hasActiveSession: false,
            importQueueLength: 0,
            activeNegentropySessions: 0,
            lastAttemptAtMs: 0,
            nowMs: 1_000_000,
            repairIntervalMs: 300_000,
            isInitiator: true,
            syncCompleted: false,
        };
        const states = [
            {
                orderedCatchupClientSessionId: 'client-session',
                orderedCatchupServerSessionId: null,
            },
            {
                orderedCatchupClientSessionId: null,
                orderedCatchupServerSessionId: 'server-session',
            },
        ];

        for (const state of states) {
            const orderedCatchupActive = hasActiveOrderedCatchupSession(state);
            expect(shouldStartConnectTimeNegentropy('negentropy', false, true, orderedCatchupActive)).toBe(false);
            expect(shouldSchedulePeriodicRepair({ ...repairBase, orderedCatchupActive })).toBe(false);
        }
    });

    it('schedules periodic repair only when all guards pass', () => {
        const base = {
            syncMode: 'negentropy' as const,
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
            syncMode: 'negentropy' as const,
            peerConnected: true,
            peerSupportsNegentropyTransport: true,
            hasActiveSession: false,
            importQueueLength: 0,
            importQueueRunning: 0,
            activeNegentropySessions: 0,
            syncCompleted: false,
        };

        expect(shouldStartPostOrderedCatchupNegentropy(base)).toBe(true);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, peerConnected: false })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({
            ...base,
            peerSupportsNegentropyTransport: false,
        })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, hasActiveSession: true })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, importQueueLength: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, importQueueRunning: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, activeNegentropySessions: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, syncCompleted: true })).toBe(false);
    });

});
