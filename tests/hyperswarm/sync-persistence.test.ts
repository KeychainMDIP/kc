import { Operation } from '@mdip/gatekeeper/types';
import { jest } from '@jest/globals';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    dedupeOperationsByHash,
    filterKnownOperations,
    filterOperationsByAcceptedHashes,
    filterIndexRejectedOperations,
    mapAcceptedOperationsToSyncRecords,
    sortOperationsBySyncKey,
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

    it('maps pre-MDIP signed timestamp to MDIP epoch seconds', () => {
        const legacyEpoch = makeCreateOp('a', '1971-01-01T00:00:00.000Z');
        const result = mapAcceptedOperationsToSyncRecords([legacyEpoch]);
        expect(result.records.length).toBe(1);
        expect(result.records[0].ts).toBe(MDIP_EPOCH_SECONDS);
        expect(result.invalid).toBe(0);
    });

    it('maps unix epoch signed timestamp to MDIP epoch seconds', () => {
        const legacyEpoch = makeCreateOp('a', '1970-01-01T00:00:00.000Z');
        const result = mapAcceptedOperationsToSyncRecords([legacyEpoch]);
        expect(result.records.length).toBe(1);
        expect(result.records[0].ts).toBe(MDIP_EPOCH_SECONDS);
        expect(result.invalid).toBe(0);
    });

    it('sorts operations by sync key timestamp then id', () => {
        const later = makeCreateOp('c', '2026-02-10T10:00:00.200Z');
        const sameTimeHigherId = makeCreateOp('b', '2026-02-10T10:00:00.100Z');
        const sameTimeLowerId = makeCreateOp('a', '2026-02-10T10:00:00.100Z');
        const invalid = makeCreateOp('d', 'not-a-date');

        const sorted = sortOperationsBySyncKey([later, sameTimeHigherId, invalid, sameTimeLowerId]);

        expect(sorted).toStrictEqual([sameTimeLowerId, sameTimeHigherId, later, invalid]);
    });

    it('returns a copy for single-item input and empty for non-array input', () => {
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const input = [a];

        const single = sortOperationsBySyncKey(input);
        expect(single).toStrictEqual([a]);
        expect(single).not.toBe(input);

        expect(sortOperationsBySyncKey('not-an-array' as unknown as Operation[])).toStrictEqual([]);
    });

    it('sorts strictly by timestamp when ids differ but timestamps do not match', () => {
        const later = makeCreateOp('a', '2026-02-10T10:00:01.000Z');
        const earlier = makeCreateOp('f', '2026-02-10T10:00:00.000Z');

        expect(sortOperationsBySyncKey([later, earlier])).toStrictEqual([earlier, later]);
    });

    it('sorts same-timestamp operations by id in both comparator directions', () => {
        const higher = makeCreateOp('f', '2026-02-10T10:00:00.000Z');
        const lower = makeCreateOp('a', '2026-02-10T10:00:00.000Z');

        expect(sortOperationsBySyncKey([higher, lower])).toStrictEqual([lower, higher]);
    });

    it('executes the same-timestamp higher-id comparator branch', () => {
        const originalSort = Array.prototype.sort;
        const sortSpy = jest.spyOn(Array.prototype, 'sort').mockImplementation(function (
            this: unknown[],
            compareFn?: ((left: unknown, right: unknown) => number) | undefined,
        ) {
            if (compareFn) {
                compareFn(
                    {
                        mapped: {
                            ok: true,
                            value: {
                                ts: 1,
                                idHex: 'f'.repeat(64),
                            },
                        },
                        index: 0,
                    },
                    {
                        mapped: {
                            ok: true,
                            value: {
                                ts: 1,
                                idHex: 'a'.repeat(64),
                            },
                        },
                        index: 1,
                    },
                );
            }

            return originalSort.call(this, compareFn as typeof compareFn);
        });

        try {
            const higher = makeCreateOp('f', '2026-02-10T10:00:00.000Z');
            const lower = makeCreateOp('a', '2026-02-10T10:00:00.000Z');

            expect(sortOperationsBySyncKey([higher, lower])).toStrictEqual([lower, higher]);
        } finally {
            sortSpy.mockRestore();
        }
    });

    it('preserves original order when two operations share the same sync key', () => {
        const first = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const secondBase = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const second = {
            ...secondBase,
            signature: {
                ...secondBase.signature!,
                value: 'sig-second',
            },
        };

        expect(sortOperationsBySyncKey([first, second])).toStrictEqual([first, second]);
    });

    it('sorts valid operations ahead of invalid ones', () => {
        const valid = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const invalid = makeCreateOp('b', 'not-a-date');

        expect(sortOperationsBySyncKey([invalid, valid])).toStrictEqual([valid, invalid]);
    });

    it('executes the mixed valid-invalid comparator branch', () => {
        const originalSort = Array.prototype.sort;
        const sortSpy = jest.spyOn(Array.prototype, 'sort').mockImplementation(function (
            this: unknown[],
            compareFn?: ((left: unknown, right: unknown) => number) | undefined,
        ) {
            if (compareFn) {
                compareFn(
                    {
                        mapped: {
                            ok: true,
                            value: {
                                ts: 1,
                                idHex: 'a'.repeat(64),
                            },
                        },
                        index: 0,
                    },
                    {
                        mapped: {
                            ok: false,
                        },
                        index: 1,
                    },
                );
            }

            return originalSort.call(this, compareFn as typeof compareFn);
        });

        try {
            const valid = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
            const invalid = makeCreateOp('b', 'not-a-date');

            expect(sortOperationsBySyncKey([invalid, valid])).toStrictEqual([valid, invalid]);
        } finally {
            sortSpy.mockRestore();
        }
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
        expect(filterOperationsByAcceptedHashes([a])).toStrictEqual([]);
        expect(filterOperationsByAcceptedHashes([a], [])).toStrictEqual([]);
        expect(filterOperationsByAcceptedHashes([a], ['', '' as unknown as string])).toStrictEqual([]);
    });

    it('returns empty when operations input is empty or not an array', () => {
        expect(filterOperationsByAcceptedHashes([], [h('a')])).toStrictEqual([]);
        expect(filterOperationsByAcceptedHashes('not-an-array' as unknown as Operation[], [h('a')])).toStrictEqual([]);
    });

    it('de-duplicates operations by signature hash while preserving first occurrence order', () => {
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const b = makeCreateOp('b', '2026-02-10T11:00:00.000Z');
        const duplicateA = {
            ...a,
            signature: {
                ...a.signature!,
                value: 'sig-a-duplicate',
            },
        };

        expect(dedupeOperationsByHash([a, b, duplicateA])).toStrictEqual([a, b]);
        expect(dedupeOperationsByHash([])).toStrictEqual([]);
    });

    it('filters operations already present in the local sync-store', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.reset();

        const known = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const unknown = makeCreateOp('b', '2026-02-10T11:00:00.000Z');
        const invalid = makeCreateOp('c', 'not-a-date');

        const persisted = mapAcceptedOperationsToSyncRecords([known]);
        await store.upsertMany(persisted.records);

        const filtered = await filterKnownOperations([known, unknown, invalid], store, 1);

        expect(filtered.operations).toStrictEqual([unknown, invalid]);
        expect(filtered.mapped).toBe(2);
        expect(filtered.known).toBe(1);
        expect(filtered.invalid).toBe(1);
    });

    it('drops repeated known operations while only looking up each id once', async () => {
        const known = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const unknown = makeCreateOp('b', '2026-02-10T11:00:00.000Z');

        const getByIds = jest.fn(async (ids: string[]) => ids.includes(h('a'))
            ? [{
                id: h('a'),
                ts: Math.floor(Date.parse(known.signature!.signed) / 1000),
                operation: known,
                insertedAt: 1,
            }]
            : []);

        const filtered = await filterKnownOperations(
            [known, unknown, known],
            { getByIds },
            10,
        );

        expect(filtered.operations).toStrictEqual([unknown]);
        expect(filtered.mapped).toBe(3);
        expect(filtered.known).toBe(2);
        expect(filtered.invalid).toBe(0);
        expect(getByIds).toHaveBeenCalledTimes(1);
        expect(getByIds).toHaveBeenCalledWith([h('a'), h('b')]);
    });
});
