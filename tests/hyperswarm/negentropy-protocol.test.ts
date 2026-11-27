import {
    NEG_SYNC_ID_RE,
    buildOrderedCatchupCapabilities,
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    normalizeNegentropyIds,
    normalizePeerCapabilities,
    parseRemoteWindow,
} from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import { MDIP_EPOCH_SECONDS } from '../../services/mediators/hyperswarm/src/sync-mapping.ts';

const h = (c: string) => c.repeat(64);
const nativeFrame = (value: string): Uint8Array => Buffer.from(value);

describe('negentropy protocol helpers', () => {
    it('encodes native frames as canonical base64', () => {
        const payload = encodeNegentropyFrame(nativeFrame('frame-message'));
        expect(payload).toBe(Buffer.from('frame-message').toString('base64'));
        expect(Buffer.from(decodeNegentropyFrame(payload))).toStrictEqual(Buffer.from('frame-message'));
    });

    it('encodes and decodes binary frame payloads', () => {
        const bytes = Uint8Array.from([1, 2, 3, 250]);
        const payload = encodeNegentropyFrame(bytes);
        const decoded = decodeNegentropyFrame(payload);
        expect(Buffer.from(decoded)).toStrictEqual(Buffer.from(bytes));
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

    it('rejects malformed remote reconciliation windows', () => {
        const window = {
            until: MDIP_EPOCH_SECONDS + 2, limit: 16,
        };
        const malformed = [
            null,
            { ...window, until: Number.NaN },
            { ...window, limit: Number.NaN },
            { ...window, until: MDIP_EPOCH_SECONDS - 1 },
            { ...window, limit: 25_001 },
            { ...window, extra: true },
            { ...window, after: { ts: 1.5, id: h('a') } },
            { ...window, after: { ts: 1, id: null } },
            { ...window, after: { ts: 1, id: 'invalid' } },
        ];

        for (const candidate of malformed) {
            expect(parseRemoteWindow(candidate as never, 0)).toBeNull();
        }
        expect(parseRemoteWindow(window, 3)).toStrictEqual({
            name: 'history_paged',
            fromTs: MDIP_EPOCH_SECONDS,
            toTs: window.until,
            maxRecords: 16,
            order: 3,
        });
    });
});
