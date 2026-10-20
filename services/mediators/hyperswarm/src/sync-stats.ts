import {
    averageAggregate,
    createAggregateMetric,
    type AggregateMetric,
} from './negentropy/observability.js';

export interface MediatorSyncStats {
    hardening: ReturnType<typeof createHardeningStats>;
    modeSelectionsTotal: number;
    modeSelectionsNegentropy: number;
    modeSelectionsNoMode: number;
    modeSelectionsNoModeMissingCapabilities: number;
    modeSelectionsNoModeNegentropyDisabled: number;
    modeSelectionsNoModeVersionMismatch: number;
    modeSelectionsNoModeTransportFramingUnsupported: number;
    queueOpsRelayed: number;
    queueOpsImported: number;
    queueDelayMs: AggregateMetric;
    negentropySessionsStarted: number;
    negentropySessionsClosed: number;
    negentropySessionsCompleted: number;
    negentropySessionsFailed: number;
    negentropyRounds: number;
    negentropyHaveIds: number;
    negentropyNeedIds: number;
    negentropyOpsReqSent: number;
    negentropyOpsReqReceived: number;
    negentropyOpsPushSent: number;
    negentropyOpsPushReceived: number;
    orderedCatchupSessionsStarted: number;
    orderedCatchupSessionsCompleted: number;
    orderedCatchupSessionsFailed: number;
    orderedCatchupPagesSent: number;
    orderedCatchupPagesReceived: number;
    orderedCatchupOpsSent: number;
    orderedCatchupOpsReceived: number;
    opsApplied: number;
    opsRejected: number;
    bytesSent: number;
    bytesReceived: number;
    protocolViolationCooldowns: number;
    protocolViolationConnectionsRejected: number;
    transportFramingIncompatibilityClosures: number;
    negentropyVersionIncompatibilityClosures: number;
    compatibilityConnectionsRejected: number;
    syncDurationMs: AggregateMetric;
}

function createHardeningStats() {
    return {
        oversizedOperationMessages: 0,
        oversizedIdMessages: 0,
        unsolicitedOrderedResponses: 0,
        unauthorizedNegentropyMessages: 0,
        malformedQueueOperations: 0,
        protocolStrikes: { framing: 0, envelope: 0, queue: 0, ordered: 0, negentropy: 0, other: 0 },
        gossipOverloadDrops: 0,
        gossipRepairsScheduled: 0,
        gossipRepairsStarted: 0,
        gossipRetriesSuppressed: 0,
        gossipShareableOperations: 0,
        gossipOperationsRelayed: 0,
        inboundBudgetTerminations: 0,
        outboundBudgetRefusals: 0,
        frameAssemblyTimeouts: 0,
        connectionCapacityRefusals: 0,
        pingsSkipped: 0,
        gatekeeperCapacityOutcomes: 0,
        retryDelayEvictions: 0,
        terminalRecordsPersisted: 0,
        terminalRecordsRemovedAtStartup: 0,
    };
}

// Fixed categories keep attacker-supplied details out of metric keys.
export function recordProtocolStrike(stats: MediatorSyncStats, reason: string, validationError = ''): void {
    const counters = stats.hardening;
    const detail = `${reason} ${validationError}`;
    if (/operation (?:page|at index \d+) exceeds/.test(detail)) {
        counters.oversizedOperationMessages += 1;
    }
    if (detail.includes('ID list exceeds')) {
        counters.oversizedIdMessages += 1;
    }
    if (reason.startsWith('unsolicited_ordered')) {
        counters.unsolicitedOrderedResponses += 1;
    }
    if (reason.includes('ops_') && !reason.startsWith('invalid_ops_')) {
        counters.unauthorizedNegentropyMessages += 1;
    }
    if (reason.startsWith('invalid_queue_operation')) {
        counters.malformedQueueOperations += 1;
    }
    const category = reason.includes('framed') ? 'framing'
        : reason.includes('envelope') || reason === 'message_before_compatible_ping' ? 'envelope'
            : reason.includes('queue') ? 'queue'
                : reason.includes('ordered_catchup') ? 'ordered'
                    : /neg_|negentropy|ops_/.test(reason) ? 'negentropy'
                        : 'other';
    counters.protocolStrikes[category] += 1;
}

