import CipherNode from '@mdip/cipher/node';
import type { Operation } from '@mdip/gatekeeper/types';

import {
    validateHyperMessageEnvelope,
    validateHyperMessagePayload,
    validateOperationContentIds,
    validateQueueMessagePayload,
} from '../../services/mediators/hyperswarm/src/protocol-validation.ts';
import type { QueueMessage } from '../../services/mediators/hyperswarm/src/protocol-messages.ts';

const limits = {
    maxIdsPerRequest: 2,
    maxOpsPerPush: 2,
    maxBytesPerPush: 4_096,
    maxFrameBytes: 8,
    maxRecordsPerWindow: 10,
};

const validDid = 'did:test:z3v8AuafbhTJJ8qqV5kEtfyd3c4NJm6jyUCpEkQrJU4YgdR6UFk';

function base(type: string) {
    return { type };
}

function operation(): { cipher: CipherNode; value: Operation } {
    const cipher = new CipherNode();
    const unsigned = {
        type: 'create' as const,
        created: '2026-08-01T12:00:00.000Z',
        mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
    };
    return {
        cipher,
        value: {
            ...unsigned,
            signature: {
                signed: unsigned.created,
                hash: cipher.hashJSON(unsigned),
                value: 'signature',
            },
        } as Operation,
    };
}

