import type { HyperswarmConnection } from 'hyperswarm';
import type { OperationSyncStore } from './db/types.js';
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
    peerName: string;
    nodeName: string;
    lastSeen: number;
    capabilities: NegotiatedPeerCapabilities;
    syncMode: SyncMode | 'unknown';
    syncStarted: boolean;
    lastNegentropyAttemptAt: number;
    negentropySynced: boolean;
    orderedCatchupAttempted: boolean;
    initialPingSent: boolean;
    initialPingPromise: Promise<void>;
    initialPingReceived: boolean;
    lastProcessedPingAt: number;
    peerTransportFramingVersion: number | null;
    protocolViolationReported: boolean;
    terminationStarted: boolean;
    inboundBuffer: Buffer;
    inboundReceiveChain: Promise<void>;
}

export interface ConnectionInfoOptions {
    connection: HyperswarmConnection;
    peerName: string;
    nodeName?: string;
    now?: number;
    requireInitialPing?: boolean;
}

export function createConnectionInfo(options: ConnectionInfoOptions): ConnectionInfo {
    const now = options.now ?? Date.now();

    return {
        connection: options.connection,
        peerName: options.peerName,
        nodeName: options.nodeName ?? 'anon',
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
            latestSignedTimestamp: null,
        },
        syncMode: 'unknown',
        syncStarted: false,
        lastNegentropyAttemptAt: 0,
        negentropySynced: false,
        orderedCatchupAttempted: false,
        initialPingSent: options.requireInitialPing !== true,
        initialPingPromise: Promise.resolve(),
        initialPingReceived: false,
        lastProcessedPingAt: 0,
        peerTransportFramingVersion: null,
        protocolViolationReported: false,
        terminationStarted: false,
        inboundBuffer: Buffer.alloc(0),
        inboundReceiveChain: Promise.resolve(),
    };
}
