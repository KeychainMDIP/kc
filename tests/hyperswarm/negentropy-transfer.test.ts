import { Operation } from '@mdip/gatekeeper/types';
import {
    chunkIds,
    chunkOperationsForPush,
    estimateOperationBytes,
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
    });

    it('chunks id lists with de-duplication', () => {
        const ids = ['a', 'b', 'c', 'c', 'd', 'e'];
        const chunks = chunkIds(ids, 2);
        expect(chunks).toStrictEqual([
            ['a', 'b'],
            ['c', 'd'],
            ['e'],
        ]);
    });

    it('returns empty id chunks when input ids are empty', () => {
        expect(chunkIds([], 2)).toStrictEqual([]);
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

    it('keeps a single oversized op in its own batch', () => {
        const op = makeOp('a', 'x'.repeat(200));
        const batches = chunkOperationsForPush([op], {
            maxOpsPerPush: 10,
            maxBytesPerPush: 32,
        });

        expect(batches).toStrictEqual([[op]]);
    });

    it('returns empty when operations input is empty', () => {
        expect(chunkOperationsForPush([], {
            maxOpsPerPush: 10,
            maxBytesPerPush: 1024,
        })).toStrictEqual([]);
    });
});
