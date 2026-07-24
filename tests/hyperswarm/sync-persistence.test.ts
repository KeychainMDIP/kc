import {
    GatekeeperEvent,
    Operation,
} from '@mdip/gatekeeper/types';
import { jest } from '@jest/globals';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    dedupeOperationsByHash,
    filterKnownOperations,
    filterOperationsByAcceptedHashes,
    mapAcceptedOperationsToSyncRecords,
    mapIndexExportOperationsToSyncRecords,
    partitionImportBatchOperations,
    prunePersistedSyncRecords,
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
    it('skips persisted-record pruning when there is nothing pending', async () => {
        const getByIds = jest.fn(async () => []);

        await expect(prunePersistedSyncRecords(new Map(), { getByIds }, 1)).resolves.toStrictEqual({
            checked: 0,
            removed: 0,
        });
        expect(getByIds).not.toHaveBeenCalled();
    });

    it('prunes stored retry records in bounded chunks and retains missing records', async () => {
        const operations = [
            makeCreateOp('a', '2026-02-10T10:00:00.000Z'),
            makeCreateOp('b', '2026-02-10T11:00:00.000Z'),
            makeCreateOp('c', '2026-02-10T12:00:00.000Z'),
        ];
        const records = mapAcceptedOperationsToSyncRecords(operations).records;
        const pending = new Map(records.map(record => [record.id, record]));
        const store = new InMemoryOperationSyncStore();
        await store.upsertMany([records[0], records[2]]);
        const getByIds = jest.spyOn(store, 'getByIds');

        await expect(prunePersistedSyncRecords(pending, store, 2)).resolves.toStrictEqual({
            checked: 3,
            removed: 2,
        });
        expect(getByIds).toHaveBeenNthCalledWith(1, [records[0].id, records[1].id]);
        expect(getByIds).toHaveBeenNthCalledWith(2, [records[2].id]);
        expect(Array.from(pending.keys())).toStrictEqual([records[1].id]);
    });

    it('does not prune a retry record replaced during its lookup', async () => {
        const operation = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const record = mapAcceptedOperationsToSyncRecords([operation]).records[0];
        const replacement = { ...record };
        const pending = new Map([[record.id, record]]);
        let releaseLookup!: () => void;
        const getByIds = jest.fn(() => new Promise<Awaited<ReturnType<InMemoryOperationSyncStore['getByIds']>>>(resolve => {
            releaseLookup = () => resolve([{ ...record, insertedAt: 1 }]);
        }));

        const pruning = prunePersistedSyncRecords(pending, { getByIds }, 1);
        pending.set(record.id, replacement);
        releaseLookup();

        await expect(pruning).resolves.toStrictEqual({ checked: 1, removed: 0 });
        expect(pending.get(record.id)).toBe(replacement);
    });

    it('retains unverified retry records when pruning fails', async () => {
        const operation = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const record = mapAcceptedOperationsToSyncRecords([operation]).records[0];
        const pending = new Map([[record.id, record]]);
        const getByIds = jest.fn(async () => {
            throw new Error('lookup failed');
        });

        await expect(prunePersistedSyncRecords(pending, { getByIds }, 1)).rejects.toThrow('lookup failed');
        expect(pending.get(record.id)).toBe(record);
    });

    it('returns empty partitions for an empty import batch', () => {
        expect(partitionImportBatchOperations([], [0, 1])).toStrictEqual({
            processCandidates: [],
            rejectedOperations: [],
        });
    });

    it('partitions rejected indices in original submitted order', () => {
        // eslint-disable-next-line sonarjs/no-duplicate-string
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        // eslint-disable-next-line sonarjs/no-duplicate-string
        const b = makeCreateOp('b', '2026-02-10T11:00:00.000Z');
        const c = makeCreateOp('c', '2026-02-10T12:00:00.000Z');

        const partitioned = partitionImportBatchOperations([a, b, c], [1, 0, 999, -1, 1]);

        expect(partitioned).toStrictEqual({
            processCandidates: [c],
            rejectedOperations: [a, b],
        });
    });

    it('returns the batch as process candidates when rejected indices are missing', () => {
        const a = makeCreateOp('a', '2026-02-10T10:00:00.000Z');
        const b = makeCreateOp('b', '2026-02-10T11:00:00.000Z');

        expect(partitionImportBatchOperations([a, b], undefined)).toStrictEqual({
            processCandidates: [a, b],
            rejectedOperations: [],
        });
    });

    it('maps accepted operations to sync records and counts invalid operations', () => {
        const valid = makeCreateOp('A', '2026-02-10T10:00:00.000Z');
        const invalid = makeCreateOp('b', 'not-a-date');

        const result = mapAcceptedOperationsToSyncRecords([valid, invalid]);

        expect(result.records.length).toBe(1);
        expect(result.records[0].id).toBe(h('a'));
        expect(result.records[0].syncOrder).toBeUndefined();
        expect(result.records[0].signedTs).toBe(Math.floor(Date.parse(valid.signature!.signed) / 1000));
        expect(result.records[0].ts).toBe(Math.floor(Date.parse(valid.signature!.signed) / 1000));
        expect(result.invalid).toBe(1);
    });

    it('maps index export operation rows with sync order', () => {
        const valid = makeCreateOp('A', '2026-02-10T10:00:00.000Z');
        const event: GatekeeperEvent = {
            registry: 'hyperswarm',
            time: valid.signature!.signed,
            did: 'did:test:a',
            operation: valid,
        };

        const result = mapIndexExportOperationsToSyncRecords([{
            seq: 42,
            did: 'did:test:a',
            event,
            operationHash: valid.signature!.hash,
        }]);

        expect(result.records).toStrictEqual([
            {
                id: h('a'),
                syncOrder: 42,
                signedTs: Math.floor(Date.parse(valid.signature!.signed) / 1000),
                ts: Math.floor(Date.parse(valid.signature!.signed) / 1000),
                operation: valid,
            },
        ]);
        expect(result.invalid).toBe(0);
    });

    it('maps pre-MDIP signed timestamp to MDIP epoch seconds', () => {
        const legacyEpoch = makeCreateOp('a', '1971-01-01T00:00:00.000Z');
        const result = mapAcceptedOperationsToSyncRecords([legacyEpoch]);
        expect(result.records.length).toBe(1);
        expect(result.records[0].signedTs).toBe(MDIP_EPOCH_SECONDS);
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
        expect(filtered.knownIds).toStrictEqual([h('a')]);
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
        expect(filtered.knownIds).toStrictEqual([h('a')]);
        expect(filtered.mapped).toBe(3);
        expect(filtered.known).toBe(2);
        expect(filtered.invalid).toBe(0);
        expect(getByIds).toHaveBeenCalledTimes(1);
        expect(getByIds).toHaveBeenCalledWith([h('a'), h('b')]);
    });
});
