import {
    decideInboundNegOpenConflict,
    hasActiveOrderedCatchupSession,
    shouldAcceptLegacySync,
    shouldAcceptInboundLegacySync,
    shouldDeferLegacySync,
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

    it('accepts legacy sync only when enabled and mode is explicitly legacy', () => {
        expect(shouldAcceptLegacySync('legacy', true)).toBe(true);
        expect(shouldAcceptLegacySync('legacy', true, true)).toBe(false);
        expect(shouldAcceptLegacySync('unknown', true)).toBe(false);
        expect(shouldAcceptLegacySync('negentropy', true)).toBe(false);
        expect(shouldAcceptLegacySync('legacy', false)).toBe(false);
    });

    it('accepts inbound pre-ping legacy sync only on legacy transport compatibility path', () => {
        expect(shouldAcceptInboundLegacySync('legacy', 'legacy', true)).toBe(true);
        expect(shouldAcceptInboundLegacySync('unknown', 'legacy', true)).toBe(true);
        expect(shouldAcceptInboundLegacySync('unknown', 'unknown', true)).toBe(false);
        expect(shouldAcceptInboundLegacySync('unknown', 'framed', true)).toBe(false);
        expect(shouldAcceptInboundLegacySync('unknown', 'legacy', false)).toBe(false);
        expect(shouldAcceptInboundLegacySync('negentropy', 'legacy', true)).toBe(false);
    });

    it('starts connect-time negentropy only for initiator without active session', () => {
        expect(shouldStartConnectTimeNegentropy('negentropy', false, true)).toBe(true);
        expect(shouldStartConnectTimeNegentropy('negentropy', true, true)).toBe(false);
        expect(shouldStartConnectTimeNegentropy('negentropy', false, false)).toBe(false);
        expect(shouldStartConnectTimeNegentropy('legacy', false, true)).toBe(false);
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
        expect(shouldSchedulePeriodicRepair({ ...base, syncMode: 'legacy' })).toBe(false);
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
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, syncMode: 'legacy' })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, peerSupportsNegentropyTransport: false })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, hasActiveSession: true })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, importQueueLength: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, importQueueRunning: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, activeNegentropySessions: 1 })).toBe(false);
        expect(shouldStartPostOrderedCatchupNegentropy({ ...base, syncCompleted: true })).toBe(false);
    });

    it('defers legacy while negentropy peers are pending, but allows fallback after timeout', () => {
        const base = {
            syncMode: 'legacy' as const,
            legacySyncEnabled: true,
            hasActiveNegentropySession: false,
            pendingNegentropyPeers: 1,
            pendingCapabilityPeers: 0,
            peerConnectedAtMs: 1_000,
            nowMs: 10_000,
            capabilityGraceMs: 5_000,
            fallbackTimeoutMs: 60_000,
        };

        expect(shouldDeferLegacySync(base)).toBe(true);
        expect(shouldDeferLegacySync({
            ...base,
            nowMs: base.peerConnectedAtMs + base.fallbackTimeoutMs + 1,
        })).toBe(false);
    });

    it('defers legacy while an active negentropy session is still within fallback timeout', () => {
        const base = {
            syncMode: 'legacy' as const,
            legacySyncEnabled: true,
            hasActiveNegentropySession: true,
            pendingNegentropyPeers: 0,
            pendingCapabilityPeers: 0,
            peerConnectedAtMs: 1_000,
            nowMs: 10_000,
            capabilityGraceMs: 5_000,
            fallbackTimeoutMs: 60_000,
        };

        expect(shouldDeferLegacySync(base)).toBe(true);
        expect(shouldDeferLegacySync({
            ...base,
            nowMs: base.peerConnectedAtMs + base.fallbackTimeoutMs + 1,
        })).toBe(false);
    });

    it('defers legacy briefly while peer capabilities are still unknown', () => {
        const base = {
            syncMode: 'legacy' as const,
            legacySyncEnabled: true,
            hasActiveNegentropySession: false,
            pendingNegentropyPeers: 0,
            pendingCapabilityPeers: 1,
            peerConnectedAtMs: 1_000,
            nowMs: 2_000,
            capabilityGraceMs: 5_000,
            fallbackTimeoutMs: 60_000,
        };

        expect(shouldDeferLegacySync(base)).toBe(true);
        expect(shouldDeferLegacySync({
            ...base,
            nowMs: base.peerConnectedAtMs + base.capabilityGraceMs + 1,
        })).toBe(false);
    });

    it('does not defer legacy when there is no negentropy pressure', () => {
        expect(shouldDeferLegacySync({
            syncMode: 'legacy',
            legacySyncEnabled: false,
            hasActiveNegentropySession: true,
            pendingNegentropyPeers: 1,
            pendingCapabilityPeers: 1,
            peerConnectedAtMs: 1_000,
            nowMs: 2_000,
            capabilityGraceMs: 5_000,
            fallbackTimeoutMs: 60_000,
        })).toBe(false);
        expect(shouldDeferLegacySync({
            syncMode: 'legacy',
            legacySyncEnabled: true,
            hasActiveNegentropySession: false,
            pendingNegentropyPeers: 0,
            pendingCapabilityPeers: 0,
            peerConnectedAtMs: 1_000,
            nowMs: 2_000,
            capabilityGraceMs: 5_000,
            fallbackTimeoutMs: 60_000,
        })).toBe(false);
        expect(shouldDeferLegacySync({
            syncMode: 'unknown',
            legacySyncEnabled: true,
            hasActiveNegentropySession: true,
            pendingNegentropyPeers: 1,
            pendingCapabilityPeers: 1,
            peerConnectedAtMs: 1_000,
            nowMs: 2_000,
            capabilityGraceMs: 5_000,
            fallbackTimeoutMs: 60_000,
        })).toBe(false);
    });
});
