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
    transportFramingVersion: number;
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
    previousWindowProgress?: NegentropyWindowProgress;
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
    requestId: number;
    offerId?: number;
    ids: string[];
    deferred?: boolean;
}

export interface OpsOfferMessage extends HyperMessageBase {
    type: 'ops_offer';
    sessionId: string;
    windowId: string;
    round: number;
    offerId: number;
    ids: string[];
}

export interface OpsPushMessage extends HyperMessageBase {
    type: 'ops_push';
    sessionId: string;
    windowId: string;
    round: number;
    requestId: number;
    page: number;
    hasMore: boolean;
    data: Operation[];
}

export interface OpsAckMessage extends HyperMessageBase {
    type: 'ops_ack';
    sessionId: string;
    windowId: string;
    round: number;
    requestId: number;
    page: number;
    deferred?: boolean;
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
    | OpsOfferMessage
    | OpsReqMessage
    | OpsPushMessage
    | OpsAckMessage
    | OrderedCatchupReqMessage
    | OrderedCatchupPushMessage
    | OrderedCatchupDoneMessage;

export type SyncMessage = Exclude<HyperMessage, QueueMessage | PingMessage>;

const SYNC_MESSAGE_TYPES = new Set<SyncMessage['type']>([
    'ordered_catchup_req',
    'ordered_catchup_push',
    'ordered_catchup_done',
    'neg_open',
    'neg_msg',
    'ops_offer',
    'ops_req',
    'ops_push',
    'ops_ack',
    'neg_close',
]);

export function isHyperMessage(value: unknown): value is HyperMessage {
    if (!value || typeof value !== 'object' || !('type' in value)) {
        return false;
    }

    const type = (value as { type?: unknown }).type;
    return type === 'ping' || type === 'queue'
        || (typeof type === 'string' && SYNC_MESSAGE_TYPES.has(type as SyncMessage['type']));
}

export function isSyncMessage(message: HyperMessage): message is SyncMessage {
    return SYNC_MESSAGE_TYPES.has(message.type as SyncMessage['type']);
}
