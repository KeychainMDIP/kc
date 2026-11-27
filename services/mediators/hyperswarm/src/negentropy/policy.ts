export interface RepairSchedulingInput {
    hasActiveSession: boolean;
    orderedCatchupActive?: boolean;
    importQueueLength: number;
    importQueueRunning?: number;
    activeNegentropySessions: number;
    lastAttemptAtMs: number;
    nowMs: number;
    repairIntervalMs: number;
    isInitiator: boolean;
    syncCompleted: boolean;
}

export interface PostOrderedCatchupNegentropyInput {
    peerReady: boolean;
    hasActiveSession: boolean;
    importQueueLength: number;
    importQueueRunning: number;
    activeNegentropySessions: number;
    syncCompleted: boolean;
}

export function shouldStartConnectTimeNegentropy(
    hasActiveSession: boolean,
    isInitiator: boolean,
    orderedCatchupActive = false,
): boolean {
    if (orderedCatchupActive) {
        return false;
    }

    return !hasActiveSession && isInitiator;
}

export function shouldSchedulePeriodicRepair(input: RepairSchedulingInput): boolean {
    if (input.orderedCatchupActive === true) {
        return false;
    }

    if (!input.isInitiator) {
        return false;
    }

    if (input.hasActiveSession) {
        return false;
    }

    if (input.importQueueLength > 0 || (input.importQueueRunning ?? 0) > 0) {
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
    if (!input.peerReady) {
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
