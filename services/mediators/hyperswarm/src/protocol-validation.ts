import { isValidDID } from '@mdip/ipfs/utils';
import type { Operation } from '@mdip/gatekeeper/types';
import type {
    HyperMessage,
    PingMessage,
} from './protocol-messages.js';
import { NEG_SYNC_ID_RE } from './negentropy/protocol.js';
import {
    validateIdList,
    validateOperationPage,
    type OpsPushBatchingOptions,
    type TransferValidationResult,
} from './negentropy/transfer.js';
import { mapOperationToSyncKey } from './sync-mapping.js';
import { hasContentVerifiedOperationId } from './sync-persistence.js';
import {
    MAX_ADVERTISED_DID_BYTES,
    MAX_ADVERTISED_PEERS,
    MAX_PROTOCOL_STRING_BYTES,
    MAX_PROTOCOL_TIMESTAMP_BYTES,
    MAX_RELAY_HINTS,
} from './protocol-limits.js';

const PEER_KEY_RE = /^[a-f0-9]{64}$/i;
const MESSAGE_TYPES = new Set<HyperMessage['type']>([
    'ping',
    'queue',
    'ordered_catchup_req',
    'ordered_catchup_push',
    'ordered_catchup_done',
    'neg_open',
    'neg_msg',
    'ops_req',
    'ops_push',
    'neg_close',
]);

type ProtocolValidationResult<T> = TransferValidationResult<T>;

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
    return validateSafeInteger(value.syncOrder, `${name}.syncOrder`)
        ?? (typeof value.id !== 'string' || !NEG_SYNC_ID_RE.test(value.id)
            ? `${name}.id must be 64 hexadecimal characters`
            : null);
}

function validateWindowCursor(value: unknown, name: string): string | null {
    if (!isObject(value)) {
        return `${name} must be an object`;
    }
    return validateSafeInteger(value.ts, `${name}.ts`)
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
    return value.lastCursor === undefined
        ? null
        : validateWindowCursor(value.lastCursor, `${name}.lastCursor`);
}

function validateWindow(value: unknown, maxRecords: number): string | null {
    if (!isObject(value)) {
        return 'window must be an object';
    }
    const nameError = validateRequiredBoundedString(value.name, 'window.name');
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

function validateCapabilities(value: unknown): string | null {
    if (value === undefined) {
        return null;
    }
    if (!isObject(value)) {
        return 'capabilities must be an object';
    }
    for (const name of ['negentropy', 'orderedCatchup', 'orderedCatchupReady'] as const) {
        if (value[name] !== undefined && typeof value[name] !== 'boolean') {
            return `capabilities.${name} must be a boolean`;
        }
    }
    for (const name of [
        'negentropyVersion',
        'orderedCatchupVersion',
        'operationCount',
        'orderedOperationCount',
        'latestSignedTimestamp',
    ] as const) {
        if (value[name] !== undefined) {
            const error = validateSafeInteger(value[name], `capabilities.${name}`);
            if (error) {
                return error;
            }
        }
    }
    return null;
}

function validatePing(message: Record<string, unknown>): string | null {
    if (!Array.isArray(message.peers) || message.peers.length > MAX_ADVERTISED_PEERS) {
        return `peers must be an array of at most ${MAX_ADVERTISED_PEERS} DIDs`;
    }
    for (let index = 0; index < message.peers.length; index += 1) {
        const did = message.peers[index];
        if (typeof did !== 'string' || utf8Bytes(did) > MAX_ADVERTISED_DID_BYTES || !isValidDID(did)) {
            return `peers[${index}] must be a valid DID of at most ${MAX_ADVERTISED_DID_BYTES} UTF-8 bytes`;
        }
    }
    return validateCapabilities(message.capabilities);
}

function validateCommonEnvelope(message: Record<string, unknown>): string | null {
    return validateBoundedString(message.time, 'time', MAX_PROTOCOL_TIMESTAMP_BYTES)
        ?? validateBoundedString(message.node, 'node')
        ?? (!Array.isArray(message.relays) || message.relays.length > MAX_RELAY_HINTS
            ? `relays must be an array of at most ${MAX_RELAY_HINTS} peer keys`
            : message.relays.some((relay: unknown) => typeof relay !== 'string' || !PEER_KEY_RE.test(relay))
                ? 'relays must contain only 64-character hexadecimal peer keys'
                : null);
}

function validateSessionEnvelope(message: Record<string, unknown>): string | null {
    const sessionError = validateRequiredBoundedString(message.sessionId, 'sessionId');
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
    return validateRequiredBoundedString(message.windowId, 'windowId')
        ?? validateSafeInteger(message.round, 'round')
        ?? (message.type === 'neg_close' && message.reason !== undefined
            ? validateBoundedString(message.reason, 'reason')
            : null);
}

export function validateHyperMessageEnvelope(value: unknown): ProtocolValidationResult<HyperMessage> {
    if (!isObject(value) || typeof value.type !== 'string' || !MESSAGE_TYPES.has(value.type as HyperMessage['type'])) {
        return { ok: false, reason: 'unknown or missing message type' };
    }
    const commonError = validateCommonEnvelope(value);
    if (commonError) {
        return { ok: false, reason: commonError };
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

export function validateHyperMessagePayload(
    message: HyperMessage,
    limits: ProtocolPayloadLimits,
): ProtocolValidationResult<HyperMessage> {
    let reason: string | null = null;
    if (message.type === 'queue' || message.type === 'ops_push') {
        const result = validateOperationPage(message.data, limits);
        return result.ok ? { ok: true, value: message } : result;
    }
    if (message.type === 'ordered_catchup_push') {
        reason = validateCursor(message.cursor, 'cursor');
        if (!reason) {
            const result = validateOperationPage(message.data, limits);
            return result.ok ? { ok: true, value: message } : result;
        }
    }
    if (message.type === 'ops_req') {
        const result = validateIdList(message.ids, limits.maxIdsPerRequest);
        return result.ok ? { ok: true, value: message } : result;
    }
    if (message.type === 'ordered_catchup_req') {
        reason = validateCursor(message.cursor, 'cursor');
    } else if (message.type === 'neg_open') {
        reason = validateWindow(message.window, limits.maxRecordsPerWindow)
            ?? validateFrame(message.frame, limits.maxFrameBytes);
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
