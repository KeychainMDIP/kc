import {
    shouldAcceptLegacySync,
    shouldDeferLegacySync,
    shouldSchedulePeriodicRepair,
    shouldStartConnectTimeNegentropy,
} from '../../services/mediators/hyperswarm/src/negentropy/policy.ts';

describe('negentropy sync policy', () => {
    it('accepts legacy sync only when enabled and mode is explicitly legacy', () => {
        expect(shouldAcceptLegacySync('legacy', true)).toBe(true);
        expect(shouldAcceptLegacySync('legacy', true, true)).toBe(false);
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
        expect(shouldSchedulePeriodicRepair({ ...base, activeNegentropySessions: 1 })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, syncMode: 'legacy' })).toBe(false);
        expect(shouldSchedulePeriodicRepair({ ...base, syncCompleted: true })).toBe(false);
        expect(shouldSchedulePeriodicRepair({
            ...base,
            lastAttemptAtMs: base.nowMs - 10_000,
        })).toBe(false);
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
