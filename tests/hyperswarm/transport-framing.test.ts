import {
    decodeFramedMessages,
    DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
    encodeFramedMessage,
} from '../../services/mediators/hyperswarm/src/transport-framing.ts';
import { MAX_NEGENTROPY_FRAME_BYTES } from '../../services/mediators/hyperswarm/src/protocol-limits.ts';

describe('hyperswarm transport framing', () => {
    it('encodes and decodes a single framed message', () => {
        const json = JSON.stringify({ type: 'ping', node: 'node-a' });
        const framed = encodeFramedMessage(json);
        const decoded = decodeFramedMessages(framed);

        expect(decoded.error).toBeUndefined();
        expect(decoded.remaining.length).toBe(0);
        expect(decoded.messages).toHaveLength(1);
        expect(decoded.messages[0].toString('utf8')).toBe(json);
    });

    it('encodes a Uint8Array payload and preserves the bytes', () => {
        const json = JSON.stringify({ type: 'ping', node: 'node-a' });
        const framed = encodeFramedMessage(new Uint8Array(Buffer.from(json, 'utf8')));
        const decoded = decodeFramedMessages(framed);

        expect(decoded.error).toBeUndefined();
        expect(decoded.remaining.length).toBe(0);
        expect(decoded.messages).toHaveLength(1);
        expect(decoded.messages[0].toString('utf8')).toBe(json);
    });

    it('rejects empty framed payloads and invalid framing limits', () => {
        expect(() => encodeFramedMessage('')).toThrow('framed message payload must not be empty');
        expect(() => encodeFramedMessage('x', 0)).toThrow('maxMessageBytes must be a positive integer');
        expect(() => encodeFramedMessage('toolong', 3)).toThrow('framed message payload exceeds max size of 3 bytes');
    });

    it('decodes multiple framed messages from one chunk', () => {
        const first = JSON.stringify({ type: 'neg_msg', continuation: null, frame: 'abc' });
        const second = JSON.stringify({ type: 'neg_close', reason: 'complete' });
        const framed = Buffer.concat([encodeFramedMessage(first), encodeFramedMessage(second)]);
        const decoded = decodeFramedMessages(framed);

        expect(decoded.error).toBeUndefined();
        expect(decoded.remaining.length).toBe(0);
        expect(decoded.messages.map(message => message.toString('utf8'))).toStrictEqual([first, second]);
    });

    it('rejects invalid framed decoder arguments', () => {
        expect(() => decodeFramedMessages('bad' as any)).toThrow('buffer must be a Buffer');
        expect(() => decodeFramedMessages(Buffer.alloc(0), 0)).toThrow('maxMessageBytes must be a positive integer');
    });

    it('buffers a message split across multiple chunks', () => {
        const json = JSON.stringify({ type: 'ops_push', operations: [{ id: 'abc' }] });
        const framed = encodeFramedMessage(json);

        const first = decodeFramedMessages(framed.subarray(0, 3));
        expect(first.error).toBeUndefined();
        expect(first.messages).toStrictEqual([]);

        const second = decodeFramedMessages(Buffer.concat([first.remaining, framed.subarray(3, 11)]));
        expect(second.error).toBeUndefined();
        expect(second.messages).toStrictEqual([]);

        const third = decodeFramedMessages(Buffer.concat([second.remaining, framed.subarray(11)]));
        expect(third.error).toBeUndefined();
        expect(third.messages).toHaveLength(1);
        expect(third.messages[0].toString('utf8')).toBe(json);
        expect(third.remaining.length).toBe(0);
    });

    it('preserves a partial trailing frame for the next chunk', () => {
        const first = JSON.stringify({ type: 'ping', node: 'a' });
        const second = JSON.stringify({ type: 'ping', node: 'b' });
        const framedFirst = encodeFramedMessage(first);
        const framedSecond = encodeFramedMessage(second);

        const partialChunk = Buffer.concat([framedFirst, framedSecond.subarray(0, 6)]);
        const initial = decodeFramedMessages(partialChunk);
        expect(initial.error).toBeUndefined();
        expect(initial.messages.map(message => message.toString('utf8'))).toStrictEqual([first]);
        expect(initial.remaining.length).toBe(6);

        const completed = decodeFramedMessages(Buffer.concat([initial.remaining, framedSecond.subarray(6)]));
        expect(completed.error).toBeUndefined();
        expect(completed.messages.map(message => message.toString('utf8'))).toStrictEqual([second]);
        expect(completed.remaining.length).toBe(0);
    });

    it('rejects an invalid zero-length frame', () => {
        const invalid = Buffer.alloc(4);
        const decoded = decodeFramedMessages(invalid);

        expect(decoded.messages).toStrictEqual([]);
        expect(decoded.error).toBe('invalid framed message length 0');
    });

    it('rejects an oversized frame', () => {
        const oversizedLength = DEFAULT_MAX_FRAMED_MESSAGE_BYTES + 1;
        const invalid = Buffer.alloc(4);
        invalid.writeUInt32BE(oversizedLength, 0);

        const decoded = decodeFramedMessages(invalid);
        expect(decoded.messages).toStrictEqual([]);
        expect(decoded.error).toBe(
            `framed message length ${oversizedLength} exceeds max ${DEFAULT_MAX_FRAMED_MESSAGE_BYTES}`
        );
    });

    it('fits a maximum native Negentropy frame inside the transport limit', () => {
        const message = JSON.stringify({
            type: 'neg_msg',
            sessionId: 'session-1',
            windowSeq: 0,
            round: 0,
            continuation: null,
            frame: Buffer.alloc(MAX_NEGENTROPY_FRAME_BYTES).toString('base64'),
        });

        expect(Buffer.byteLength(message)).toBeLessThan(DEFAULT_MAX_FRAMED_MESSAGE_BYTES);
        expect(() => encodeFramedMessage(message)).not.toThrow();
    });

    it('preserves back-to-back ops_push and neg_close as distinct messages', () => {
        const opsPush = JSON.stringify({
            type: 'ops_push',
            sessionId: 'session-1',
            operations: [{ signature: { hash: '00c8d13206871afdb0f93a4a91b14ca186a4b030b0dc53b7d726f265db89e54f' } }],
        });
        const negClose = JSON.stringify({
            type: 'neg_close',
            sessionId: 'session-1',
            windowSeq: 0,
            round: 10,
            reason: 'complete',
        });
        const result = decodeFramedMessages(Buffer.concat([encodeFramedMessage(opsPush), encodeFramedMessage(negClose)]));
        expect(result.error).toBeUndefined();
        expect(result.messages.map(message => JSON.parse(message.toString('utf8')).type)).toStrictEqual([
            'ops_push',
            'neg_close',
        ]);
        expect(result.remaining.length).toBe(0);
    });
});
