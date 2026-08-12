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
