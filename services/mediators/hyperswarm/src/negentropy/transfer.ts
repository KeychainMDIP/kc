import { Operation } from '@mdip/gatekeeper/types';
import { NEG_SYNC_ID_RE } from './protocol.js';

export interface OpsPushBatchingOptions {
    maxOpsPerPush: number;
    maxBytesPerPush: number;
}

export interface ValidatedOperationPage {
    operations: Operation[];
    bytes: number;
}

export type TransferValidationResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string };

function assertPositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
}

function measureOperation(
    operation: unknown,
    index: number,
    maxBytes: number,
): TransferValidationResult<number> {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        return { ok: false, reason: `operation at index ${index} must be an object` };
    }

    try {
        const serialized = JSON.stringify(operation);
        if (typeof serialized !== 'string') {
            return { ok: false, reason: `operation at index ${index} is not serializable` };
        }

        const bytes = Buffer.byteLength(serialized, 'utf8');
        if (bytes > maxBytes) {
            return { ok: false, reason: `operation at index ${index} exceeds ${maxBytes} bytes` };
        }
        return { ok: true, value: bytes };
    }
    catch {
        return { ok: false, reason: `operation at index ${index} is not serializable` };
    }
}

export function validateOperationPage(
    data: unknown,
    options: OpsPushBatchingOptions,
): TransferValidationResult<ValidatedOperationPage> {
    const { maxOpsPerPush, maxBytesPerPush } = options;
    assertPositiveInteger(maxOpsPerPush, 'maxOpsPerPush');
    assertPositiveInteger(maxBytesPerPush, 'maxBytesPerPush');

    if (!Array.isArray(data)) {
        return { ok: false, reason: 'operation page must be an array' };
    }
    if (data.length > maxOpsPerPush) {
        return { ok: false, reason: `operation page exceeds ${maxOpsPerPush} operations` };
    }

    let bytes = 0;
    for (let index = 0; index < data.length; index += 1) {
        const measured = measureOperation(data[index], index, maxBytesPerPush);
        if (!measured.ok) {
            return measured;
        }
        bytes += measured.value;
        if (bytes > maxBytesPerPush) {
            return { ok: false, reason: `operation page exceeds ${maxBytesPerPush} bytes` };
        }
    }

    return {
        ok: true,
        value: {
            operations: data as Operation[],
            bytes,
        },
    };
}

export function validateIdList(
    data: unknown,
    maxIdsPerRequest: number,
): TransferValidationResult<string[]> {
    assertPositiveInteger(maxIdsPerRequest, 'maxIdsPerRequest');

    if (!Array.isArray(data)) {
        return { ok: false, reason: 'ID list must be an array' };
    }
    if (data.length > maxIdsPerRequest) {
        return { ok: false, reason: `ID list exceeds ${maxIdsPerRequest} entries` };
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < data.length; index += 1) {
        const rawId = data[index];
        if (typeof rawId !== 'string' || !NEG_SYNC_ID_RE.test(rawId)) {
            return { ok: false, reason: `ID at index ${index} must be 64 hexadecimal characters` };
        }

        const id = rawId.toLowerCase();
        if (!seen.has(id)) {
            seen.add(id);
            normalized.push(id);
        }
    }

    return { ok: true, value: normalized };
}

export function chunkIds(ids: string[], maxPerChunk: number): string[][] {
    assertPositiveInteger(maxPerChunk, 'maxPerChunk');

    if (!Array.isArray(ids)) {
        throw new Error('ID list must be an array');
    }
    if (ids.length === 0) {
        return [];
    }

    const validated = validateIdList(ids, ids.length);
    if (!validated.ok) {
        throw new Error(validated.reason);
    }

    const chunks: string[][] = [];
    for (let i = 0; i < validated.value.length; i += maxPerChunk) {
        chunks.push(validated.value.slice(i, i + maxPerChunk));
    }
    return chunks;
}

export function collectNewIds(ids: string[], seen: Set<string>): string[] {
    if (!Array.isArray(ids) || ids.length === 0) {
        return [];
    }

    const fresh: string[] = [];
    for (const id of ids) {
        if (seen.has(id)) {
            continue;
        }

        seen.add(id);
        fresh.push(id);
    }

    return fresh;
}

export function chunkOperationsForPush(
    operations: Operation[],
    options: OpsPushBatchingOptions,
): Operation[][] {
    const { maxOpsPerPush, maxBytesPerPush } = options;
    assertPositiveInteger(maxOpsPerPush, 'maxOpsPerPush');
    assertPositiveInteger(maxBytesPerPush, 'maxBytesPerPush');

    if (!Array.isArray(operations)) {
        throw new Error('operation page must be an array');
    }
    if (operations.length === 0) {
        return [];
    }

    const batches: Operation[][] = [];
    let current: Operation[] = [];
    let currentBytes = 0;

    for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        const measured = measureOperation(operation, index, maxBytesPerPush);
        if (!measured.ok) {
            throw new Error(measured.reason);
        }
        const operationBytes = measured.value;
        const exceedsCount = current.length >= maxOpsPerPush;
        const exceedsBytes = current.length > 0 && (currentBytes + operationBytes) > maxBytesPerPush;

        if (exceedsCount || exceedsBytes) {
            batches.push(current);
            current = [];
            currentBytes = 0;
        }

        current.push(operation);
        currentBytes += operationBytes;
    }

    if (current.length > 0) {
        batches.push(current);
    }

    return batches;
}

export function estimateOperationBytes(operation: Operation): number {
    return Buffer.byteLength(JSON.stringify(operation), 'utf8');
}
