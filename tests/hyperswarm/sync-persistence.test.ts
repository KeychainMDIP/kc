import { Operation } from '@mdip/gatekeeper/types';
import {
    filterOperationsByAcceptedHashes,
    filterIndexRejectedOperations,
    mapAcceptedOperationsToSyncRecords,
} from '../../services/mediators/hyperswarm/src/sync-persistence.ts';
import {
    MDIP_EPOCH_SECONDS,
} from '../../services/mediators/hyperswarm/src/sync-mapping.ts';

const h = (c: string) => c.repeat(64);

function makeCreateOp(hashChar: string, signed: string): Operation {
    return {
        type: 'create',
        created: signed,
        mdip: {
            version: 1,
            type: 'agent',
            registry: 'hyperswarm',
        },
        signature: {
            signed,
            hash: h(hashChar),
            value: `sig-${hashChar}`,
        },
    };
}

describe('sync-persistence helpers', () => {
    it('returns empty array when filterIndexRejectedOperations receives empty batch', () => {
        expect(filterIndexRejectedOperations([], [0, 1])).toStrictEqual([]);
    });

    it('filters rejected indices in original submitted order', () => {
        // eslint-disable-next-line sonarjs/no-duplicate-string
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        // eslint-disable-next-line sonarjs/no-duplicate-string
        const b = makeCreateOp('b', '2026-02-10T11:00:00.000Z');
        const c = makeCreateOp('c', '2026-02-10T12:00:00.000Z');

        const filtered = filterIndexRejectedOperations([a, b, c], [1, 0, 999, -1, 1]);

        expect(filtered).toStrictEqual([c]);
    });

    it('returns original batch when rejected indices are missing/empty', () => {
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const b = makeCreateOp('b', '2026-02-10T11:00:00.000Z');

        expect(filterIndexRejectedOperations([a, b], undefined)).toStrictEqual([a, b]);
        expect(filterIndexRejectedOperations([a, b], [])).toStrictEqual([a, b]);
    });

    it('maps accepted operations to sync records and counts invalid operations', () => {
        const valid = makeCreateOp('A', '2026-02-10T10:00:00.000Z');
        const invalid = makeCreateOp('b', 'not-a-date');

        const result = mapAcceptedOperationsToSyncRecords([valid, invalid]);

        expect(result.records.length).toBe(1);
        expect(result.records[0].id).toBe(h('a'));
        expect(result.records[0].ts).toBe(Math.floor(Date.parse(valid.signature!.signed) / 1000));
        expect(result.invalid).toBe(1);
    });

    it('maps unix epoch signed timestamp to MDIP epoch seconds', () => {
        const legacyEpoch = makeCreateOp('a', '1970-01-01T00:00:00.000Z');
        const result = mapAcceptedOperationsToSyncRecords([legacyEpoch]);
        expect(result.records.length).toBe(1);
        expect(result.records[0].ts).toBe(MDIP_EPOCH_SECONDS);
        expect(result.invalid).toBe(0);
    });

    it('returns no records when all operations are invalid', () => {
        const invalidA = makeCreateOp('a', 'not-a-date');
        const invalidB = { type: 'create' } as Operation;

        const result = mapAcceptedOperationsToSyncRecords([invalidA, invalidB]);
        expect(result.records).toStrictEqual([]);
        expect(result.invalid).toBe(2);
    });

    it('filters operations by accepted hashes', () => {
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const b = makeCreateOp('b', '2026-02-10T11:00:00.000Z');
        const c = makeCreateOp('c', '2026-02-10T12:00:00.000Z');

        const accepted = filterOperationsByAcceptedHashes([a, b, c], [h('a').toUpperCase(), h('c')]);
        expect(accepted).toStrictEqual([a, c]);
    });

    it('returns empty when accepted hashes are empty or normalize to empty set', () => {
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        expect(filterOperationsByAcceptedHashes([a], [])).toStrictEqual([]);
        expect(filterOperationsByAcceptedHashes([a], ['', '' as unknown as string])).toStrictEqual([]);
    });

    it('returns empty when operations input is empty or not an array', () => {
        expect(filterOperationsByAcceptedHashes([], [h('a')])).toStrictEqual([]);
        expect(filterOperationsByAcceptedHashes('not-an-array' as unknown as Operation[], [h('a')])).toStrictEqual([]);
    });
});
