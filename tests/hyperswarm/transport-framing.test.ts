import {
    decodeLegacyJsonMessages,
    decodeFramedMessages,
    DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
    encodeFramedMessage,
    FramedMessageParser,
    supportsLegacyRawTransportMessage,
} from '../../services/mediators/hyperswarm/src/transport-framing.ts';

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

    it('decodes multiple framed messages from one chunk', () => {
        const first = JSON.stringify({ type: 'neg_msg', frame: 'abc' });
        const second = JSON.stringify({ type: 'neg_close', reason: 'complete' });
        const framed = Buffer.concat([encodeFramedMessage(first), encodeFramedMessage(second)]);
        const decoded = decodeFramedMessages(framed);

        expect(decoded.error).toBeUndefined();
        expect(decoded.remaining.length).toBe(0);
        expect(decoded.messages.map(message => message.toString('utf8'))).toStrictEqual([first, second]);
    });

    it('identifies which message types remain legacy-transport compatible', () => {
        expect(supportsLegacyRawTransportMessage('ping')).toBe(true);
        expect(supportsLegacyRawTransportMessage('sync')).toBe(true);
        expect(supportsLegacyRawTransportMessage('batch')).toBe(true);
        expect(supportsLegacyRawTransportMessage('queue')).toBe(true);
        expect(supportsLegacyRawTransportMessage('neg_open')).toBe(false);
        expect(supportsLegacyRawTransportMessage('ops_push')).toBe(false);
    });

    it('decodes multiple legacy JSON messages from one chunk', () => {
        const first = JSON.stringify({ type: 'ping', node: 'node-a' });
        const second = JSON.stringify({ type: 'sync', node: 'node-b' });
        const decoded = decodeLegacyJsonMessages(Buffer.concat([
            Buffer.from(first, 'utf8'),
            Buffer.from(second, 'utf8'),
        ]));

        expect(decoded.error).toBeUndefined();
        expect(decoded.remaining.length).toBe(0);
        expect(decoded.messages.map(message => message.toString('utf8'))).toStrictEqual([first, second]);
    });

    it('buffers a legacy JSON message split across multiple chunks', () => {
        const json = JSON.stringify({
            type: 'ping',
            node: 'node-a',
            capabilities: {
                negentropy: true,
                negentropyVersion: 2,
            },
            transportFramingVersion: 1,
        });
        const encoded = Buffer.from(json, 'utf8');

        const first = decodeLegacyJsonMessages(encoded.subarray(0, 8), DEFAULT_MAX_FRAMED_MESSAGE_BYTES, 1);
        expect(first.error).toBeUndefined();
        expect(first.messages).toStrictEqual([]);

        const second = decodeLegacyJsonMessages(
            Buffer.concat([first.remaining, encoded.subarray(8)]),
            DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
            1,
        );
        expect(second.error).toBeUndefined();
        expect(second.messages).toHaveLength(1);
        expect(second.messages[0].toString('utf8')).toBe(json);
        expect(second.remaining.length).toBe(0);
    });

    it('supports upgrading from a raw ping to framed transport within the same chunk', () => {
        const ping = JSON.stringify({
            type: 'ping',
            node: 'node-a',
            transportFramingVersion: 1,
        });
        const negClose = JSON.stringify({
            type: 'neg_close',
            sessionId: 'session-1',
            windowId: 'window-1',
            round: 4,
            reason: 'complete',
        });
        const combined = Buffer.concat([
            Buffer.from(ping, 'utf8'),
            encodeFramedMessage(negClose),
        ]);

        const legacy = decodeLegacyJsonMessages(combined, DEFAULT_MAX_FRAMED_MESSAGE_BYTES, 1);
        expect(legacy.error).toBeUndefined();
        expect(legacy.messages.map(message => message.toString('utf8'))).toStrictEqual([ping]);

        const framed = decodeFramedMessages(legacy.remaining);
        expect(framed.error).toBeUndefined();
        expect(framed.messages.map(message => message.toString('utf8'))).toStrictEqual([negClose]);
        expect(framed.remaining.length).toBe(0);
    });

    it('buffers a message split across multiple chunks', () => {
        const parser = new FramedMessageParser();
        const json = JSON.stringify({ type: 'ops_push', data: [{ id: 'abc' }] });
        const framed = encodeFramedMessage(json);

        const first = parser.push(framed.subarray(0, 3));
        expect(first.error).toBeUndefined();
        expect(first.messages).toStrictEqual([]);

        const second = parser.push(framed.subarray(3, 11));
        expect(second.error).toBeUndefined();
        expect(second.messages).toStrictEqual([]);

        const third = parser.push(framed.subarray(11));
        expect(third.error).toBeUndefined();
        expect(third.messages).toHaveLength(1);
        expect(third.messages[0].toString('utf8')).toBe(json);
        expect(parser.pendingBytes).toBe(0);
    });

    it('preserves a partial trailing frame for the next chunk', () => {
        const parser = new FramedMessageParser();
        const first = JSON.stringify({ type: 'ping', node: 'a' });
        const second = JSON.stringify({ type: 'ping', node: 'b' });
        const framedFirst = encodeFramedMessage(first);
        const framedSecond = encodeFramedMessage(second);

        const partialChunk = Buffer.concat([framedFirst, framedSecond.subarray(0, 6)]);
        const initial = parser.push(partialChunk);
        expect(initial.error).toBeUndefined();
        expect(initial.messages.map(message => message.toString('utf8'))).toStrictEqual([first]);
        expect(parser.pendingBytes).toBe(6);

        const completed = parser.push(framedSecond.subarray(6));
        expect(completed.error).toBeUndefined();
        expect(completed.messages.map(message => message.toString('utf8'))).toStrictEqual([second]);
        expect(parser.pendingBytes).toBe(0);
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

    it('rejects an invalid legacy JSON prefix', () => {
        const invalid = Buffer.from('[1,2,3]', 'utf8');
        const decoded = decodeLegacyJsonMessages(invalid);

        expect(decoded.messages).toStrictEqual([]);
        expect(decoded.error).toBe(`invalid legacy JSON message prefix byte ${'['.charCodeAt(0)}`);
    });

    it('preserves back-to-back ops_push and neg_close as distinct messages', () => {
        const opsPush = JSON.stringify({
            type: 'ops_push',
            sessionId: 'session-1',
            windowId: 'window-1',
            round: 10,
            data: [{ signature: { hash: '00c8d13206871afdb0f93a4a91b14ca186a4b030b0dc53b7d726f265db89e54f' } }],
        });
        const negClose = JSON.stringify({
            type: 'neg_close',
            sessionId: 'session-1',
            windowId: 'window-1',
            round: 10,
            reason: 'complete',
        });
        const parser = new FramedMessageParser();

        const result = parser.push(Buffer.concat([encodeFramedMessage(opsPush), encodeFramedMessage(negClose)]));
        expect(result.error).toBeUndefined();
        expect(result.messages.map(message => JSON.parse(message.toString('utf8')).type)).toStrictEqual([
            'ops_push',
            'neg_close',
        ]);
    });

    it('decodes message boundaries correctly when multiple frames are split across chunks', () => {
        const parser = new FramedMessageParser();
        const payloads = [
            JSON.stringify({ type: 'neg_msg', round: 1, frame: 'a' }),
            JSON.stringify({ type: 'ops_req', round: 1, ids: ['x', 'y'] }),
            JSON.stringify({ type: 'neg_close', round: 1, reason: 'complete' }),
        ];
        const framed = Buffer.concat(payloads.map(payload => encodeFramedMessage(payload)));
        const chunkSizes = [5, 13, 7, framed.length];
        const decoded: string[] = [];
        let offset = 0;

        for (const size of chunkSizes) {
            if (offset >= framed.length) {
                break;
            }

            const chunk = framed.subarray(offset, Math.min(offset + size, framed.length));
            const result = parser.push(chunk);
            expect(result.error).toBeUndefined();
            decoded.push(...result.messages.map(message => message.toString('utf8')));
            offset += size;
        }

        expect(decoded).toStrictEqual(payloads);
        expect(parser.pendingBytes).toBe(0);
    });
});
