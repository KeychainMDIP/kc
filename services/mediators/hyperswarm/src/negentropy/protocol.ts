import type { SyncStoreCursor } from '../db/types.js';
import type { ReconciliationWindow } from './adapter.js';
import { MDIP_EPOCH_SECONDS } from './windows.js';
import { MAX_NEGENTROPY_WINDOW_RECORDS } from '../protocol-limits.js';

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

export interface NegentropyWindowPayload {
    until: number;
    limit: number;
    after?: {
        ts: number;
        id: string;
    };
}

export function parseRemoteWindow(
    raw: NegentropyWindowPayload,
    windowSeq: number,
): ReconciliationWindow | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    if (Object.keys(raw).some(key => key !== 'until' && key !== 'limit' && key !== 'after')) {
        return null;
    }

    const toTs = Number(raw.until);
    const remoteMaxRecords = Number(raw.limit);
    if (!Number.isInteger(remoteMaxRecords)
        || remoteMaxRecords <= 0
        || remoteMaxRecords > MAX_NEGENTROPY_WINDOW_RECORDS) {
        return null;
    }
    const maxRecords = remoteMaxRecords;

    if (!Number.isSafeInteger(toTs) || toTs < MDIP_EPOCH_SECONDS) {
        return null;
    }

    if (!Number.isSafeInteger(windowSeq) || windowSeq < 0) {
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
        name: 'history_paged',
        fromTs: MDIP_EPOCH_SECONDS,
        toTs,
        order: windowSeq,
        maxRecords,
        ...(after ? { after } : {}),
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

export function encodeNegentropyFrame(frame: Uint8Array): string {
    return Buffer.from(frame).toString('base64');
}

export function decodeNegentropyFrame(frame: string): Uint8Array {
    return Buffer.from(frame, 'base64');
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