describe('hyperswarm protocol validation', () => {
    it('returns queue page metadata without weakening queue payload rules', () => {
        const { value } = operation();
        const message = {
            ...base('queue'),
            operations: [value],
        } as QueueMessage;
        const validated = validateQueueMessagePayload(message, limits);

        expect(validated).toEqual({
            ok: true,
            value: {
                operations: message.operations,
                bytes: Buffer.byteLength(JSON.stringify([value]), 'utf8'),
            },
        });
        expect(validateQueueMessagePayload({
            ...message,
            operations: 'invalid',
        } as unknown as QueueMessage, limits)).toMatchObject({
            ok: false,
            reason: 'operation page must be an array',
        });
        expect(validateQueueMessagePayload({
            ...message,
            operations: [value, value, value],
        }, limits)).toMatchObject({
            ok: false,
            reason: 'operation page exceeds 2 operations',
        });
        const deferred = { ...message, deferred: false } as unknown as QueueMessage;
        expect(validateQueueMessagePayload(deferred, limits)).toMatchObject({
            ok: false,
            reason: 'deferred is not valid for queue',
        });
        expect(validateHyperMessagePayload(deferred, limits)).toMatchObject({
            ok: false,
            reason: 'deferred is not valid for queue',
        });
    });

    it('accepts a bounded ping and rejects malformed optional fields', () => {
        const valid = { ...base('ping'), version: 2, peerDids: [validDid] };
        expect(validateHyperMessageEnvelope({ ...base('ping'), version: 2 }).ok).toBe(true);
        expect(validateHyperMessageEnvelope(valid).ok).toBe(true);
        expect(validateHyperMessageEnvelope({ ...valid, name: 'é'.repeat(129) })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({ ...valid, peerDids: 'invalid' })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({ ...valid, peerDids: ['not-a-did'] })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({ ...valid, ordered: [] })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...valid,
            ordered: { count: '1', sourceReady: true },
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...valid,
            ordered: { count: -1, sourceReady: false },
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...valid,
            ordered: { count: 1, sourceReady: true },
        }).ok).toBe(true);
        expect(validateHyperMessageEnvelope({
            ...valid,
            ordered: { count: 0, sourceReady: true },
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...valid,
            ordered: { count: 1, sourceReady: true, sourceReddy: true },
        })).toMatchObject({
            ok: false,
            reason: 'ordered contains unknown property sourceReddy',
        });
        expect(validateHyperMessageEnvelope({ ...valid, misspelled: true })).toMatchObject({
            ok: false,
            reason: 'ping contains unknown property misspelled',
        });
        expect(validateHyperMessageEnvelope({ ...valid, '': true })).toMatchObject({
            ok: false,
            reason: 'ping contains unknown property ',
        });
        expect(validateHyperMessageEnvelope({ ...valid, type: 'unknown' })).toMatchObject({ ok: false });
    });

    it('defers incompatible inbound pings to non-punitive version handling', () => {
        const future = {
            ...base('ping'),
            version: 3,
            ordered: 'future-shape',
            futureCapability: true,
        };

        expect(validateHyperMessageEnvelope(future, 2)).toMatchObject({ ok: true });
        expect(validateHyperMessageEnvelope(future)).toMatchObject({
            ok: false,
            reason: 'ping contains unknown property futureCapability',
        });
        expect(validateHyperMessageEnvelope({ type: 'ping' })).toMatchObject({
            ok: false,
            reason: 'version must be a safe integer >= 0',
        });
    });

    it('requires exact session field types without coercion', () => {
        expect(validateHyperMessageEnvelope({
            ...base('neg_close'), sessionId: 's', windowId: 'w', round: '0',
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ordered_catchup_push'), sessionId: 's', hasMore: 1, data: [],
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ops_req'), sessionId: '', windowId: 'w', round: 0, requestId: 0, ids: [],
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ops_req'), sessionId: 1, windowId: 'w', round: 0, requestId: 0, ids: [],
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, offerId: 0, ids: [],
        }).ok).toBe(true);
        for (const value of [
            {
                ...base('ops_offer'), sessionId: 's', windowId: 'w', round: 0,
                offerId: -1, ids: ['a'.repeat(64)],
            },
            {
                ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0,
                requestId: '0', ids: ['a'.repeat(64)],
            },
            {
                ...base('ops_push'), sessionId: 's', windowId: 'w', round: 0,
                requestId: 0, page: -1, hasMore: false, data: [],
            },
            { ...base('ops_ack'), sessionId: 's', windowId: 'w', round: 0, requestId: 0, page: -1 },
        ]) {
            expect(validateHyperMessageEnvelope(value)).toMatchObject({ ok: false });
        }
    });

    it('validates operation, ID, cursor, window, and frame payload bounds', () => {
        const { value } = operation();
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, page: 0, hasMore: false, data: [value],
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0, requestId: 0,
            ids: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_offer'), sessionId: 's', windowId: 'w', round: 0,
            offerId: 0, ids: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, ids: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, page: 0, hasMore: true, data: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, page: 0, hasMore: true,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, page: 0, hasMore: 1, data: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_offer'), sessionId: 's', windowId: 'w', round: 0,
            offerId: 0, ids: ['invalid'],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_offer'), sessionId: 's', windowId: 'w', round: 0,
            offerId: 0, ids: ['a'.repeat(64), 'A'.repeat(64)],
        } as never, limits)).toMatchObject({
            ok: false,
            reason: 'ID at index 1 must be 64 hexadecimal characters',
        });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, ids: ['a'.repeat(64), 'A'.repeat(64)],
        } as never, limits)).toMatchObject({
            ok: false,
            reason: 'ID at index 1 must be 64 hexadecimal characters',
        });
        expect(validateHyperMessagePayload({
            ...base('ops_offer'), sessionId: 's', windowId: 'w', round: 0,
            offerId: 0, ids: ['a'.repeat(64)], deferred: false,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, page: 0, hasMore: false, data: [], deferred: false,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, offerId: -1, ids: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, offerId: 0, ids: [], deferred: 'true',
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, ids: ['a'.repeat(64)], deferred: false,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_ack'), sessionId: 's', windowId: 'w', round: 0,
            requestId: 0, page: 0, deferred: 'true',
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's', cursor: { syncOrder: '1', id: 'a'.repeat(64) },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's', cursor: { syncOrder: 1, id: 'invalid' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's', cursor: 'invalid',
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's',
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_push'), sessionId: 's', hasMore: false, data: [value],
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('neg_open'), sessionId: 's', windowId: 'w', round: 0,
            window: { name: 'w', fromTs: 0, toTs: 1, order: 0, maxRecords: 11 },
            frame: { encoding: 'utf8', data: '' },
        } as never, limits)).toMatchObject({ ok: false });
        const validWindow = { name: 'w', fromTs: 0, toTs: 1, order: 0, maxRecords: 1 };
        expect(validateHyperMessagePayload({
            ...base('neg_open'), sessionId: 's', windowId: 'w', round: 0,
            window: validWindow, frame: { encoding: 'utf8', data: '' },
            previousWindowProgress: { cappedByRecords: 'true' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_open'), sessionId: 's', windowId: 'w', round: 0,
            window: validWindow, frame: { encoding: 'utf8', data: '' },
            previousWindowProgress: {
                cappedByRecords: true,
                lastCursor: { ts: 1, id: 'invalid' },
            },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_open'), sessionId: 's', windowId: 'w', round: 0,
            window: validWindow, frame: { encoding: 'utf8', data: '' },
            previousWindowProgress: {
                cappedByRecords: true,
                lastCursor: { ts: 1, id: 'a'.repeat(64) },
            },
        } as never, limits).ok).toBe(true);
        for (const window of [
            null,
            { ...validWindow, name: '' },
            { ...validWindow, fromTs: -1 },
            { ...validWindow, toTs: -1 },
            { ...validWindow, fromTs: 2 },
            { ...validWindow, order: -1 },
            { ...validWindow, after: 'invalid' },
        ]) {
            expect(validateHyperMessagePayload({
                ...base('neg_open'), sessionId: 's', windowId: 'w', round: 0,
                window, frame: { encoding: 'utf8', data: '' },
            } as never, limits)).toMatchObject({ ok: false });
        }
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowId: 'w', round: 0,
            frame: { encoding: 'base64', data: 'not-base64' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowId: 'w', round: 0,
            frame: { encoding: 'base64', data: 'AB==' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowId: 'w', round: 0,
            frame: { encoding: 'base64', data: Buffer.alloc(12).toString('base64') },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowId: 'w', round: 0,
            frame: { encoding: 'base64', data: Buffer.alloc(9).toString('base64') },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowId: 'w', round: 0,
            frame: { encoding: 'utf8', data: '123456789' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowId: 'w', round: 0,
            frame: null,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_close'), sessionId: 's', windowId: 'w', round: 0,
            windowProgress: { cappedByRecords: 'true' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_close'), sessionId: 's', windowId: 'w', round: 0,
            windowProgress: { cappedByRecords: true, lastCursor: 'invalid' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_close'), sessionId: 's', windowId: 'w', round: 0,
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('neg_close'), sessionId: 's', windowId: 'w', round: 0,
            windowProgress: {
                cappedByRecords: true,
                lastCursor: { ts: 1, id: 'a'.repeat(64) },
            },
        } as never, limits).ok).toBe(true);
    });

    it('rejects operations whose synchronization ID does not match their content', () => {
        const { cipher, value } = operation();
        expect(validateOperationContentIds([value], cipher).ok).toBe(true);
        const forged = {
            ...value,
            signature: { ...value.signature!, hash: 'f'.repeat(64) },
        };
        expect(validateOperationContentIds([forged], cipher)).toMatchObject({
            ok: false,
            reason: expect.stringContaining('content ID mismatch'),
        });
        expect(validateOperationContentIds([{ type: 'create' } as Operation], cipher)).toMatchObject({
            ok: false,
            reason: expect.stringContaining('signature is required'),
        });
    });
});
