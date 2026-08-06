import type { HyperswarmConnection } from 'hyperswarm';
import type { Operation } from '@mdip/gatekeeper/types';
import type {
    OperationSyncStore,
    SyncStoreCursor,
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

export interface MediatorMainOptions {
    syncStore?: OperationSyncStore;
    startLoops?: boolean;
}

export interface NodeInfo {
    name: string;
    ipfs: any;
}

export interface ConnectionInfo {
    connection: HyperswarmConnection;
    key: string;
    peerName: string;
    nodeName: string;
    did: string;
    lastSeen: number;
    capabilities: NegotiatedPeerCapabilities;
    syncMode: SyncMode | 'unknown';
    syncStarted: boolean;
    lastNegentropyAttemptAt: number;
    negentropySynced: boolean;
    orderedCatchupAttempted: boolean;
    initialPingSent: boolean;
    initialPingPromise: Promise<void>;
    initialInboundMessageReceived: boolean;
    peerTransportFramingVersion: number | null;
    legacyTransportQuarantined: boolean;
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

export interface PeerSyncSession {
    sessionId: string;
    peerKey: string;
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
    unresolvedOperations: Map<string, Operation>;
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
}

export interface ConnectionInfoOptions {
    connection: HyperswarmConnection;
    peerKey: string;
    peerName: string;
    nodeName?: string;
    now?: number;
    requireInitialPing?: boolean;
}

export function createConnectionInfo(options: ConnectionInfoOptions): ConnectionInfo {
    const now = options.now ?? Date.now();

    return {
        connection: options.connection,
        key: options.peerKey,
        peerName: options.peerName,
        nodeName: options.nodeName ?? 'anon',
        did: '',
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
        orderedCatchupAttempted: false,
        initialPingSent: options.requireInitialPing !== true,
        initialPingPromise: Promise.resolve(),
        initialInboundMessageReceived: false,
        peerTransportFramingVersion: null,
        legacyTransportQuarantined: false,
        inboundBuffer: Buffer.alloc(0),
        inboundReceiveChain: Promise.resolve(),
    };
}

export interface PeerSyncSessionOptions {
    sessionId: string;
    peerKey: string;
    initiator: boolean;
    maxRounds: number;
    now?: number;
}

export function createPeerSyncSessionState(options: PeerSyncSessionOptions): PeerSyncSession {
    const now = options.now ?? Date.now();

    return {
        sessionId: options.sessionId,
        peerKey: options.peerKey,
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
        unresolvedOperations: new Map<string, Operation>(),
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
    };
}
