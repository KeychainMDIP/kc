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

export function shouldAcceptLegacySync(
    syncMode: SyncMode | 'unknown',
    legacySyncEnabled: boolean,
): boolean {
    if (!legacySyncEnabled) {
        return false;
    }

    return syncMode === 'legacy';
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
