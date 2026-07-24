import {
    averageAggregate,
    createAggregateMetric,
    safeRate,
    type AggregateMetric,
} from './negentropy/observability.js';

export interface MediatorSyncStats {
    modeSelectionsTotal: number;
    modeSelectionsLegacy: number;
    modeSelectionsNegentropy: number;
    modeSelectionsLegacyMissingCapabilities: number;
    modeSelectionsLegacyNegentropyDisabled: number;
    modeSelectionsLegacyVersionMismatch: number;
    modeSelectionsLegacyTransportFramingUnsupported: number;
    modeSelectionsNoModeLegacyDisabled: number;
    modeSelectionsNoModeMissingCapabilities: number;
    modeSelectionsNoModeNegentropyDisabled: number;
    modeSelectionsNoModeVersionMismatch: number;
    modeSelectionsNoModeTransportFramingUnsupported: number;
    queueOpsRelayed: number;
    queueOpsImported: number;
    queueDelayMs: AggregateMetric;
    legacyOutboundDeferred: number;
    legacyInboundDeferred: number;
    legacyDeferredReleased: number;
    legacyFallbackUsed: number;
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
    syncDurationMs: AggregateMetric;
}

export function createMediatorSyncStats(): MediatorSyncStats {
    return {
        modeSelectionsTotal: 0,
        modeSelectionsLegacy: 0,
        modeSelectionsNegentropy: 0,
        modeSelectionsLegacyMissingCapabilities: 0,
        modeSelectionsLegacyNegentropyDisabled: 0,
        modeSelectionsLegacyVersionMismatch: 0,
        modeSelectionsLegacyTransportFramingUnsupported: 0,
        modeSelectionsNoModeLegacyDisabled: 0,
        modeSelectionsNoModeMissingCapabilities: 0,
        modeSelectionsNoModeNegentropyDisabled: 0,
        modeSelectionsNoModeVersionMismatch: 0,
        modeSelectionsNoModeTransportFramingUnsupported: 0,
        queueOpsRelayed: 0,
        queueOpsImported: 0,
        queueDelayMs: createAggregateMetric(),
        legacyOutboundDeferred: 0,
        legacyInboundDeferred: 0,
        legacyDeferredReleased: 0,
        legacyFallbackUsed: 0,
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
        syncDurationMs: createAggregateMetric(),
    };
}

export function buildSyncStatsSnapshot(syncStats: MediatorSyncStats): object {
    return {
        modeSelections: {
            total: syncStats.modeSelectionsTotal,
            legacy: syncStats.modeSelectionsLegacy,
            negentropy: syncStats.modeSelectionsNegentropy,
            fallbackCount: syncStats.modeSelectionsLegacy,
            fallbackRate: safeRate(syncStats.modeSelectionsLegacy, syncStats.modeSelectionsTotal),
            legacyReasons: {
                missingCapabilities: syncStats.modeSelectionsLegacyMissingCapabilities,
                negentropyDisabled: syncStats.modeSelectionsLegacyNegentropyDisabled,
                versionMismatch: syncStats.modeSelectionsLegacyVersionMismatch,
                transportFramingUnsupported: syncStats.modeSelectionsLegacyTransportFramingUnsupported,
            },
            noMode: {
                legacyDisabled: syncStats.modeSelectionsNoModeLegacyDisabled,
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
            legacy: {
                outboundDeferred: syncStats.legacyOutboundDeferred,
                inboundDeferred: syncStats.legacyInboundDeferred,
                deferredReleased: syncStats.legacyDeferredReleased,
                fallbackUsed: syncStats.legacyFallbackUsed,
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
        },
        syncDurationMs: {
            avg: averageAggregate(syncStats.syncDurationMs),
            max: syncStats.syncDurationMs.max,
            sessions: syncStats.syncDurationMs.count,
        },
    };
}