export function createMediatorSyncStats(): MediatorSyncStats {
    return {
        hardening: createHardeningStats(),
        modeSelectionsTotal: 0,
        modeSelectionsNegentropy: 0,
        modeSelectionsNoMode: 0,
        modeSelectionsNoModeMissingCapabilities: 0,
        modeSelectionsNoModeNegentropyDisabled: 0,
        modeSelectionsNoModeVersionMismatch: 0,
        modeSelectionsNoModeTransportFramingUnsupported: 0,
        queueOpsRelayed: 0,
        queueOpsImported: 0,
        queueDelayMs: createAggregateMetric(),
        negentropySessionsStarted: 0,
        negentropySessionsClosed: 0,
        negentropySessionsCompleted: 0,
        negentropySessionsFailed: 0,
        negentropyRounds: 0,
        negentropyHaveIds: 0,
        negentropyNeedIds: 0,
        negentropyOpsReqSent: 0,
        negentropyOpsReqReceived: 0,
        negentropyOpsPushSent: 0,
        negentropyOpsPushReceived: 0,
        orderedCatchupSessionsStarted: 0,
        orderedCatchupSessionsCompleted: 0,
        orderedCatchupSessionsFailed: 0,
        orderedCatchupPagesSent: 0,
        orderedCatchupPagesReceived: 0,
        orderedCatchupOpsSent: 0,
        orderedCatchupOpsReceived: 0,
        opsApplied: 0,
        opsRejected: 0,
        bytesSent: 0,
        bytesReceived: 0,
        protocolViolationCooldowns: 0,
        protocolViolationConnectionsRejected: 0,
        transportFramingIncompatibilityClosures: 0,
        negentropyVersionIncompatibilityClosures: 0,
        compatibilityConnectionsRejected: 0,
        syncDurationMs: createAggregateMetric(),
    };
}

export function buildSyncStatsSnapshot(syncStats: MediatorSyncStats): object {
    return {
        hardening: {
            ...syncStats.hardening,
            protocolStrikes: { ...syncStats.hardening.protocolStrikes },
        },
        modeSelections: {
            total: syncStats.modeSelectionsTotal,
            negentropy: syncStats.modeSelectionsNegentropy,
            noMode: {
                total: syncStats.modeSelectionsNoMode,
                reasons: {
                    missingCapabilities: syncStats.modeSelectionsNoModeMissingCapabilities,
                    negentropyDisabled: syncStats.modeSelectionsNoModeNegentropyDisabled,
                    versionMismatch: syncStats.modeSelectionsNoModeVersionMismatch,
                    transportFramingUnsupported: syncStats.modeSelectionsNoModeTransportFramingUnsupported,
                },
            },
        },
        queue: {
            relayed: syncStats.queueOpsRelayed,
            imported: syncStats.queueOpsImported,
            delayMs: {
                avg: averageAggregate(syncStats.queueDelayMs),
                max: syncStats.queueDelayMs.max,
                samples: syncStats.queueDelayMs.count,
            },
        },
        negentropy: {
            sessionsStarted: syncStats.negentropySessionsStarted,
            sessionsClosed: syncStats.negentropySessionsClosed,
            sessionsCompleted: syncStats.negentropySessionsCompleted,
            sessionsFailed: syncStats.negentropySessionsFailed,
            rounds: syncStats.negentropyRounds,
            haveIds: syncStats.negentropyHaveIds,
            needIds: syncStats.negentropyNeedIds,
            opsRequested: syncStats.negentropyOpsReqSent,
            opsRequestedReceived: syncStats.negentropyOpsReqReceived,
            opsPushed: syncStats.negentropyOpsPushSent,
            opsPushedReceived: syncStats.negentropyOpsPushReceived,
        },
        orderedCatchup: {
            sessionsStarted: syncStats.orderedCatchupSessionsStarted,
            sessionsCompleted: syncStats.orderedCatchupSessionsCompleted,
            sessionsFailed: syncStats.orderedCatchupSessionsFailed,
            pagesSent: syncStats.orderedCatchupPagesSent,
            pagesReceived: syncStats.orderedCatchupPagesReceived,
            opsSent: syncStats.orderedCatchupOpsSent,
            opsReceived: syncStats.orderedCatchupOpsReceived,
        },
        gatekeeper: {
            opsApplied: syncStats.opsApplied,
            opsRejected: syncStats.opsRejected,
        },
        transport: {
            bytesSent: syncStats.bytesSent,
            bytesReceived: syncStats.bytesReceived,
            protocolViolationCooldowns: syncStats.protocolViolationCooldowns,
            protocolViolationConnectionsRejected: syncStats.protocolViolationConnectionsRejected,
            transportFramingIncompatibilityClosures: syncStats.transportFramingIncompatibilityClosures,
            negentropyVersionIncompatibilityClosures: syncStats.negentropyVersionIncompatibilityClosures,
            compatibilityConnectionsRejected: syncStats.compatibilityConnectionsRejected,
        },
        syncDurationMs: {
            avg: averageAggregate(syncStats.syncDurationMs),
            max: syncStats.syncDurationMs.max,
            sessions: syncStats.syncDurationMs.count,
        },
    };
}
