import { isValidDID } from '@mdip/ipfs/utils';
import type { Operation } from '@mdip/gatekeeper/types';
import type {
    HyperMessage,
    PingMessage,
    QueueMessage,
} from './protocol-messages.js';
import { WIRE_PROTOCOL_VERSION } from './protocol-messages.js';
import { NEG_SYNC_ID_RE } from './negentropy/protocol.js';
import {
    validateIdList,
    validateOperationPage,
    type OpsPushBatchingOptions,
    type TransferValidationResult,
    type ValidatedOperationPage,
} from './negentropy/transfer.js';
import { mapOperationToSyncKey } from './sync-mapping.js';
import { hasContentVerifiedOperationId } from './sync-persistence.js';
import {
    MAX_ADVERTISED_DID_BYTES,
    MAX_ADVERTISED_PEERS,
    MAX_PROTOCOL_STRING_BYTES,
} from './protocol-limits.js';

const MESSAGE_TYPES = new Set<HyperMessage['type']>([
    'ping',
    'queue',
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

type ProtocolValidationResult<T> = TransferValidationResult<T>;

const MESSAGE_PROPERTIES: Record<HyperMessage['type'], ReadonlySet<string>> = {
    ping: new Set(['type', 'version', 'name', 'peerDids', 'latestTs', 'ordered']),
    queue: new Set(['type', 'operations']),
    ordered_catchup_req: new Set(['type', 'sessionId', 'after']),
    ordered_catchup_push: new Set(['type', 'sessionId', 'cursor', 'hasMore', 'operations']),
    ordered_catchup_done: new Set(['type', 'sessionId']),
    neg_open: new Set(['type', 'sessionId', 'windowId', 'window', 'round', 'frame', 'previousWindowProgress']),
    neg_msg: new Set(['type', 'sessionId', 'windowId', 'round', 'frame', 'windowProgress']),
    neg_close: new Set(['type', 'sessionId', 'windowId', 'round', 'reason', 'windowProgress']),
    ops_offer: new Set(['type', 'sessionId', 'windowId', 'round', 'offerId', 'ids']),
    ops_req: new Set(['type', 'sessionId', 'windowId', 'round', 'requestId', 'offerId', 'ids', 'deferred']),
    ops_push: new Set(['type', 'sessionId', 'windowId', 'round', 'requestId', 'page', 'hasMore', 'data']),
    ops_ack: new Set(['type', 'sessionId', 'windowId', 'round', 'requestId', 'page', 'deferred']),
};

export interface ProtocolPayloadLimits extends OpsPushBatchingOptions {
    maxIdsPerRequest: number;
    maxFrameBytes: number;
    maxRecordsPerWindow: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

function validateKnownProperties(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    name: string,
): string | null {
    const unknown = Object.keys(value).find(key => !allowed.has(key));
    return unknown === undefined ? null : `${name} contains unknown property ${unknown}`;
}

function validateBoundedString(value: unknown, name: string, maxBytes = MAX_PROTOCOL_STRING_BYTES): string | null {
    if (typeof value !== 'string' || utf8Bytes(value) > maxBytes) {
        return `${name} must be a string of at most ${maxBytes} UTF-8 bytes`;
    }
    return null;
}

function validateRequiredBoundedString(
    value: unknown,
    name: string,
    maxBytes = MAX_PROTOCOL_STRING_BYTES,
): string | null {
    const error = validateBoundedString(value, name, maxBytes);
    if (error) {
        return error;
    }
    return (value as string).length === 0 ? `${name} must not be empty` : null;
}

function validateRequiredAsciiToken(value: unknown, name: string): string | null {
    const error = validateRequiredBoundedString(value, name);
    if (error) {
        return error;
    }
    return /^[\x20-\x7e]+$/.test(value as string)
        ? null
        : `${name} must contain printable ASCII characters only`;
}

function validateSafeInteger(value: unknown, name: string, minimum = 0): string | null {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
        return `${name} must be a safe integer >= ${minimum}`;
    }
    return null;
}

function validateCursor(value: unknown, name: string): string | null {
    if (value === undefined) {
        return null;
    }
    if (!isObject(value)) {
        return `${name} must be an object`;
    }
    return validateKnownProperties(value, new Set(['syncOrder', 'id']), name)
        ?? validateSafeInteger(value.syncOrder, `${name}.syncOrder`)
        ?? (typeof value.id !== 'string' || !NEG_SYNC_ID_RE.test(value.id)
            ? `${name}.id must be 64 hexadecimal characters`
            : null);
}

function validateWindowCursor(value: unknown, name: string): string | null {
    if (!isObject(value)) {
        return `${name} must be an object`;
    }
    return validateKnownProperties(value, new Set(['ts', 'id']), name)
        ?? validateSafeInteger(value.ts, `${name}.ts`)
        ?? (typeof value.id !== 'string' || !NEG_SYNC_ID_RE.test(value.id)
            ? `${name}.id must be 64 hexadecimal characters`
            : null);
}

function validateWindowProgress(value: unknown, name: string): string | null {
    if (value === undefined) {
        return null;
    }
    if (!isObject(value) || typeof value.cappedByRecords !== 'boolean') {
        return `${name} must contain a boolean cappedByRecords`;
    }
    return validateKnownProperties(value, new Set(['cappedByRecords', 'lastCursor']), name)
        ?? (value.lastCursor === undefined
            ? null
            : validateWindowCursor(value.lastCursor, `${name}.lastCursor`));
}

function validateWindow(value: unknown, maxRecords: number): string | null {
    if (!isObject(value)) {
        return 'window must be an object';
    }
    const nameError = validateKnownProperties(
        value,
        new Set(['name', 'fromTs', 'toTs', 'maxRecords', 'order', 'after']),
        'window',
    ) ?? validateRequiredBoundedString(value.name, 'window.name');
    if (nameError) {
        return nameError;
    }
    const fromError = validateSafeInteger(value.fromTs, 'window.fromTs');
    if (fromError) {
        return fromError;
    }
    const toError = validateSafeInteger(value.toTs, 'window.toTs');
    if (toError) {
        return toError;
    }
    if ((value.fromTs as number) > (value.toTs as number)) {
        return 'window.fromTs must not exceed window.toTs';
    }
    const orderError = validateSafeInteger(value.order, 'window.order');
    if (orderError) {
        return orderError;
    }
    if (!Number.isSafeInteger(value.maxRecords)
        || (value.maxRecords as number) <= 0
        || (value.maxRecords as number) > maxRecords) {
        return `window.maxRecords must be a safe integer between 1 and ${maxRecords}`;
    }
    return value.after === undefined ? null : validateWindowCursor(value.after, 'window.after');
}

function validateCanonicalBase64(value: string): Buffer | null {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        return null;
    }
    const decoded = Buffer.from(value, 'base64');
    return decoded.toString('base64') === value ? decoded : null;
}

function validateFrame(value: unknown, maxFrameBytes: number): string | null {
    if (!isObject(value) || (value.encoding !== 'utf8' && value.encoding !== 'base64') || typeof value.data !== 'string') {
        return 'frame must contain a supported encoding and string data';
    }
    const propertyError = validateKnownProperties(value, new Set(['encoding', 'data']), 'frame');
    if (propertyError) {
        return propertyError;
    }

    if (value.encoding === 'utf8') {
        const bytes = utf8Bytes(value.data);
        return maxFrameBytes > 0 && bytes > maxFrameBytes
            ? `frame exceeds ${maxFrameBytes} decoded bytes`
            : null;
    }

    if (maxFrameBytes > 0 && utf8Bytes(value.data) > Math.ceil(maxFrameBytes / 3) * 4) {
        return `frame exceeds ${maxFrameBytes} decoded bytes`;
    }
    const decoded = validateCanonicalBase64(value.data);
    if (!decoded) {
        return 'frame data must be canonical base64';
    }
    return maxFrameBytes > 0 && decoded.length > maxFrameBytes
        ? `frame exceeds ${maxFrameBytes} decoded bytes`
        : null;
}

function validateOrderedCapability(value: unknown): string | null {
    if (value === undefined) {
        return null;
    }
    if (!isObject(value)) {
        return 'ordered must be an object';
    }
    const propertyError = validateKnownProperties(value, new Set(['count', 'sourceReady']), 'ordered');
    if (propertyError) {
        return propertyError;
    }
    const countError = validateSafeInteger(value.count, 'ordered.count');
    if (countError) {
        return countError;
    }
    if (typeof value.sourceReady !== 'boolean') {
        return 'ordered.sourceReady must be a boolean';
    }
    if (value.sourceReady && value.count === 0) {
        return 'ordered.sourceReady requires a non-zero count';
    }
    return null;
}

function validatePing(message: Record<string, unknown>): string | null {
    const versionError = validateSafeInteger(message.version, 'version');
    if (versionError) {
        return versionError;
    }
    if (message.version !== WIRE_PROTOCOL_VERSION) {
        return `version must be ${WIRE_PROTOCOL_VERSION}`;
    }
    if (message.name !== undefined) {
        const nameError = validateBoundedString(message.name, 'name');
        if (nameError) {
            return nameError;
        }
    }
    if (message.latestTs !== undefined) {
        const latestTsError = validateSafeInteger(message.latestTs, 'latestTs');
        if (latestTsError) {
            return latestTsError;
        }
    }
    if (message.peerDids === undefined) {
        return validateOrderedCapability(message.ordered);
    }
    if (!Array.isArray(message.peerDids) || message.peerDids.length > MAX_ADVERTISED_PEERS) {
        return `peerDids must be an array of at most ${MAX_ADVERTISED_PEERS} DIDs`;
    }
    for (let index = 0; index < message.peerDids.length; index += 1) {
        const did = message.peerDids[index];
        if (typeof did !== 'string' || utf8Bytes(did) > MAX_ADVERTISED_DID_BYTES || !isValidDID(did)) {
            return `peerDids[${index}] must be a valid DID of at most ${MAX_ADVERTISED_DID_BYTES} UTF-8 bytes`;
        }
    }
    return validateOrderedCapability(message.ordered);
}

function validateSessionEnvelope(message: Record<string, unknown>): string | null {
    const sessionError = validateRequiredAsciiToken(message.sessionId, 'sessionId');
    if (sessionError) {
        return sessionError;
    }
    if (message.type === 'ordered_catchup_req'
        || message.type === 'ordered_catchup_push'
        || message.type === 'ordered_catchup_done') {
        return message.type === 'ordered_catchup_push' && typeof message.hasMore !== 'boolean'
            ? 'hasMore must be a boolean'
            : null;
    }
    return validateRequiredAsciiToken(message.windowId, 'windowId')
        ?? validateSafeInteger(message.round, 'round')
        ?? (message.type === 'ops_offer' ? validateSafeInteger(message.offerId, 'offerId') : null)
        ?? (message.type === 'ops_req' || message.type === 'ops_push' || message.type === 'ops_ack'
            ? validateSafeInteger(message.requestId, 'requestId')
            : null)
        ?? (message.type === 'ops_push' || message.type === 'ops_ack'
            ? validateSafeInteger(message.page, 'page')
            : null)
        ?? (message.type === 'neg_close' && message.reason !== undefined
            ? validateBoundedString(message.reason, 'reason')
            : null);
}

export function validateHyperMessageEnvelope(
    value: unknown,
    deferIncompatiblePingVersion?: number,
): ProtocolValidationResult<HyperMessage> {
    if (!isObject(value) || typeof value.type !== 'string' || !MESSAGE_TYPES.has(value.type as HyperMessage['type'])) {
        return { ok: false, reason: 'unknown or missing message type' };
    }
    const incompatiblePing = deferIncompatiblePingVersion !== undefined
        && value.type === 'ping'
        && (value.version === undefined
            || (Number.isSafeInteger(value.version) && value.version !== deferIncompatiblePingVersion));
    if (incompatiblePing) {
        return { ok: true, value: value as unknown as PingMessage };
    }
    const propertyError = validateKnownProperties(
        value,
        MESSAGE_PROPERTIES[value.type as HyperMessage['type']],
        value.type,
    );
    if (propertyError) {
        return { ok: false, reason: propertyError };
    }
    if (value.type === 'ping') {
        const pingError = validatePing(value);
        return pingError
            ? { ok: false, reason: pingError }
            : { ok: true, value: value as unknown as PingMessage };
    }
    if (value.type !== 'queue') {
        const sessionError = validateSessionEnvelope(value);
        if (sessionError) {
            return { ok: false, reason: sessionError };
        }
    }
    return { ok: true, value: value as unknown as HyperMessage };
}

export function validateQueueMessagePayload(
    message: QueueMessage,
    limits: OpsPushBatchingOptions,
): ProtocolValidationResult<ValidatedOperationPage> {
    if (Object.prototype.hasOwnProperty.call(message, 'deferred')) {
        return { ok: false, reason: 'deferred is not valid for queue' };
    }
    return validateOperationPage(message.operations, limits);
}

export function validateHyperMessagePayload(
    message: HyperMessage,
    limits: ProtocolPayloadLimits,
): ProtocolValidationResult<HyperMessage> {
    let reason: string | null = null;
    const messageType = message.type;
    if (message.type === 'queue') {
        const result = validateQueueMessagePayload(message, limits);
        return result.ok ? { ok: true, value: message } : result;
    }
    if (messageType !== 'ops_req' && messageType !== 'ops_ack'
        && Object.prototype.hasOwnProperty.call(message, 'deferred')) {
        return { ok: false, reason: `deferred is not valid for ${messageType}` };
    }
    if (message.type === 'ops_push') {
        if (typeof message.hasMore !== 'boolean') {
            return { ok: false, reason: 'hasMore must be a boolean' };
        }
        const result = validateOperationPage(message.data, limits);
        if (!result.ok) {
            return result;
        }
        return message.hasMore && result.value.operations.length === 0
            ? { ok: false, reason: 'a non-final ops_push page must not be empty' }
            : { ok: true, value: message };
    }
    if (message.type === 'ops_ack') {
        return message.deferred === undefined || typeof message.deferred === 'boolean'
            ? { ok: true, value: message }
            : { ok: false, reason: 'deferred must be a boolean' };
    }
    if (message.type === 'ordered_catchup_push') {
        if (message.cursor === undefined) {
            return { ok: false, reason: 'cursor is required' };
        }
        reason = validateCursor(message.cursor, 'cursor');
        if (reason) {
            return { ok: false, reason };
        }
        const result = validateOperationPage(message.operations, limits);
        if (!result.ok) {
            return result;
        }
        return result.value.operations.length === 0
            ? { ok: false, reason: 'ordered_catchup_push operations must not be empty' }
            : { ok: true, value: message };
    }
    if (message.type === 'ops_offer') {
        const result = validateIdList(message.ids, limits.maxIdsPerRequest);
        if (!result.ok) {
            return result;
        }
        if (result.value.length !== message.ids.length) {
            return { ok: false, reason: 'ops_offer ids must be unique' };
        }
        return message.ids.length === 0
            ? { ok: false, reason: 'ops_offer ids must not be empty' }
            : { ok: true, value: message };
    }
    if (message.type === 'ops_req') {
        const result = validateIdList(message.ids, limits.maxIdsPerRequest);
        if (!result.ok) {
            return result;
        }
        if (result.value.length !== message.ids.length) {
            return { ok: false, reason: 'ops_req ids must be unique' };
        }
        if (message.offerId !== undefined) {
            const offerError = validateSafeInteger(message.offerId, 'offerId');
            if (offerError) {
                return { ok: false, reason: offerError };
            }
            if (message.deferred !== undefined && typeof message.deferred !== 'boolean') {
                return { ok: false, reason: 'deferred must be a boolean' };
            }
            return { ok: true, value: message };
        }
        if (message.ids.length === 0) {
            return { ok: false, reason: 'a direct ops_req must not be empty' };
        }
        return message.deferred === undefined
            ? { ok: true, value: message }
            : { ok: false, reason: 'deferred is valid only for an offered request' };
    }
    if (message.type === 'ordered_catchup_req') {
        reason = validateCursor(message.after, 'after');
    } else if (message.type === 'neg_open') {
        reason = validateWindow(message.window, limits.maxRecordsPerWindow)
            ?? validateFrame(message.frame, limits.maxFrameBytes)
            ?? validateWindowProgress(message.previousWindowProgress, 'previousWindowProgress');
    } else if (message.type === 'neg_msg') {
        reason = validateFrame(message.frame, limits.maxFrameBytes)
            ?? validateWindowProgress(message.windowProgress, 'windowProgress');
    } else if (message.type === 'neg_close') {
        reason = validateWindowProgress(message.windowProgress, 'windowProgress');
    }
    return reason ? { ok: false, reason } : { ok: true, value: message };
}

export function validateOperationContentIds(
    operations: Operation[],
    hashProvider: { hashJSON(value: unknown): string },
): ProtocolValidationResult<Operation[]> {
    for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        const mapped = mapOperationToSyncKey(operation);
        if (!mapped.ok) {
            return { ok: false, reason: `operation at index ${index}: ${mapped.reason}` };
        }
        if (!hasContentVerifiedOperationId(operation, hashProvider)) {
            return { ok: false, reason: `operation at index ${index} has a content ID mismatch` };
        }
    }
    return { ok: true, value: operations };
}
