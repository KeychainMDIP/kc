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
    supportsPeerNegentropy,
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
    const currentNegentropyVersion = 1;

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

    it('normalizes peer capabilities and requires the exact Negentropy version', () => {
        const unknown = normalizePeerCapabilities();
        expect(unknown).toMatchObject({
            orderedCatchup: false,
            orderedCatchupVersion: null,
            orderedCatchupReady: false,
            operationCount: null,
            orderedOperationCount: null,
            latestSignedTimestamp: null,
        });
        expect(supportsPeerNegentropy(unknown, currentNegentropyVersion)).toBe(false);

        const negentropy = normalizePeerCapabilities({
            negentropyVersion: currentNegentropyVersion,
        });
        expect(supportsPeerNegentropy(negentropy, currentNegentropyVersion)).toBe(true);

        const missingVersion = normalizePeerCapabilities();
        expect(supportsPeerNegentropy(missingVersion, currentNegentropyVersion)).toBe(false);

        const futureVersion = normalizePeerCapabilities({ negentropyVersion: 2 });
        expect(supportsPeerNegentropy(futureVersion, currentNegentropyVersion)).toBe(false);
    });

    it('normalizes ordered catch-up capability fields', () => {
        const capabilities = normalizePeerCapabilities({
            negentropyVersion: currentNegentropyVersion,
            orderedCatchup: true,
            orderedCatchupVersion: 1,
            orderedCatchupReady: true,
            operationCount: 25,
            orderedOperationCount: 25,
        });

        expect(capabilities).toMatchObject({
            orderedCatchup: true,
            orderedCatchupVersion: 1,
            orderedCatchupReady: true,
            operationCount: 25,
            orderedOperationCount: 25,
        });
    });

    it('normalizes invalid ordered catch-up counts to null', () => {
        const capabilities = normalizePeerCapabilities({
            orderedCatchup: true,
            orderedCatchupVersion: Number.NaN,
            orderedCatchupReady: true,
            operationCount: -1,
            orderedOperationCount: 1.5,
        });

        expect(capabilities).toMatchObject({
            orderedCatchup: true,
            orderedCatchupVersion: null,
            orderedCatchupReady: true,
            operationCount: null,
            orderedOperationCount: null,
        });
    });

    it('normalizes the latest signed timestamp', () => {
        expect(normalizePeerCapabilities({ latestSignedTimestamp: 2_000 }).latestSignedTimestamp).toBe(2_000);

        for (const latestSignedTimestamp of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '2000']) {
            expect(normalizePeerCapabilities({
                latestSignedTimestamp: latestSignedTimestamp as number,
            }).latestSignedTimestamp).toBeNull();
        }
    });

    it('builds ordered catch-up readiness only when all operations are ordered', () => {
        expect(buildOrderedCatchupCapabilities({
            version: 1,
            operationCount: 3,
            orderedOperationCount: 3,
        })).toStrictEqual({
            orderedCatchup: true,
            orderedCatchupVersion: 1,
            orderedCatchupReady: true,
            operationCount: 3,
            orderedOperationCount: 3,
        });

        expect(buildOrderedCatchupCapabilities({
            version: 1,
            operationCount: 3,
            orderedOperationCount: 2,
        })).toMatchObject({
            orderedCatchupReady: false,
            operationCount: 3,
            orderedOperationCount: 2,
        });

        expect(buildOrderedCatchupCapabilities({
            version: 1,
            operationCount: 0,
            orderedOperationCount: 0,
        })).toMatchObject({
            orderedCatchupReady: false,
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
