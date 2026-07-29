import type { Operation } from '@mdip/gatekeeper/types';
import type { SyncStoreOrderedCursor } from './db/types.js';
import type {
    NegentropyFrame,
    NegentropyWindowPayload,
    PeerCapabilities,
} from './negentropy/protocol.js';

export interface HyperMessageBase {
    type: string;
    time: string;
    node: string;
    relays: string[];
}

export interface PingMessage extends HyperMessageBase {
    type: 'ping';
    peers: string[];
    capabilities?: PeerCapabilities;
    transportFramingVersion?: number;
}

export interface QueueMessage extends HyperMessageBase {
    type: 'queue';
    data: Operation[];
}

export type NativeNegentropyFrame = string | Uint8Array;

export interface NegentropyRoundOutcome {
    nextMsg: NativeNegentropyFrame | null;
    haveIds: string[];
    needIds: string[];
}

export interface NegentropyWindowProgress {
    cappedByRecords: boolean;
    lastCursor?: {
        ts: number;
        id: string;
    };
}

export interface NegOpenMessage extends HyperMessageBase {
    type: 'neg_open';
    sessionId: string;
    windowId: string;
    window: NegentropyWindowPayload;
    round: number;
    frame: NegentropyFrame;
}

export interface NegMsgMessage extends HyperMessageBase {
    type: 'neg_msg';
    sessionId: string;
    windowId: string;
    round: number;
    frame: NegentropyFrame;
    windowProgress?: NegentropyWindowProgress;
}

export interface NegCloseMessage extends HyperMessageBase {
    type: 'neg_close';
    sessionId: string;
    windowId: string;
    round: number;
    reason?: string;
    windowProgress?: NegentropyWindowProgress;
}

export interface OpsReqMessage extends HyperMessageBase {
    type: 'ops_req';
    sessionId: string;
    windowId: string;
    round: number;
    ids: string[];
}

export interface OpsPushMessage extends HyperMessageBase {
    type: 'ops_push';
    sessionId: string;
    windowId: string;
    round: number;
    data: Operation[];
}

export interface OrderedCatchupReqMessage extends HyperMessageBase {
    type: 'ordered_catchup_req';
    sessionId: string;
    cursor?: SyncStoreOrderedCursor;
}

export interface OrderedCatchupPushMessage extends HyperMessageBase {
    type: 'ordered_catchup_push';
    sessionId: string;
    cursor?: SyncStoreOrderedCursor;
    hasMore: boolean;
    data: Operation[];
}

export interface OrderedCatchupDoneMessage extends HyperMessageBase {
    type: 'ordered_catchup_done';
    sessionId: string;
}

export type HyperMessage =
    | QueueMessage
    | PingMessage
    | NegOpenMessage
    | NegMsgMessage
    | NegCloseMessage
    | OpsReqMessage
    | OpsPushMessage
    | OrderedCatchupReqMessage
    | OrderedCatchupPushMessage
    | OrderedCatchupDoneMessage;
