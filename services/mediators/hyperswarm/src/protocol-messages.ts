import type { Operation } from '@mdip/gatekeeper/types';
import type { SyncStoreOrderedCursor } from './db/types.js';
import type {
    NegentropyWindowPayload,
    OrderedCatchupCapability,
} from './negentropy/protocol.js';

export const WIRE_PROTOCOL_VERSION = 2;

export interface HyperMessageBase {
    type: string;
}

export interface PingMessage extends HyperMessageBase {
    type: 'ping';
    version: typeof WIRE_PROTOCOL_VERSION;
    name?: string;
    peerDids?: string[];
    latestTs?: number;
    ordered?: OrderedCatchupCapability;
}

export interface QueueMessage extends HyperMessageBase {
    type: 'queue';
    operations: Operation[];
}

export type NativeNegentropyFrame = Uint8Array;

export interface NegentropyRoundOutcome {
    nextMsg: NativeNegentropyFrame | null;
    haveIds: string[];
    needIds: string[];
}

export type NegentropyContinuation = { ts: number; id: string } | null;

export const NEG_CLOSE_OUTCOMES = [
    'complete',
    'busy',
    'round_limit',
    'incomplete',
    'failed',
] as const;

export type NegCloseOutcome = typeof NEG_CLOSE_OUTCOMES[number];

export interface NegOpenMessage extends HyperMessageBase {
    type: 'neg_open';
    sessionId: string;
    windowSeq: number;
    window: NegentropyWindowPayload;
    round: number;
    frame: string;
    previousContinuation?: NegentropyContinuation;
}

export interface NegMsgMessage extends HyperMessageBase {
    type: 'neg_msg';
    sessionId: string;
    windowSeq: number;
    round: number;
    frame: string;
    continuation: NegentropyContinuation;
}

export interface NegCloseMessage extends HyperMessageBase {
    type: 'neg_close';
    sessionId: string;
    windowSeq: number;
    round: number;
    outcome: NegCloseOutcome;
    detail?: string;
    continuation?: NegentropyContinuation;
}

export interface OpsReqMessage extends HyperMessageBase {
    type: 'ops_req';
    sessionId: string;
    transferId: number;
    ids: string[];
    incomplete?: true;
}

export interface OpsOfferMessage extends HyperMessageBase {
    type: 'ops_offer';
    sessionId: string;
    transferId: number;
    ids: string[];
}

export interface OpsPushMessage extends HyperMessageBase {
    type: 'ops_push';
    sessionId: string;
    transferId: number;
    page: number;
    hasMore: boolean;
    operations: Operation[];
}

export interface OpsAckMessage extends HyperMessageBase {
    type: 'ops_ack';
    sessionId: string;
    transferId: number;
    page: number;
    incomplete?: true;
}

export interface OrderedCatchupReqMessage extends HyperMessageBase {
    type: 'ordered_catchup_req';
    sessionId: string;
    after?: SyncStoreOrderedCursor;
}

export interface OrderedCatchupPushMessage extends HyperMessageBase {
    type: 'ordered_catchup_push';
    sessionId: string;
    cursor: SyncStoreOrderedCursor;
    hasMore: boolean;
    operations: Operation[];
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

export function isSyncMessage(message: HyperMessage): message is SyncMessage {
    return SYNC_MESSAGE_TYPES.has(message.type as SyncMessage['type']);
}
