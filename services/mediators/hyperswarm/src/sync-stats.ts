import {
    averageAggregate,
    createAggregateMetric,
    type AggregateMetric,
} from './negentropy/observability.js';

export interface MediatorSyncStats {
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
    malformedPeerCooldowns: number;
    malformedPeerConnectionsRejected: number;
    legacyTransportConnectionsQuarantined: number;
    syncDurationMs: AggregateMetric;
}

export function createMediatorSyncStats(): MediatorSyncStats {
    return {
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
        malformedPeerCooldowns: 0,
        malformedPeerConnectionsRejected: 0,
        legacyTransportConnectionsQuarantined: 0,
        syncDurationMs: createAggregateMetric(),
    };
}

export function buildSyncStatsSnapshot(syncStats: MediatorSyncStats): object {
    return {
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
            malformedPeerCooldowns: syncStats.malformedPeerCooldowns,
            malformedPeerConnectionsRejected: syncStats.malformedPeerConnectionsRejected,
            legacyTransportConnectionsQuarantined: syncStats.legacyTransportConnectionsQuarantined,
        },
        syncDurationMs: {
            avg: averageAggregate(syncStats.syncDurationMs),
            max: syncStats.syncDurationMs.max,
            sessions: syncStats.syncDurationMs.count,
        },
    };
}
