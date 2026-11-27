import { readFileSync } from 'fs';
import path from 'path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import CipherNode from '@mdip/cipher/node';
import type { Operation } from '@mdip/gatekeeper/types';

import type { HyperMessage } from '../../services/mediators/hyperswarm/src/protocol-messages.ts';
import {
    validateHyperMessageEnvelope,
    validateHyperMessagePayload,
    validateOperationContentIds,
} from '../../services/mediators/hyperswarm/src/protocol-validation.ts';
import { mapOperationToSyncKey } from '../../services/mediators/hyperswarm/src/sync-mapping.ts';

interface IdentityVector {
    unsigned: Omit<Operation, 'signature'>;
    canonical: string;
    signature: NonNullable<Operation['signature']>;
    timestamp: number;
}

interface ConformanceFixture {
    wireVersion: number;
    operationIdentity: IdentityVector[];
    nativeEngine: {
        protocolByte: string;
        framesBase64: string[];
    };
    transcripts: Record<string, HyperMessage[]>;
    statefulRejections: Array<{
        reason: string;
        message: HyperMessage;
    }>;
}

interface NativeConformanceFixture {
    expectedFrames: string[];
}

const schema = JSON.parse(readFileSync(
    path.resolve('doc/01-protocol/hyperswarm-v2.schema.json'),
    'utf8',
)) as object;
const fixture = JSON.parse(readFileSync(
    path.resolve('tests/hyperswarm/fixtures/hyperswarm-v2-conformance.json'),
    'utf8',
)) as ConformanceFixture;
const nativeFixture = JSON.parse(readFileSync(
    path.resolve('tests/hyperswarm/fixtures/negentropy-native-conformance.json'),
    'utf8',
)) as NativeConformanceFixture;
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const cipher = new CipherNode();
const limits = {
    maxIdsPerRequest: 1_000,
    maxOpsPerPush: 300,
    maxBytesPerPush: 512 * 1024,
    maxRecordsPerWindow: 25_000,
};
const messages = Object.values(fixture.transcripts).flat();
const messageTypes: HyperMessage['type'][] = [
    'ping',
    'queue',
    'ordered_catchup_req',
    'ordered_catchup_push',
    'ordered_catchup_done',
    'neg_open',
    'neg_msg',
    'ops_offer',
    'ops_req',
    'ops_push',
    'ops_ack',
    'neg_close',
];

function representative(type: HyperMessage['type']): HyperMessage {
    const message = messages.find(candidate => candidate.type === type);
    if (!message) {
        throw new Error(`missing ${type} conformance message`);
    }
    return message;
}

function runtimeAccepts(message: unknown): boolean {
    const envelope = validateHyperMessageEnvelope(message);
    return envelope.ok && validateHyperMessagePayload(envelope.value, limits).ok;
}

