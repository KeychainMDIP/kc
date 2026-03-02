import { Operation } from '@mdip/gatekeeper/types';

export interface OpsPushBatchingOptions {
    maxOpsPerPush: number;
    maxBytesPerPush: number;
}

export function chunkIds(ids: string[], maxPerChunk: number): string[][] {
    if (!Number.isInteger(maxPerChunk) || maxPerChunk <= 0) {
        throw new Error('maxPerChunk must be a positive integer');
    }

    if (!Array.isArray(ids) || ids.length === 0) {
        return [];
    }

    const unique = Array.from(new Set(ids));
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += maxPerChunk) {
        chunks.push(unique.slice(i, i + maxPerChunk));
    }
    return chunks;
}

export function chunkOperationsForPush(
    operations: Operation[],
    options: OpsPushBatchingOptions,
): Operation[][] {
    const { maxOpsPerPush, maxBytesPerPush } = options;
    if (!Number.isInteger(maxOpsPerPush) || maxOpsPerPush <= 0) {
        throw new Error('maxOpsPerPush must be a positive integer');
    }

    if (!Number.isInteger(maxBytesPerPush) || maxBytesPerPush <= 0) {
        throw new Error('maxBytesPerPush must be a positive integer');
    }

    if (!Array.isArray(operations) || operations.length === 0) {
        return [];
    }

    const batches: Operation[][] = [];
    let current: Operation[] = [];
    let currentBytes = 0;

    for (const operation of operations) {
        const operationBytes = estimateOperationBytes(operation);
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
