import { Operation } from '@mdip/gatekeeper/types';
import {
    collectNewIds,
    chunkIds,
    chunkOperationsForPush,
    estimateOperationBytes,
    validateIdList,
    validateOperationPage,
} from '../../services/mediators/hyperswarm/src/negentropy/transfer.ts';

const h = (c: string) => c.repeat(64);

function makeOp(hashChar: string, sizeTag: string = ''): Operation {
    return {
        type: 'create',
        data: { note: `${sizeTag}${'x'.repeat(sizeTag.length * 20)}` },
        signature: {
            hash: h(hashChar),
            signed: '2026-02-12T00:00:00.000Z',
            value: `sig-${hashChar}`,
        },
    };
}

describe('negentropy transfer batching helpers', () => {
    it('throws on invalid chunking options', () => {
        expect(() => chunkIds(['a'], 0)).toThrow('maxPerChunk');
        expect(() => chunkOperationsForPush([makeOp('a')], {
            maxOpsPerPush: 0,
            maxBytesPerPush: 1024,
        })).toThrow('maxOpsPerPush');
        expect(() => chunkOperationsForPush([makeOp('a')], {
            maxOpsPerPush: 1,
            maxBytesPerPush: 0,
        })).toThrow('maxBytesPerPush');
        expect(() => chunkOperationsForPush(null as unknown as Operation[], {
            maxOpsPerPush: 1,
            maxBytesPerPush: 1024,
        })).toThrow('operation page must be an array');
    });

    it('chunks id lists with de-duplication', () => {
        const ids = [h('A'), h('b'), h('c'), h('c'), h('d'), h('e')];
        const chunks = chunkIds(ids, 2);
        expect(chunks).toStrictEqual([
            [h('a'), h('b')],
            [h('c'), h('d')],
            [h('e')],
        ]);
        for (const chunk of chunks) {
            expect(validateIdList(chunk, 2).ok).toBe(true);
        }
    });

    it('rejects malformed outbound IDs', () => {
        expect(() => chunkIds(null as unknown as string[], 1)).toThrow('ID list must be an array');
        expect(() => chunkIds(['not-a-sync-id'], 1)).toThrow(
            'ID at index 0 must be 64 hexadecimal characters'
        );
    });

    it('returns empty id chunks when input ids are empty', () => {
        expect(chunkIds([], 2)).toStrictEqual([]);
    });

    it('collects only ids not already seen in the current session', () => {
        const seen = new Set<string>(['a', 'c']);

        const fresh = collectNewIds(['a', 'b', 'b', 'c', 'd'], seen);

        expect(fresh).toStrictEqual(['b', 'd']);
        expect(Array.from(seen)).toStrictEqual(['a', 'c', 'b', 'd']);
    });

    it('returns empty from collectNewIds when input is empty', () => {
        expect(collectNewIds([], new Set<string>())).toStrictEqual([]);
    });

    it('splits operations by count and bytes', () => {
        const ops = [
            makeOp('a', 'small'),
            makeOp('b', 'small'),
            makeOp('c', 'this-is-a-larger-payload'),
            makeOp('d', 'small'),
        ];
        const bytesA = estimateOperationBytes(ops[0]);
        const bytesB = estimateOperationBytes(ops[1]);
        const bytesC = estimateOperationBytes(ops[2]);

        const batches = chunkOperationsForPush(ops, {
            maxOpsPerPush: 2,
            maxBytesPerPush: bytesA + bytesB + Math.floor(bytesC / 2),
        });

        expect(batches.length).toBeGreaterThanOrEqual(2);
        expect(batches[0].length).toBeLessThanOrEqual(2);
        expect(batches.flat().length).toBe(ops.length);
    });

    it('rejects a single operation that exceeds the page byte limit', () => {
        const op = makeOp('a', 'x'.repeat(200));

        expect(() => chunkOperationsForPush([op], {
            maxOpsPerPush: 10,
            maxBytesPerPush: 32,
        })).toThrow('operation at index 0 exceeds 32 bytes');
    });

    it('returns empty when operations input is empty', () => {
        expect(chunkOperationsForPush([], {
            maxOpsPerPush: 10,
            maxBytesPerPush: 1024,
        })).toStrictEqual([]);
    });

    it('accepts an operation page at its exact count and byte limits', () => {
        const operations = [makeOp('a'), makeOp('b')];
        const bytes = operations.reduce((total, operation) => total + estimateOperationBytes(operation), 0);

        expect(validateOperationPage(operations, {
            maxOpsPerPush: operations.length,
            maxBytesPerPush: bytes,
        })).toStrictEqual({
            ok: true,
            value: { operations, bytes },
        });
    });

    it('rejects raw operation counts before duplicate removal', () => {
        const operation = makeOp('a');

        expect(validateOperationPage(Array(301).fill(operation), {
            maxOpsPerPush: 300,
            maxBytesPerPush: 512 * 1024,
        })).toStrictEqual({
            ok: false,
            reason: 'operation page exceeds 300 operations',
        });
    });

    it('rejects malformed operation pages and entries', () => {
        const options = { maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024 };

        expect(validateOperationPage({}, options)).toStrictEqual({
            ok: false,
            reason: 'operation page must be an array',
        });
        expect(validateOperationPage([null], options)).toStrictEqual({
            ok: false,
            reason: 'operation at index 0 must be an object',
        });
        expect(validateOperationPage([[]], options)).toStrictEqual({
            ok: false,
            reason: 'operation at index 0 must be an object',
        });
    });

    it('rejects operations that cannot be serialized', () => {
        const options = { maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024 };
        const undefinedJson = { toJSON: () => undefined };
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        expect(validateOperationPage([undefinedJson], options)).toStrictEqual({
            ok: false,
            reason: 'operation at index 0 is not serializable',
        });
        expect(validateOperationPage([circular], options)).toStrictEqual({
            ok: false,
            reason: 'operation at index 0 is not serializable',
        });
    });

    it('rejects a page whose individually valid operations exceed the total byte limit', () => {
        const operations = [makeOp('a'), makeOp('b')];
        const maxBytesPerPush = Math.max(...operations.map(estimateOperationBytes));

        expect(validateOperationPage(operations, {
            maxOpsPerPush: 2,
            maxBytesPerPush,
        })).toStrictEqual({
            ok: false,
            reason: `operation page exceeds ${maxBytesPerPush} bytes`,
        });
    });

    it('counts multibyte operation data as UTF-8 bytes', () => {
        const operation = makeOp('a');
        operation.data = { note: '£££' };
        const bytes = estimateOperationBytes(operation);

        expect(bytes).toBeGreaterThan(JSON.stringify(operation).length);
        expect(validateOperationPage([operation], {
            maxOpsPerPush: 1,
            maxBytesPerPush: bytes - 1,
        })).toStrictEqual({
            ok: false,
            reason: `operation at index 0 exceeds ${bytes - 1} bytes`,
        });
    });

    it('rejects a single operation larger than 512 KiB', () => {
        const operation = makeOp('a');
        operation.data = { note: 'x'.repeat(512 * 1024) };

        expect(validateOperationPage([operation], {
            maxOpsPerPush: 300,
            maxBytesPerPush: 512 * 1024,
        })).toStrictEqual({
            ok: false,
            reason: `operation at index 0 exceeds ${512 * 1024} bytes`,
        });
    });

    it('produces outbound chunks that pass operation-page validation', () => {
        const operations = Array.from({ length: 7 }, (_, index) => makeOp((index + 1).toString(16)));
        const options = {
            maxOpsPerPush: 2,
            maxBytesPerPush: estimateOperationBytes(operations[0]) * 2,
        };

        const batches = chunkOperationsForPush(operations, options);

        expect(batches.flat()).toStrictEqual(operations);
        for (const batch of batches) {
            expect(validateOperationPage(batch, options).ok).toBe(true);
        }
    });

    it('validates, normalizes, and deduplicates ID lists after admission', () => {
        const upper = h('A');
        const lower = h('a');
        const other = h('b');

        expect(validateIdList([upper, lower, other], 3)).toStrictEqual({
            ok: true,
            value: [lower, other],
        });
    });

    it('accepts exactly 1,000 IDs and rejects 1,001 raw duplicate IDs', () => {
        const ids = Array.from({ length: 1_000 }, (_, index) => index.toString(16).padStart(64, '0'));
        expect(validateIdList(ids, 1_000)).toMatchObject({ ok: true });

        expect(validateIdList(Array(1_001).fill(h('a')), 1_000)).toStrictEqual({
            ok: false,
            reason: 'ID list exceeds 1000 entries',
        });
    });

    it('rejects malformed ID lists and entries', () => {
        expect(validateIdList({}, 1_000)).toStrictEqual({
            ok: false,
            reason: 'ID list must be an array',
        });
        expect(validateIdList([123], 1_000)).toStrictEqual({
            ok: false,
            reason: 'ID at index 0 must be 64 hexadecimal characters',
        });
        expect(validateIdList(['not-a-sync-id'], 1_000)).toStrictEqual({
            ok: false,
            reason: 'ID at index 0 must be 64 hexadecimal characters',
        });
    });
});
