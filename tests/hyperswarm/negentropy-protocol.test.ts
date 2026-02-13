import { Operation } from '@mdip/gatekeeper/types';
import {
    NEG_SYNC_ID_RE,
    chooseConnectSyncMode,
    chooseSyncMode,
    decodeNegentropyFrame,
    encodeNegentropyFrame,
    extractOperationHashes,
    normalizeNegentropyIds,
    normalizePeerCapabilities,
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

    it('normalizes peer capabilities and chooses sync mode', () => {
        const unknown = normalizePeerCapabilities();
        expect(chooseSyncMode(unknown, 1)).toBeNull();

        const legacy = normalizePeerCapabilities({ negentropy: false });
        expect(chooseSyncMode(legacy, 1)).toBe('legacy');

        const negentropy = normalizePeerCapabilities({ negentropy: true, negentropyVersion: 1 });
        expect(chooseSyncMode(negentropy, 1)).toBe('negentropy');

        const oldVersion = normalizePeerCapabilities({ negentropy: true, negentropyVersion: 0 });
        expect(chooseSyncMode(oldVersion, 1)).toBe('legacy');
    });

    it('chooses connect sync mode with explicit fallback reasons', () => {
        const missing = normalizePeerCapabilities();
        expect(chooseConnectSyncMode(missing, 1, true)).toStrictEqual({
            mode: 'legacy',
            reason: 'missing_capabilities',
        });
        expect(chooseConnectSyncMode(missing, 1, false)).toStrictEqual({
            mode: null,
            reason: 'legacy_disabled',
        });

        const disabled = normalizePeerCapabilities({ negentropy: false, negentropyVersion: 1 });
        expect(chooseConnectSyncMode(disabled, 1, true)).toStrictEqual({
            mode: 'legacy',
            reason: 'negentropy_disabled',
        });

        const oldVersion = normalizePeerCapabilities({ negentropy: true, negentropyVersion: 0 });
        expect(chooseConnectSyncMode(oldVersion, 1, true)).toStrictEqual({
            mode: 'legacy',
            reason: 'version_mismatch',
        });

        const supported = normalizePeerCapabilities({ negentropy: true, negentropyVersion: 1 });
        expect(chooseConnectSyncMode(supported, 1, true)).toStrictEqual({
            mode: 'negentropy',
            reason: 'negentropy_supported',
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
});
