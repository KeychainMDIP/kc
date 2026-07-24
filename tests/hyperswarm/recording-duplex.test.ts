import { encodeFramedMessage } from '../../services/mediators/hyperswarm/src/transport-framing.ts';
import {
    createRecordingDuplexPair,
    type RecordingDuplexPair,
} from './recording-duplex.ts';

describe('recording duplex', () => {
    let pair: RecordingDuplexPair | null = null;

    afterEach(async () => {
        await pair?.destroy();
        pair = null;
    });

    function createPair(receivedA: Buffer[], receivedB: Buffer[]): RecordingDuplexPair {
        return createRecordingDuplexPair({
            publicKeyA: Buffer.alloc(32, 0x11),
            publicKeyB: Buffer.alloc(32, 0x22),
            receiveAtA: async chunk => {
                receivedA.push(Buffer.from(chunk));
            },
            receiveAtB: async chunk => {
                receivedB.push(Buffer.from(chunk));
            },
        });
    }

    it('copies and records original writes before manually delivering them in FIFO order', async () => {
        const receivedA: Buffer[] = [];
        const receivedB: Buffer[] = [];
        pair = createPair(receivedA, receivedB);
        const writeA = Buffer.from(JSON.stringify({ type: 'ping', node: 'a' }));
        const expectedA = Buffer.from(writeA);
        const writeB = Buffer.from(JSON.stringify({ type: 'ping', node: 'b' }));

        pair.connectionA.write(writeA);
        pair.connectionB.write(writeB);
        writeA.fill(0);

        expect(receivedA).toHaveLength(0);
        expect(receivedB).toHaveLength(0);
        expect(pair.pendingCount).toBe(2);
        expect(pair.pendingAToB).toBe(1);
        expect(pair.pendingBToA).toBe(1);
        expect(pair.transcript.map(entry => [entry.sequence, entry.direction])).toStrictEqual([
            [1, 'a-to-b'],
            [2, 'b-to-a'],
        ]);
        expect(pair.transcript[0].raw).toStrictEqual(expectedA);
        expect(pair.transcript.every(entry => entry.transportMode === 'legacy')).toBe(true);

        await pair.deliverNext();
        expect(pair.pendingAToB).toBe(0);
        expect(pair.pendingBToA).toBe(1);
        await pair.deliverNext();

        expect(receivedB).toStrictEqual([expectedA]);
        expect(receivedA).toStrictEqual([writeB]);
        expect(pair.deliveries.map(entry => entry.action)).toStrictEqual(['intact', 'intact']);
    });

    it('delivers framed writes as fragments or one coalesced chunk without changing write boundaries', async () => {
        const receivedA: Buffer[] = [];
        const receivedB: Buffer[] = [];
        pair = createPair(receivedA, receivedB);
        const open = encodeFramedMessage(JSON.stringify({ type: 'neg_open' }));
        const push = encodeFramedMessage(JSON.stringify({ type: 'ops_push' }));
        const close = encodeFramedMessage(JSON.stringify({ type: 'neg_close' }));

        pair.connectionA.write(open);
        await pair.deliverNextFragmented([1, 4, 9]);
        expect(Buffer.concat(receivedB)).toStrictEqual(open);
        expect(pair.deliveries.map(entry => entry.action)).toStrictEqual([
            'fragmented',
            'fragmented',
            'fragmented',
            'fragmented',
        ]);

        receivedB.length = 0;
        pair.connectionA.write(push);
        pair.connectionA.write(close);
        await pair.deliverNextCoalesced(2);

        expect(receivedB).toStrictEqual([Buffer.concat([push, close])]);
        expect(pair.transcript.map(entry => entry.messageType)).toStrictEqual([
            'neg_open',
            'ops_push',
            'neg_close',
        ]);
        expect(pair.deliveries.at(-1)).toMatchObject({
            action: 'coalesced',
            messageTypes: ['ops_push', 'neg_close'],
            transportMode: 'framed',
            writeSequences: [2, 3],
        });
    });

    it('pauses after a selected message and supports delayed, duplicate, and dropped delivery', async () => {
        const receivedA: Buffer[] = [];
        const receivedB: Buffer[] = [];
        pair = createPair(receivedA, receivedB);
        const messages = ['neg_open', 'ops_push', 'neg_close', 'ops_req']
            .map(type => encodeFramedMessage(JSON.stringify({ type })));

        for (const message of messages.slice(0, 3)) {
            pair.connectionA.write(message);
        }
        expect(receivedB).toHaveLength(0);

        await expect(pair.pumpUntil({ afterMessageType: 'ops_push' })).resolves.toBe(true);
        expect(receivedB).toStrictEqual(messages.slice(0, 2));
        expect(pair.peekNext()?.messageType).toBe('neg_close');

        await pair.duplicateNext();
        expect(receivedB).toStrictEqual([...messages.slice(0, 2), messages[2], messages[2]]);

        pair.connectionA.write(messages[3]);
        expect(pair.dropNext()).toBe(true);
        expect(pair.pendingCount).toBe(0);
        expect(pair.deliveries.map(entry => entry.action)).toStrictEqual([
            'intact',
            'intact',
            'duplicated',
            'duplicated',
            'dropped',
        ]);
    });
});