describe('Hyperswarm v2 published wire contract', () => {
    it('reproduces operation IDs and timestamp mapping', () => {
        for (const vector of fixture.operationIdentity) {
            expect(cipher.canonicalizeJSON(vector.unsigned)).toBe(vector.canonical);
            expect(cipher.hashJSON(vector.unsigned)).toBe(vector.signature.hash);

            const operation = { ...vector.unsigned, signature: vector.signature } as Operation;
            const mapped = mapOperationToSyncKey(operation);
            expect(mapped).toMatchObject({
                ok: true,
                value: {
                    idHex: vector.signature.hash,
                    ts: vector.timestamp,
                },
            });
            expect(validateOperationContentIds([operation], cipher).ok).toBe(true);
        }
    });

    it('keeps deterministic native frames canonical and versioned', () => {
        expect(fixture.nativeEngine.protocolByte).toBe('61');
        expect(fixture.nativeEngine.framesBase64).toEqual(
            nativeFixture.expectedFrames.map(frame => Buffer.from(frame, 'hex').toString('base64')),
        );
        for (const encoded of fixture.nativeEngine.framesBase64) {
            const frame = Buffer.from(encoded, 'base64');
            expect(frame[0]).toBe(0x61);
            expect(frame.toString('base64')).toBe(encoded);
        }
    });

    it('validates every published transcript and all twelve message types', () => {
        expect(fixture.wireVersion).toBe(2);
        expect(new Set(messages.map(message => message.type))).toEqual(new Set(messageTypes));
        for (const message of messages) {
            expect(validateSchema(message)).toBe(true);
            expect(runtimeAccepts(message)).toBe(true);
        }
    });

    it.each(messageTypes)('rejects missing, unknown and mismatched %s fields', type => {
        const valid = representative(type) as unknown as Record<string, unknown>;
        const required = (schema as {
            $defs: Record<string, { properties: Record<string, { const?: string }>; required: string[] }>;
        }).$defs;
        const definition = Object.values(required).find(candidate => candidate.properties?.type?.const === type);
        expect(definition).toBeDefined();

        const missing = { ...valid };
        delete missing[definition!.required.find(field => field !== 'type')!];
        expect(validateSchema(missing)).toBe(false);
        expect(runtimeAccepts(missing)).toBe(false);

        const unknown = { ...valid, unexpected: true };
        expect(validateSchema(unknown)).toBe(false);
        expect(runtimeAccepts(unknown)).toBe(false);

        expect(validateSchema({ ...valid, type: 'not_a_message' })).toBe(false);
    });

    it('matches runtime empty-page and incomplete-marker boundaries', () => {
        const id = fixture.operationIdentity[0].signature.hash;
        const sessionId = 'boundary-session';
        const cases: Array<[unknown, boolean]> = [
            [{ type: 'ops_req', sessionId, transferId: 0, ids: [] }, true],
            [{ type: 'ops_offer', sessionId, transferId: 0, ids: [] }, false],
            [{ type: 'ops_push', sessionId, transferId: 0, page: 0, hasMore: false, operations: [] }, true],
            [{ type: 'ops_push', sessionId, transferId: 0, page: 0, hasMore: true, operations: [] }, false],
            [{
                type: 'ordered_catchup_push', sessionId,
                cursor: { syncOrder: 1, id }, hasMore: false, operations: [],
            }, false],
            [{ type: 'ops_req', sessionId, transferId: 0, ids: [id], incomplete: false }, false],
            [{ type: 'ops_ack', sessionId, transferId: 0, page: 0, incomplete: false }, false],
        ];

        for (const [message, accepted] of cases) {
            expect(validateSchema(message)).toBe(accepted);
            expect(runtimeAccepts(message)).toBe(accepted);
        }
    });

    it('matches close continuation and removed diagnostic boundaries', () => {
        const base = {
            type: 'neg_close', sessionId: 'close-session', windowSeq: 0, round: 0,
        };
        const cases: Array<[unknown, boolean]> = [
            [{ ...base, outcome: 'complete' }, false],
            [{ ...base, outcome: 'round_limit' }, false],
            [{ ...base, outcome: 'complete', continuation: null }, true],
            [{ ...base, outcome: 'round_limit', continuation: null }, true],
            [{ ...base, outcome: 'busy' }, true],
            [{ ...base, outcome: 'incomplete' }, true],
            [{ ...base, outcome: 'incomplete', detail: 'legacy diagnostic' }, false],
        ];

        for (const [message, accepted] of cases) {
            expect(validateSchema(message)).toBe(accepted);
            expect(runtimeAccepts(message)).toBe(accepted);
        }
    });

    it('separates structural validity from stateful authorization', () => {
        for (const rejection of fixture.statefulRejections.slice(0, 3)) {
            expect(validateSchema(rejection.message)).toBe(true);
            expect(runtimeAccepts(rejection.message)).toBe(true);
        }
        expect(validateSchema(fixture.statefulRejections[3].message)).toBe(false);
        expect(runtimeAccepts(fixture.statefulRejections[3].message)).toBe(false);
    });
});
