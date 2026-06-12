import type { SyncMode } from './protocol.js';

export interface RepairSchedulingInput {
    syncMode: SyncMode | 'unknown';
    hasActiveSession: boolean;
    orderedCatchupActive?: boolean;
    importQueueLength: number;
    activeNegentropySessions: number;
    lastAttemptAtMs: number;
    nowMs: number;
    repairIntervalMs: number;
    isInitiator: boolean;
    syncCompleted: boolean;
}

export interface PostOrderedCatchupNegentropyInput {
    syncMode: SyncMode | 'unknown';
    peerConnected: boolean;
    peerSupportsNegentropyTransport: boolean;
    hasActiveSession: boolean;
    importQueueLength: number;
    importQueueRunning: number;
    activeNegentropySessions: number;
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

export interface OrderedCatchupStateInput {
    orderedCatchupClientSessionId?: string | null;
    orderedCatchupServerSessionId?: string | null;
}

export type ActivePeerSessionMode = SyncMode | 'ordered_catchup';

export interface InboundNegOpenConflictInput {
    activeSessionMode?: ActivePeerSessionMode | null;
    activeSessionId?: string | null;
    activeOrderedCatchupSessionId?: string | null;
    remoteSessionId: string;
}

export type InboundNegOpenConflictDecision =
    | { action: 'accept' }
    | { action: 'replace' }
    | { action: 'ignore'; reason: 'ordered_catchup_active' };

export function hasActiveOrderedCatchupSession(input: OrderedCatchupStateInput): boolean {
    return !!input.orderedCatchupClientSessionId || !!input.orderedCatchupServerSessionId;
}

export function decideInboundNegOpenConflict(
    input: InboundNegOpenConflictInput,
): InboundNegOpenConflictDecision {
    if (input.activeSessionMode === 'ordered_catchup' || input.activeOrderedCatchupSessionId) {
        return { action: 'ignore', reason: 'ordered_catchup_active' };
    }

    if (!input.activeSessionId) {
        return { action: 'accept' };
    }

    if (input.activeSessionMode === 'negentropy' && input.activeSessionId === input.remoteSessionId) {
        return { action: 'accept' };
    }

    return { action: 'replace' };
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
    orderedCatchupActive = false,
): boolean {
    if (orderedCatchupActive) {
        return false;
    }

    return syncMode === 'negentropy' && !hasActiveSession && isInitiator;
}

export function shouldSchedulePeriodicRepair(input: RepairSchedulingInput): boolean {
    if (input.syncMode !== 'negentropy') {
        return false;
    }

    if (input.orderedCatchupActive === true) {
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

export function shouldStartPostOrderedCatchupNegentropy(input: PostOrderedCatchupNegentropyInput): boolean {
    if (!input.peerConnected) {
        return false;
    }

    if (input.syncMode !== 'negentropy') {
        return false;
    }

    if (!input.peerSupportsNegentropyTransport) {
        return false;
    }

    if (input.hasActiveSession) {
        return false;
    }

    if (input.importQueueLength > 0 || input.importQueueRunning > 0) {
        return false;
    }

    if (input.activeNegentropySessions > 0) {
        return false;
    }

    if (input.syncCompleted) {
        return false;
    }

    return true;
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
