import CipherNode from '@mdip/cipher/node';
import type { Operation } from '@mdip/gatekeeper/types';

import {
    validateHyperMessageEnvelope,
    validateHyperMessagePayload,
    validateOperationContentIds,
    validateQueueMessagePayload,
} from '../../services/mediators/hyperswarm/src/protocol-validation.ts';
import {
    NEG_CLOSE_OUTCOMES,
    type QueueMessage,
} from '../../services/mediators/hyperswarm/src/protocol-messages.ts';
import { MAX_NEGENTROPY_FRAME_BYTES } from '../../services/mediators/hyperswarm/src/protocol-limits.ts';
import { MDIP_EPOCH_SECONDS } from '../../services/mediators/hyperswarm/src/negentropy/windows.ts';

const limits = {
    maxIdsPerRequest: 2,
    maxOpsPerPush: 2,
    maxBytesPerPush: 4_096,
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
        const incomplete = { ...message, incomplete: true } as unknown as QueueMessage;
        expect(validateHyperMessageEnvelope(incomplete)).toMatchObject({
            ok: false,
            reason: 'queue contains unknown property incomplete',
        });
    });

    it('accepts a bounded ping and rejects malformed optional fields', () => {
        const valid = { ...base('ping'), version: 2, peerDids: [validDid] };
        expect(validateHyperMessageEnvelope({ ...base('ping'), version: 2 }).ok).toBe(true);
        expect(validateHyperMessageEnvelope(valid).ok).toBe(true);
        expect(validateHyperMessageEnvelope({ ...valid, name: 'é'.repeat(129) })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({ ...valid, version: 1 })).toMatchObject({
            ok: false,
            reason: 'version must be 2',
        });
        expect(validateHyperMessageEnvelope({ ...valid, latestTs: -1 })).toMatchObject({
            ok: false,
            reason: 'latestTs must be a safe integer >= 0',
        });
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
            ordered: { count: 1, sourceReady: 'true' },
        })).toMatchObject({
            ok: false,
            reason: 'ordered.sourceReady must be a boolean',
        });
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
            ...base('neg_close'), sessionId: 's', windowSeq: 'w', round: '0',
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ordered_catchup_push'), sessionId: 's', hasMore: 1, operations: [],
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ops_req'), sessionId: '', transferId: 0, ids: [],
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ops_req'), sessionId: 1, transferId: 0, ids: [],
        })).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ops_req'), sessionId: 's', transferId: 0, ids: [],
        }).ok).toBe(true);
        for (const value of [
            {
                ...base('ops_offer'), sessionId: 's',
                transferId: -1, ids: ['a'.repeat(64)],
            },
            {
                ...base('ops_req'), sessionId: 's',
                transferId: '0', ids: ['a'.repeat(64)],
            },
            {
                ...base('ops_push'), sessionId: 's', transferId: 0,
                page: -1, hasMore: false, operations: [],
            },
            { ...base('ops_ack'), sessionId: 's', transferId: 0, page: -1 },
        ]) {
            expect(validateHyperMessageEnvelope(value)).toMatchObject({ ok: false });
        }
    });

    it('requires a stable close outcome and rejects removed close fields', () => {
        for (const outcome of NEG_CLOSE_OUTCOMES) {
            expect(validateHyperMessageEnvelope({
                ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0, outcome,
            }).ok).toBe(true);
        }
        expect(validateHyperMessageEnvelope({
            ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0,
        })).toMatchObject({ ok: false, reason: expect.stringContaining('outcome must be one of') });
        expect(validateHyperMessageEnvelope({
            ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0, outcome: 'unknown',
        })).toMatchObject({ ok: false, reason: expect.stringContaining('outcome must be one of') });
        expect(validateHyperMessageEnvelope({
            ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0,
            outcome: 'complete', reason: 'complete',
        })).toMatchObject({ ok: false, reason: 'neg_close contains unknown property reason' });
        expect(validateHyperMessageEnvelope({
            ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0,
            outcome: 'incomplete', detail: 'local-only reason',
        })).toMatchObject({
            ok: false,
            reason: 'neg_close contains unknown property detail',
        });
        expect(validateHyperMessageEnvelope({
            ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0,
            outcome: 'failed',
        })).toMatchObject({ ok: false, reason: expect.stringContaining('outcome must be one of') });
    });

    it('validates operation, ID, cursor, window, and frame payload bounds', () => {
        const { value } = operation();
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', transferId: 0,
            page: 0, hasMore: false, operations: [value],
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', transferId: 0,
            ids: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_offer'), sessionId: 's',
            transferId: 0, ids: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's',
            transferId: 0, ids: [],
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', transferId: 0,
            page: 0, hasMore: true, operations: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's',
            transferId: 0, page: 0, hasMore: true,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_push'), sessionId: 's', transferId: 0,
            page: 0, hasMore: 1, operations: [],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_offer'), sessionId: 's',
            transferId: 0, ids: ['invalid'],
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_offer'), sessionId: 's',
            transferId: 0, ids: ['a'.repeat(64), 'A'.repeat(64)],
        } as never, limits)).toMatchObject({
            ok: false,
            reason: 'ID at index 1 must be 64 hexadecimal characters',
        });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's',
            transferId: 0, ids: ['a'.repeat(64), 'A'.repeat(64)],
        } as never, limits)).toMatchObject({
            ok: false,
            reason: 'ID at index 1 must be 64 hexadecimal characters',
        });
        for (const type of ['ops_offer', 'ops_req'] as const) {
            expect(validateHyperMessagePayload({
                type, sessionId: 's', transferId: 0,
                ids: ['a'.repeat(64), 'a'.repeat(64)],
            }, limits)).toMatchObject({
                ok: false,
                reason: `${type} ids must be unique`,
            });
        }
        expect(validateHyperMessageEnvelope({
            ...base('ops_req'), sessionId: 's', transferId: -1, ids: [],
        })).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', transferId: 0, ids: [], incomplete: true,
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', transferId: 0, ids: [], incomplete: 'true',
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_req'), sessionId: 's', transferId: 0,
            ids: ['a'.repeat(64)], incomplete: false,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ops_ack'), sessionId: 's', transferId: 0, page: 0, incomplete: 'true',
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessageEnvelope({
            ...base('ops_push'), sessionId: 's', transferId: 0, page: 0,
            hasMore: false, operations: [], windowSeq: 0,
        })).toMatchObject({
            ok: false,
            reason: 'ops_push contains unknown property windowSeq',
        });
        expect(validateHyperMessageEnvelope({
            ...base('ops_offer'), sessionId: 's', transferId: 0,
            ids: ['a'.repeat(64)], round: 0,
        })).toMatchObject({
            ok: false,
            reason: 'ops_offer contains unknown property round',
        });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's', after: { syncOrder: '1', id: 'a'.repeat(64) },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's', after: { syncOrder: 1, id: 'invalid' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's', after: 'invalid',
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_req'), sessionId: 's',
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessageEnvelope({
            ...base('ordered_catchup_req'), sessionId: 's',
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
        })).toMatchObject({
            ok: false,
            reason: 'ordered_catchup_req contains unknown property cursor',
        });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_push'), sessionId: 's', hasMore: false, operations: [value],
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessageEnvelope({
            ...base('ordered_catchup_push'), sessionId: 's', hasMore: false, data: [value],
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
        })).toMatchObject({
            ok: false,
            reason: 'ordered_catchup_push contains unknown property data',
        });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_push'), sessionId: 's', hasMore: false, operations: [value],
        } as never, limits)).toMatchObject({ ok: false, reason: 'cursor is required' });
        expect(validateHyperMessagePayload({
            ...base('ordered_catchup_push'), sessionId: 's', hasMore: false, operations: [],
            cursor: { syncOrder: 1, id: 'a'.repeat(64) },
        } as never, limits)).toMatchObject({
            ok: false,
            reason: 'ordered_catchup_push operations must not be empty',
        });
        const validFrame = Buffer.from([0]).toString('base64');
        const validWindow = { until: MDIP_EPOCH_SECONDS + 1, limit: 1 };
        expect(validateHyperMessagePayload({
            ...base('neg_open'), sessionId: 's', windowSeq: 0, round: 0,
            window: { ...validWindow, limit: 11 }, frame: validFrame,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_open'), sessionId: 's', windowSeq: 1, round: 0,
            window: validWindow, frame: validFrame,
            previousContinuation: { ts: 1, id: 'invalid' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_open'), sessionId: 's', windowSeq: 1, round: 0,
            window: validWindow, frame: validFrame,
            previousContinuation: { ts: 1, id: 'a'.repeat(64) },
        } as never, limits).ok).toBe(true);
        for (const window of [
            null,
            { ...validWindow, until: MDIP_EPOCH_SECONDS - 1 },
            { ...validWindow, limit: 0 },
            { ...validWindow, name: 'history_paged' },
            { ...validWindow, after: 'invalid' },
        ]) {
            expect(validateHyperMessagePayload({
                ...base('neg_open'), sessionId: 's', windowSeq: 0, round: 0,
                window, frame: validFrame,
            } as never, limits)).toMatchObject({ ok: false });
        }
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: 'not-base64', continuation: null,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: 'AB==', continuation: null,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: Buffer.alloc(MAX_NEGENTROPY_FRAME_BYTES).toString('base64'), continuation: null,
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: Buffer.alloc(MAX_NEGENTROPY_FRAME_BYTES + 1).toString('base64'), continuation: null,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: validFrame,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: validFrame, continuation: 'invalid',
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: validFrame, continuation: { ts: 1, id: 'invalid' },
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_msg'), sessionId: 's', windowSeq: 0, round: 0,
            frame: null, continuation: null,
        } as never, limits)).toMatchObject({ ok: false });
        expect(validateHyperMessagePayload({
            ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0,
            outcome: 'complete',
        } as never, limits).ok).toBe(true);
        expect(validateHyperMessagePayload({
            ...base('neg_close'), sessionId: 's', windowSeq: 0, round: 0,
            outcome: 'complete',
            continuation: { ts: 1, id: 'a'.repeat(64) },
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
