import type { HyperswarmConnection } from 'hyperswarm';
import type { OperationSyncStore } from './db/types.js';
import type {
    NegotiatedPeerCapabilities,
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
    wireVersion: number | null;
    capabilities: NegotiatedPeerCapabilities;
    syncStarted: boolean;
    lastNegentropyAttemptAt: number;
    negentropyRetryAfter: number;
    negentropyBusyGeneration: number;
    negentropyBusyRetryAfter: number;
    negentropySynced: boolean;
    orderedCatchupAttempted: boolean;
    orderedCatchupRetryAfter: number;
    initialPingSent: boolean;
    initialPingPromise: Promise<void>;
    initialPingReceived: boolean;
    lastProcessedPingAt: number;
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
        wireVersion: null,
        capabilities: {
            ordered: null,
            latestTs: null,
        },
        syncStarted: false,
        lastNegentropyAttemptAt: 0,
        negentropyRetryAfter: 0,
        negentropyBusyGeneration: -1,
        negentropyBusyRetryAfter: 0,
        negentropySynced: false,
        orderedCatchupAttempted: false,
        orderedCatchupRetryAfter: 0,
        initialPingSent: options.requireInitialPing !== true,
        initialPingPromise: Promise.resolve(),
        initialPingReceived: false,
        lastProcessedPingAt: 0,
        protocolViolationReported: false,
        terminationStarted: false,
        inboundBuffer: Buffer.alloc(0),
        inboundReceiveChain: Promise.resolve(),
    };
}
