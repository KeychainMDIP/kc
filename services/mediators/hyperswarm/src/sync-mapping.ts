import { Operation } from '@mdip/gatekeeper/types';

// - id = operation.signature.hash (64 hex chars => 32 bytes)
// - timestamp = Math.floor(Date.parse(operation.signature.signed) / 1000) in epoch seconds
// - if timestamp is Unix epoch (0), remap to MDIP epoch (2024-01-01T00:00:00Z)
export const SYNC_ID_HEX_LEN = 64;
export const SYNC_ID_BYTES_LEN = 32;
export const MDIP_EPOCH_SECONDS = 1_704_067_200; // 2024-01-01T00:00:00Z

export interface SyncMappedOperation {
    idHex: string;
    idBytes: Buffer;
    tsSec: number;
    operation: Operation;
}

export type SyncMappingErrorCode =
    | 'missing_signature'
    | 'missing_signature_hash'
    | 'invalid_signature_hash_type'
    | 'invalid_signature_hash_format'
    | 'missing_signature_signed'
    | 'invalid_signature_signed_type'
    | 'invalid_signature_signed_value';

export interface SyncMappingFailure {
    ok: false;
    code: SyncMappingErrorCode;
    reason: string;
}

export interface SyncMappingSuccess {
    ok: true;
    value: SyncMappedOperation;
}

export type SyncMappingResult = SyncMappingFailure | SyncMappingSuccess;

function fail(code: SyncMappingErrorCode, reason: string): SyncMappingFailure {
    return { ok: false, code, reason };
}

export function mapOperationToSyncKey(operation: Operation): SyncMappingResult {
    const signature = operation.signature;

    if (!signature) {
        return fail('missing_signature', 'operation.signature is required');
    }

    if (signature.hash == null || signature.hash === '') {
        return fail('missing_signature_hash', 'operation.signature.hash is required');
    }

    if (typeof signature.hash !== 'string') {
        return fail('invalid_signature_hash_type', 'operation.signature.hash must be a string');
    }

    const idHex = signature.hash.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(idHex)) {
        return fail(
            'invalid_signature_hash_format',
            `operation.signature.hash must be ${SYNC_ID_HEX_LEN} hex characters`
        );
    }

    if (signature.signed == null || signature.signed === '') {
        return fail('missing_signature_signed', 'operation.signature.signed is required');
    }

    if (typeof signature.signed !== 'string') {
        return fail('invalid_signature_signed_type', 'operation.signature.signed must be a string');
    }

    const parsedSigned = Date.parse(signature.signed);
    if (!Number.isFinite(parsedSigned)) {
        return fail('invalid_signature_signed_value', 'operation.signature.signed must be parseable by Date.parse');
    }
    const tsSec = Math.floor(parsedSigned / 1000);
    const normalizedTsSec = tsSec === 0 ? MDIP_EPOCH_SECONDS : tsSec;

    const idBytes = Buffer.from(idHex, 'hex');
    if (idBytes.length !== SYNC_ID_BYTES_LEN) {
        return fail(
            'invalid_signature_hash_format',
            `operation.signature.hash must decode to ${SYNC_ID_BYTES_LEN} bytes`
        );
    }

    return {
        ok: true,
        value: {
            idHex,
            idBytes,
            tsSec: normalizedTsSec,
            operation,
        },
    };
}
