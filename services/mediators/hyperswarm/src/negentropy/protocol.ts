import { Operation } from '@mdip/gatekeeper/types';
import type { SyncStoreCursor } from '../db/types.js';
import type { ReconciliationWindow } from './adapter.js';

export type SyncMode = 'negentropy';
export type NegentropyFrameEncoding = 'utf8' | 'base64';
export const NEG_SYNC_ID_RE = /^[a-f0-9]{64}$/i;

export interface PeerCapabilities {
    negentropy?: boolean;
    negentropyVersion?: number;
    orderedCatchup?: boolean;
    orderedCatchupVersion?: number;
    orderedCatchupReady?: boolean;
    operationCount?: number;
    orderedOperationCount?: number;
}

export interface OrderedCatchupCapabilityOptions {
    enabled: boolean;
    version: number;
    operationCount: number;
    orderedOperationCount: number;
}

export interface NegotiatedPeerCapabilities {
    advertised: boolean;
    negentropy: boolean;
    version: number | null;
    orderedCatchup: boolean;
    orderedCatchupVersion: number | null;
    orderedCatchupReady: boolean;
    operationCount: number | null;
    orderedOperationCount: number | null;
}

export type ConnectSyncModeReason =
    | 'negentropy_supported'
    | 'missing_capabilities'
    | 'negentropy_disabled'
    | 'version_mismatch'
    | 'transport_framing_unsupported';

export interface ConnectSyncModeDecision {
    mode: SyncMode | null;
    reason: ConnectSyncModeReason;
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
        const afterId = String(raw.after?.id ?? '').toLowerCase();

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
    if (!capabilities) {
        return {
            advertised: false,
            negentropy: false,
            version: null,
            orderedCatchup: false,
            orderedCatchupVersion: null,
            orderedCatchupReady: false,
            operationCount: null,
            orderedOperationCount: null,
        };
    }

    return {
        advertised: true,
        negentropy: capabilities.negentropy === true,
        version: normalizeNonNegativeInteger(capabilities.negentropyVersion),
        orderedCatchup: capabilities.orderedCatchup === true,
        orderedCatchupVersion: normalizeNonNegativeInteger(capabilities.orderedCatchupVersion),
        orderedCatchupReady: capabilities.orderedCatchupReady === true,
        operationCount: normalizeNonNegativeInteger(capabilities.operationCount),
        orderedOperationCount: normalizeNonNegativeInteger(capabilities.orderedOperationCount),
    };
}

function normalizeNonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && (value as number) >= 0
        ? (value as number)
        : null;
}

export function buildOrderedCatchupCapabilities(
    options: OrderedCatchupCapabilityOptions,
): Pick<
    PeerCapabilities,
    'orderedCatchup' | 'orderedCatchupVersion' | 'orderedCatchupReady' | 'operationCount' | 'orderedOperationCount'
> {
    const operationCount = normalizeNonNegativeInteger(options.operationCount) ?? 0;
    const orderedOperationCount = normalizeNonNegativeInteger(options.orderedOperationCount) ?? 0;
    const enabled = options.enabled === true;

    return {
        orderedCatchup: enabled,
        orderedCatchupVersion: enabled ? options.version : undefined,
        orderedCatchupReady: enabled && operationCount > 0 && operationCount === orderedOperationCount,
        operationCount,
        orderedOperationCount,
    };
}

export function supportsPeerNegentropy(
    capabilities: NegotiatedPeerCapabilities,
    requiredVersion: number
): boolean {
    return capabilities.advertised
        && capabilities.negentropy
        && capabilities.version === requiredVersion;
}

export function chooseSyncMode(
    capabilities: NegotiatedPeerCapabilities,
    requiredVersion: number
): SyncMode | null {
    if (!capabilities.advertised) {
        return null;
    }

    return supportsPeerNegentropy(capabilities, requiredVersion)
        ? 'negentropy'
        : null;
}

export function chooseConnectSyncMode(
    capabilities: NegotiatedPeerCapabilities,
    requiredVersion: number,
    negentropyEnabled = true,
    transportFramingSupported = true,
): ConnectSyncModeDecision {
    const unavailable = (reason: ConnectSyncModeReason): ConnectSyncModeDecision => ({
        mode: null,
        reason,
    });

    if (negentropyEnabled && supportsPeerNegentropy(capabilities, requiredVersion)) {
        if (!transportFramingSupported) {
            return unavailable('transport_framing_unsupported');
        }
        return { mode: 'negentropy', reason: 'negentropy_supported' };
    }

    if (!negentropyEnabled) {
        return unavailable('negentropy_disabled');
    }

    if (!capabilities.advertised) {
        return unavailable('missing_capabilities');
    }

    if (!capabilities.negentropy) {
        return unavailable('negentropy_disabled');
    }

    return unavailable('version_mismatch');
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
