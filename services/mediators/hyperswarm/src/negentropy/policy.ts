import type { SyncMode } from './protocol.js';

export interface RepairSchedulingInput {
    syncMode: SyncMode | 'unknown';
    hasActiveSession: boolean;
    importQueueLength: number;
    activeNegentropySessions: number;
    lastAttemptAtMs: number;
    nowMs: number;
    repairIntervalMs: number;
    isInitiator: boolean;
    syncCompleted: boolean;
}

export interface LegacySyncPriorityInput {
    syncMode: SyncMode | 'unknown';
    legacySyncEnabled: boolean;
    hasActiveNegentropySession: boolean;
    pendingNegentropyPeers: number;
    pendingCapabilityPeers: number;
    peerConnectedAtMs: number;
    nowMs: number;
    capabilityGraceMs: number;
    fallbackTimeoutMs: number;
}

export function shouldAcceptLegacySync(
    syncMode: SyncMode | 'unknown',
    legacySyncEnabled: boolean,
    deferredByPriority = false,
): boolean {
    if (!legacySyncEnabled) {
        return false;
    }

    return syncMode === 'legacy' && !deferredByPriority;
}

export function shouldAcceptInboundLegacySync(
    syncMode: SyncMode | 'unknown',
    transportMode: 'unknown' | 'legacy' | 'framed',
    legacySyncEnabled: boolean,
    deferredByPriority = false,
): boolean {
    if (shouldAcceptLegacySync(syncMode, legacySyncEnabled, deferredByPriority)) {
        return true;
    }

    if (!legacySyncEnabled) {
        return false;
    }

    return syncMode === 'unknown' && transportMode === 'legacy';
}

export function shouldStartConnectTimeNegentropy(
    syncMode: SyncMode | 'unknown',
    hasActiveSession: boolean,
    isInitiator: boolean,
): boolean {
    return syncMode === 'negentropy' && !hasActiveSession && isInitiator;
}

export function shouldSchedulePeriodicRepair(input: RepairSchedulingInput): boolean {
    if (input.syncMode !== 'negentropy') {
        return false;
    }

    if (!input.isInitiator) {
        return false;
    }

    if (input.hasActiveSession) {
        return false;
    }

    if (input.importQueueLength > 0) {
        return false;
    }

    if (input.activeNegentropySessions > 0) {
        return false;
    }

    if (input.syncCompleted) {
        return false;
    }

    if (input.lastAttemptAtMs <= 0) {
        return true;
    }

    return (input.nowMs - input.lastAttemptAtMs) >= input.repairIntervalMs;
}

export function shouldDeferLegacySync(input: LegacySyncPriorityInput): boolean {
    if (!input.legacySyncEnabled) {
        return false;
    }

    if (input.syncMode !== 'legacy') {
        return false;
    }

    const waitAgeMs = Math.max(0, input.nowMs - input.peerConnectedAtMs);

    if (input.hasActiveNegentropySession) {
        return waitAgeMs < input.fallbackTimeoutMs;
    }

    if (input.pendingCapabilityPeers > 0 && waitAgeMs < input.capabilityGraceMs) {
        return true;
    }

    if (input.pendingNegentropyPeers > 0) {
        return waitAgeMs < input.fallbackTimeoutMs;
    }

    return false;
}
