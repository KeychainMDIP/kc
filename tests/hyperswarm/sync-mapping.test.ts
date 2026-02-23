import { Operation } from '@mdip/gatekeeper/types';
import {
    MDIP_EPOCH_SECONDS,
    SYNC_ID_BYTES_LEN,
    mapOperationToSyncKey,
    type SyncMappingErrorCode,
} from '../../services/mediators/hyperswarm/src/sync-mapping.ts';

const h = (c: string) => c.repeat(64);

function makeOp(overrides: Partial<NonNullable<Operation['signature']>> = {}): Operation {
    return {
        type: 'create',
        signature: {
            hash: h('a'),
            signed: '2026-02-13T00:00:00.000Z',
            value: 'sig-a',
            ...overrides,
        },
    };
}

function expectFailure(operation: Operation, code: SyncMappingErrorCode): void {
    const result = mapOperationToSyncKey(operation);
    expect(result.ok).toBe(false);
    if (!result.ok) {
        expect(result.code).toBe(code);
    }
}

describe('sync-mapping', () => {
    it('maps valid operation to sync key and normalizes hash case', () => {
        const op = makeOp({ hash: h('A') });
        const result = mapOperationToSyncKey(op);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.idHex).toBe(h('a'));
            expect(result.value.idBytes.length).toBe(SYNC_ID_BYTES_LEN);
            expect(result.value.tsSec).toBe(Math.floor(Date.parse('2026-02-13T00:00:00.000Z') / 1000));
            expect(result.value.operation).toBe(op);
        }
    });

    it('remaps unix epoch signed timestamp to MDIP epoch', () => {
        const op = makeOp({ signed: '1970-01-01T00:00:00.000Z' });
        const result = mapOperationToSyncKey(op);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.tsSec).toBe(MDIP_EPOCH_SECONDS);
        }
    });

    it('rejects missing signature', () => {
        expectFailure({ type: 'create' }, 'missing_signature');
    });

    it('rejects missing signature hash', () => {
        expectFailure(makeOp({ hash: '' }), 'missing_signature_hash');
    });

    it('rejects non-string signature hash', () => {
        expectFailure(makeOp({ hash: 123 as unknown as string }), 'invalid_signature_hash_type');
    });

    it('rejects invalid signature hash format', () => {
        expectFailure(makeOp({ hash: 'xyz' }), 'invalid_signature_hash_format');
    });

    it('rejects missing signature signed', () => {
        expectFailure(makeOp({ signed: '' }), 'missing_signature_signed');
    });

    it('rejects non-string signature signed', () => {
        expectFailure(makeOp({ signed: 123 as unknown as string }), 'invalid_signature_signed_type');
    });

    it('rejects unparseable signature signed value', () => {
        expectFailure(makeOp({ signed: 'not-a-date' }), 'invalid_signature_signed_value');
    });
});
