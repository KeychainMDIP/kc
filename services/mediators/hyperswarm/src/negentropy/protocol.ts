import { Operation } from '@mdip/gatekeeper/types';
import type { SyncStoreCursor } from '../db/types.js';
import type { ReconciliationWindow } from './adapter.js';

export type NegentropyFrameEncoding = 'utf8' | 'base64';
export const NEG_SYNC_ID_RE = /^[a-f0-9]{64}$/;

export interface PeerCapabilities {
    latestTs?: number;
    ordered?: OrderedCatchupCapability;
}

export interface OrderedCatchupCapability {
    count: number;
    sourceReady: boolean;
}

export interface OrderedCatchupCapabilityOptions {
    operationCount: number;
    orderedOperationCount: number;
}

export interface NegotiatedPeerCapabilities {
    ordered: OrderedCatchupCapability | null;
    latestTs: number | null;
}

export interface NegentropyFrame {
    encoding: NegentropyFrameEncoding;
    data: string;
}

export interface NegentropyWindowPayload {
    name: string;
    fromTs: number;
    toTs: number;
    maxRecords: number;
    order: number;
    after?: {
        ts: number;
        id: string;
    };
}

export function parseRemoteWindow(
    raw: NegentropyWindowPayload,
    maxRecordsLimit: number,
): ReconciliationWindow | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const fromTs = Number(raw.fromTs);
    const toTs = Number(raw.toTs);
    const order = Number(raw.order);
    const remoteMaxRecords = Number(raw.maxRecords);
    const maxRecords = Number.isInteger(remoteMaxRecords) && remoteMaxRecords > 0
        ? Math.min(remoteMaxRecords, maxRecordsLimit)
        : maxRecordsLimit;

    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
        return null;
    }

    if (!Number.isInteger(order) || order < 0) {
        return null;
    }

    let after: SyncStoreCursor | undefined;
    if (raw.after !== undefined) {
        const afterTs = Number(raw.after?.ts);
        const afterId = String(raw.after?.id ?? '');

        if (!Number.isInteger(afterTs) || !NEG_SYNC_ID_RE.test(afterId)) {
            return null;
        }

        after = {
            ts: afterTs,
            id: afterId,
        };
    }

    return {
        name: String(raw.name || `window_${order}`),
        fromTs,
        toTs,
        order,
        maxRecords,
        after,
    };
}

export function normalizePeerCapabilities(capabilities?: PeerCapabilities): NegotiatedPeerCapabilities {
    const count = normalizeNonNegativeInteger(capabilities?.ordered?.count);

    return {
        ordered: count === null || typeof capabilities?.ordered?.sourceReady !== 'boolean'
            ? null
            : { count, sourceReady: capabilities.ordered.sourceReady },
        latestTs: normalizeNonNegativeInteger(capabilities?.latestTs),
    };
}

function normalizeNonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && (value as number) >= 0
        ? (value as number)
        : null;
}

export function buildOrderedCatchupCapabilities(
    options: OrderedCatchupCapabilityOptions,
): OrderedCatchupCapability {
    const operationCount = normalizeNonNegativeInteger(options.operationCount) ?? 0;
    const orderedOperationCount = normalizeNonNegativeInteger(options.orderedOperationCount) ?? 0;
    return {
        count: operationCount,
        sourceReady: operationCount > 0 && operationCount === orderedOperationCount,
    };
}

export function encodeNegentropyFrame(frame: string | Uint8Array): NegentropyFrame {
    if (typeof frame === 'string') {
        return {
            encoding: 'utf8',
            data: frame,
        };
    }

    return {
        encoding: 'base64',
        data: Buffer.from(frame).toString('base64'),
    };
}

export function decodeNegentropyFrame(frame: NegentropyFrame): string | Uint8Array {
    if (frame.encoding === 'utf8') {
        return frame.data;
    }

    return Buffer.from(frame.data, 'base64');
}

export function normalizeNegentropyIds(ids: Array<string | Uint8Array>): string[] {
    const unique = new Set<string>();
    for (const id of ids) {
        const hex = typeof id === 'string'
            ? id.toLowerCase()
            : Buffer.from(id).toString('hex').toLowerCase();

        if (NEG_SYNC_ID_RE.test(hex)) {
            unique.add(hex);
        }
    }

    return Array.from(unique);
}

export function extractOperationHashes(operations: Operation[]): string[] {
    const unique = new Set<string>();
    for (const operation of operations) {
        const hash = operation.signature?.hash?.toLowerCase();
        if (hash && NEG_SYNC_ID_RE.test(hash)) {
            unique.add(hash);
        }
    }

    return Array.from(unique);
}
