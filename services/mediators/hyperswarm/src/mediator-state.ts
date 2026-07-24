import type { HyperswarmConnection } from 'hyperswarm';
import type {
    OperationSyncStore,
    SyncStoreCursor,
    SyncStoreOrderedCursor,
} from './db/types.js';
import type {
    NegentropyWindowEngine,
    NegentropyWindowSnapshot,
    NegentropyWindowStats,
    ReconciliationWindow,
} from './negentropy/adapter.js';
import type {
    NegotiatedPeerCapabilities,
    SyncMode,
} from './negentropy/protocol.js';
import type {
    BatchMessage,
    SyncMessage,
} from './protocol-messages.js';

export interface MediatorMainOptions {
    syncStore?: OperationSyncStore;
    startLoops?: boolean;
}

export interface NodeInfo {
    name: string;
    ipfs: any;
}

export interface ExportQueueTask {
    name: string;
    msg: SyncMessage;
    conn: HyperswarmConnection;
}

export interface DeferredLegacyInboundTask extends ExportQueueTask {}

export interface ConnectionInfo {
    connection: HyperswarmConnection;
    key: string;
    peerName: string;
    nodeName: string;
    did: string;
    connectedAt: number;
    lastSeen: number;
    capabilities: NegotiatedPeerCapabilities;
    syncMode: SyncMode | 'unknown';
    syncStarted: boolean;
    lastNegentropyAttemptAt: number;
    negentropySynced: boolean;
    legacyOutboundDeferred: boolean;
    legacyInboundDeferred: DeferredLegacyInboundTask | null;
    legacyFallbackNoted: boolean;
    orderedCatchupAttempted: boolean;
    orderedCatchupClientSessionId: string | null;
    orderedCatchupServerSessionId: string | null;
    orderedCatchupServerLastActivity: number;
    orderedCatchupServerPendingSince: number;
    orderedCatchupServerPendingUntil: number;
    orderedCatchupServerPendingReason: string | null;
    orderedCatchupServerPendingGap: number;
    initialPingSent: boolean;
    transportMode: 'unknown' | 'legacy' | 'framed';
    inboundTransportMode: 'unknown' | 'legacy' | 'framed';
    peerTransportFramingVersion: number | null;
    inboundBuffer: Buffer;
    inboundReceiveChain: Promise<void>;
}

export interface MalformedPeerState {
    strikes: number;
    firstSeenAt: number;
    lastSeenAt: number;
    cooldownUntil: number;
    lastReason: string;
    rejectedConnections: number;
    lastRejectLogAt: number;
}

export type PeerSessionMode = SyncMode | 'ordered_catchup';

export interface PeerSyncSession {
    sessionId: string;
    peerKey: string;
    mode: PeerSessionMode;
    initiator: boolean;
    windows: ReconciliationWindow[];
    windowIndex: number;
    windowId: string | null;
    currentWindowStats: NegentropyWindowStats | null;
    currentWindowSnapshot: NegentropyWindowSnapshot | null;
    currentWindowEngine: NegentropyWindowEngine | null;
    startedAt: number;
    lastActivity: number;
    pendingHaveIds: Set<string>;
    pendingNeedIds: Set<string>;
    unresolvedNeedIds: Set<string>;
    rounds: number;
    maxRounds: number;
    reconciliationComplete: boolean;
    localClosed: boolean;
    receivedPushIds: Set<string>;
    receivedKnownPushIds: Set<string>;
    provenStoredPushIds: Set<string>;
    receivedPushMaxCursor: SyncStoreCursor | null;
    remoteWindowCappedByRecords: boolean;
    remoteWindowLastCursor: SyncStoreCursor | null;
    orderedCatchupCursor: SyncStoreOrderedCursor | null;
    orderedCatchupPendingImports: number;
    orderedCatchupRequestOutstanding: boolean;
    orderedCatchupTerminalReason: 'ordered_catchup_complete' | 'ordered_catchup_done' | null;
    orderedCatchupImportsAborted: boolean;
}

export interface ImportQueueTask {
    name: string;
    msg: BatchMessage;
    orderedCatchupSession?: PeerSyncSession;
}

export interface ImportQueueResult {
    knownIds: string[];
    persistedIds: string[];
    retryable: boolean;
}

export interface ConnectionInfoOptions {
    connection: HyperswarmConnection;
    peerKey: string;
    peerName: string;
    nodeName?: string;
    now?: number;
}

export function createConnectionInfo(options: ConnectionInfoOptions): ConnectionInfo {
    const now = options.now ?? Date.now();

    return {
        connection: options.connection,
        key: options.peerKey,
        peerName: options.peerName,
        nodeName: options.nodeName ?? 'anon',
        did: '',
        connectedAt: now,
        lastSeen: now,
        capabilities: {
            advertised: false,
            negentropy: false,
            version: null,
            orderedCatchup: false,
            orderedCatchupVersion: null,
            orderedCatchupReady: false,
            operationCount: null,
            orderedOperationCount: null,
        },
        syncMode: 'unknown',
        syncStarted: false,
        lastNegentropyAttemptAt: 0,
        negentropySynced: false,
        legacyOutboundDeferred: false,
        legacyInboundDeferred: null,
        legacyFallbackNoted: false,
        orderedCatchupAttempted: false,
        orderedCatchupClientSessionId: null,
        orderedCatchupServerSessionId: null,
        orderedCatchupServerLastActivity: 0,
        orderedCatchupServerPendingSince: 0,
        orderedCatchupServerPendingUntil: 0,
        orderedCatchupServerPendingReason: null,
        orderedCatchupServerPendingGap: 0,
        initialPingSent: false,
        transportMode: 'unknown',
        inboundTransportMode: 'unknown',
        peerTransportFramingVersion: null,
        inboundBuffer: Buffer.alloc(0),
        inboundReceiveChain: Promise.resolve(),
    };
}

export interface PeerSyncSessionOptions {
    sessionId: string;
    peerKey: string;
    mode: PeerSessionMode;
    initiator: boolean;
    maxRounds: number;
    now?: number;
}

export function createPeerSyncSessionState(options: PeerSyncSessionOptions): PeerSyncSession {
    const now = options.now ?? Date.now();

    return {
        sessionId: options.sessionId,
        peerKey: options.peerKey,
        mode: options.mode,
        initiator: options.initiator,
        windows: [],
        windowIndex: 0,
        windowId: null,
        currentWindowStats: null,
        currentWindowSnapshot: null,
        currentWindowEngine: null,
        startedAt: now,
        lastActivity: now,
        pendingHaveIds: new Set<string>(),
        pendingNeedIds: new Set<string>(),
        unresolvedNeedIds: new Set<string>(),
        rounds: 0,
        maxRounds: options.maxRounds,
        reconciliationComplete: false,
        localClosed: false,
        receivedPushIds: new Set<string>(),
        receivedKnownPushIds: new Set<string>(),
        provenStoredPushIds: new Set<string>(),
        receivedPushMaxCursor: null,
        remoteWindowCappedByRecords: false,
        remoteWindowLastCursor: null,
        orderedCatchupCursor: null,
        orderedCatchupPendingImports: 0,
        orderedCatchupRequestOutstanding: false,
        orderedCatchupTerminalReason: null,
        orderedCatchupImportsAborted: false,
    };
}
