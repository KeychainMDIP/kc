import { Operation } from '@mdip/gatekeeper/types';

export type SyncMode = 'legacy' | 'negentropy';
export type NegentropyFrameEncoding = 'utf8' | 'base64';
export const NEG_SYNC_ID_RE = /^[a-f0-9]{64}$/i;

export interface PeerCapabilities {
    negentropy?: boolean;
    negentropyVersion?: number;
}

export interface NegotiatedPeerCapabilities {
    advertised: boolean;
    negentropy: boolean;
    version: number | null;
}

export type ConnectSyncModeReason =
    | 'negentropy_supported'
    | 'missing_capabilities'
    | 'negentropy_disabled'
    | 'version_mismatch'
    | 'legacy_disabled';

export interface ConnectSyncModeDecision {
    mode: SyncMode | null;
    reason: ConnectSyncModeReason;
}

export interface NegentropyFrame {
    encoding: NegentropyFrameEncoding;
    data: string;
}

export function normalizePeerCapabilities(capabilities?: PeerCapabilities): NegotiatedPeerCapabilities {
    if (!capabilities) {
        return {
            advertised: false,
            negentropy: false,
            version: null,
        };
    }

    return {
        advertised: true,
        negentropy: capabilities.negentropy === true,
        version: typeof capabilities.negentropyVersion === 'number'
            ? capabilities.negentropyVersion
            : null,
    };
}

export function supportsPeerNegentropy(
    capabilities: NegotiatedPeerCapabilities,
    minVersion: number
): boolean {
    return capabilities.advertised
        && capabilities.negentropy
        && (capabilities.version == null || capabilities.version >= minVersion);
}

export function chooseSyncMode(
    capabilities: NegotiatedPeerCapabilities,
    minVersion: number
): SyncMode | null {
    if (!capabilities.advertised) {
        return null;
    }

    return supportsPeerNegentropy(capabilities, minVersion)
        ? 'negentropy'
        : 'legacy';
}

export function chooseConnectSyncMode(
    capabilities: NegotiatedPeerCapabilities,
    minVersion: number,
    legacySyncEnabled: boolean,
    negentropyEnabled = true,
): ConnectSyncModeDecision {
    if (negentropyEnabled && supportsPeerNegentropy(capabilities, minVersion)) {
        return { mode: 'negentropy', reason: 'negentropy_supported' };
    }

    if (!legacySyncEnabled) {
        return { mode: null, reason: 'legacy_disabled' };
    }

    if (!negentropyEnabled) {
        return { mode: 'legacy', reason: 'negentropy_disabled' };
    }

    if (!capabilities.advertised) {
        return { mode: 'legacy', reason: 'missing_capabilities' };
    }

    if (!capabilities.negentropy) {
        return { mode: 'legacy', reason: 'negentropy_disabled' };
    }

    return { mode: 'legacy', reason: 'version_mismatch' };
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
