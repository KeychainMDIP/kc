import { Operation } from '@mdip/gatekeeper/types';
import {
    NEG_SYNC_ID_RE,
    buildOrderedCatchupCapabilities,
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    extractOperationHashes,
    normalizeNegentropyIds,
    normalizePeerCapabilities,
    parseRemoteWindow,
} from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';

const h = (c: string) => c.repeat(64);

function makeOp(hash: string): Operation {
    return {
        type: 'create',
        signature: {
            hash,
            signed: '2026-02-11T00:00:00.000Z',
            value: 'sig',
        },
    };
}

describe('negentropy protocol helpers', () => {
    it('encodes and decodes utf8 frame payloads', () => {
        const payload = encodeNegentropyFrame('frame-message');
        expect(payload.encoding).toBe('utf8');
        expect(decodeNegentropyFrame(payload)).toBe('frame-message');
    });

    it('encodes and decodes binary frame payloads', () => {
        const bytes = Uint8Array.from([1, 2, 3, 250]);
        const payload = encodeNegentropyFrame(bytes);
        expect(payload.encoding).toBe('base64');
        const decoded = decodeNegentropyFrame(payload);
        expect(Buffer.from(decoded as Uint8Array)).toStrictEqual(Buffer.from(bytes));
    });

    it('normalizes absent peer capabilities', () => {
        const unknown = normalizePeerCapabilities();
        expect(unknown).toStrictEqual({
            ordered: null,
            latestTs: null,
        });
    });

    it('normalizes ordered catch-up capability fields', () => {
        const capabilities = normalizePeerCapabilities({
            ordered: { count: 25, sourceReady: true },
        });

        expect(capabilities).toStrictEqual({
            ordered: { count: 25, sourceReady: true },
            latestTs: null,
        });
    });

    it('rejects incomplete or invalid ordered catch-up capabilities', () => {
        const capabilities = normalizePeerCapabilities({
            ordered: { count: -1, sourceReady: true },
        });

        expect(capabilities.ordered).toBeNull();
        expect(normalizePeerCapabilities({
            ordered: { count: 1, sourceReady: undefined as never },
        }).ordered).toBeNull();
    });

    it('normalizes the latest signed timestamp', () => {
        expect(normalizePeerCapabilities({ latestTs: 2_000 }).latestTs).toBe(2_000);

        for (const latestTs of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '2000']) {
            expect(normalizePeerCapabilities({
                latestTs: latestTs as number,
            }).latestTs).toBeNull();
        }
    });

    it('builds ordered catch-up readiness only when all operations are ordered', () => {
        expect(buildOrderedCatchupCapabilities({
            operationCount: 3,
            orderedOperationCount: 3,
        })).toStrictEqual({
            count: 3,
            sourceReady: true,
        });

        expect(buildOrderedCatchupCapabilities({
            operationCount: 3,
            orderedOperationCount: 2,
        })).toStrictEqual({
            count: 3,
            sourceReady: false,
        });

        expect(buildOrderedCatchupCapabilities({
            operationCount: 0,
            orderedOperationCount: 0,
        })).toStrictEqual({
            count: 0,
            sourceReady: false,
        });
    });

    it('normalizes negentropy ids and filters invalid values', () => {
        const a = h('a');
        const b = h('b');
        const ids = normalizeNegentropyIds([
            a.toUpperCase(),
            Buffer.from(b, 'hex'),
            'not-a-sync-id',
        ]);

        expect(ids).toStrictEqual([a, b]);
        expect(ids.every(id => NEG_SYNC_ID_RE.test(id))).toBe(true);
    });

    it('extracts unique valid operation hashes', () => {
        const a = h('a');
        const b = h('b');
        const operations: Operation[] = [
            makeOp(a.toUpperCase()),
            makeOp(b),
            makeOp('invalid'),
            { type: 'create' },
        ];

        const hashes = extractOperationHashes(operations);
        expect(hashes).toStrictEqual([a, b]);
    });

    it('rejects malformed remote reconciliation windows', () => {
        const window = {
            name: 'history_paged', fromTs: 1, toTs: 2, maxRecords: 16, order: 0,
        };
        const malformed = [
            null,
            { ...window, fromTs: Number.NaN },
            { ...window, toTs: Number.NaN },
            { ...window, fromTs: 3 },
            { ...window, order: 0.5 },
            { ...window, order: -1 },
            { ...window, after: { ts: 1.5, id: h('a') } },
            { ...window, after: { ts: 1, id: 'invalid' } },
        ];

        for (const candidate of malformed) {
            expect(parseRemoteWindow(candidate as never, 16)).toBeNull();
        }
    });
});
