import { Operation } from '@mdip/gatekeeper/types';
import type { SyncOperationRecord } from '../../services/mediators/hyperswarm/src/db/types.ts';
import {
    normalizeInboundOpsPushBatch,
    orderSyncRecordsForPush,
} from '../../services/mediators/hyperswarm/src/operation-order.ts';

const h = (c: string) => c.repeat(64);

function makeOp(hashChar: string, signed: string): Operation {
    return {
        type: 'create',
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

function makeRecord(
    hashChar: string,
    signedTs: number,
    syncOrder?: number,
): SyncOperationRecord {
    return {
        id: h(hashChar),
        syncOrder,
        signedTs,
        ts: signedTs,
        operation: makeOp(hashChar, new Date(signedTs * 1000).toISOString()),
        insertedAt: 1,
    };
}

describe('negentropy operation ordering', () => {
    it('orders requested operation records by sync order', () => {
        const laterSignedEarlierAccepted = makeRecord('a', 300, 30);
        const earlierSignedLaterAccepted = makeRecord('b', 100, 10);
        const middle = makeRecord('c', 200, 20);

        const ordered = orderSyncRecordsForPush([
            laterSignedEarlierAccepted,
            earlierSignedLaterAccepted,
            middle,
        ]);

        expect(ordered.map(record => record.id)).toStrictEqual([
            h('b'),
            h('c'),
            h('a'),
        ]);
    });

    it('falls back to signed timestamp and id for legacy records without sync order', () => {
        const sameTimeHigherId = makeRecord('f', 100);
        const later = makeRecord('a', 200);
        const sameTimeLowerId = makeRecord('b', 100);

        const ordered = orderSyncRecordsForPush([sameTimeHigherId, later, sameTimeLowerId]);

        expect(ordered.map(record => record.id)).toStrictEqual([
            h('b'),
            h('f'),
            h('a'),
        ]);
    });

    it('falls back to signed timestamp when comparing mixed ordered and legacy records', () => {
        const orderedNewer = makeRecord('a', 300, 1);
        const legacyOlder = makeRecord('b', 100);

        const ordered = orderSyncRecordsForPush([orderedNewer, legacyOlder]);

        expect(ordered.map(record => record.id)).toStrictEqual([
            h('b'),
            h('a'),
        ]);
    });

    it('preserves inbound ops_push order while removing duplicate operation hashes', () => {
        const first = makeOp('c', '2026-02-10T12:00:00.000Z');
        const second = makeOp('a', '2026-02-10T10:00:00.000Z');
        const third = makeOp('b', '2026-02-10T11:00:00.000Z');
        const duplicateFirst = {
            ...first,
            signature: {
                ...first.signature!,
                value: 'sig-c-duplicate',
            },
        };

        const batch = normalizeInboundOpsPushBatch([first, second, duplicateFirst, third]);

        expect(batch).toStrictEqual([first, second, third]);
    });

    it('returns an empty inbound batch for non-array data', () => {
        expect(normalizeInboundOpsPushBatch({ data: [] })).toStrictEqual([]);
    });
});
