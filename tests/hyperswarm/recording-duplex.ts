import { Duplex } from 'node:stream';

import { decodeUnknownTransportMessages } from '../../services/mediators/hyperswarm/src/transport-framing.ts';

export type TransportDirection = 'a-to-b' | 'b-to-a';
export type DeliveryAction = 'intact' | 'fragmented' | 'coalesced' | 'duplicated' | 'dropped';

interface DecodedTrace {
    framed: boolean;
    messageType: string | null;
    messageTypes: string[];
    transportMode: 'legacy' | 'framed' | null;
    decodeError?: string;
    remainingBytes: number;
}

export interface RecordedTransportWrite extends DecodedTrace {
    sequence: number;
    direction: TransportDirection;
    raw: Buffer;
}

export interface RecordedTransportDelivery extends DecodedTrace {
    sequence: number;
    writeSequences: number[];
    direction: TransportDirection;
    action: DeliveryAction;
    raw: Buffer;
    copyIndex?: number;
    fragmentIndex?: number;
}

export interface RecordingDuplexPairOptions {
    publicKeyA: Buffer;
    publicKeyB: Buffer;
    receiveAtA(chunk: Buffer): Promise<void>;
    receiveAtB(chunk: Buffer): Promise<void>;
}

export interface PumpUntilOptions {
    afterMessageType: string;
    direction?: TransportDirection;
}

function decodeTrace(raw: Buffer): DecodedTrace {
    const decoded = decodeUnknownTransportMessages(raw);
    const messageTypes = decoded.messages.flatMap(message => {
        try {
            const parsed = JSON.parse(message.toString('utf8')) as { type?: unknown };
            return typeof parsed.type === 'string' ? [parsed.type] : [];
        }
        catch {
            return [];
        }
    });

    return {
        framed: decoded.transportMode === 'framed',
        messageType: messageTypes.length === 1 ? messageTypes[0] : null,
        messageTypes,
        transportMode: decoded.transportMode,
        decodeError: decoded.error,
        remainingBytes: decoded.remaining.length,
    };
}

class RecordingDuplex extends Duplex {
    readonly remotePublicKey: Buffer;

    constructor(remotePublicKey: Buffer, private readonly recordWrite: (raw: Buffer) => void) {
        super();
        this.remotePublicKey = Buffer.from(remotePublicKey);
    }

    _read(): void {
        // Delivery is controlled by RecordingDuplexPair.
    }

    _write(chunk: Buffer | string | Uint8Array, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        try {
            const raw = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
            this.recordWrite(raw);
            callback();
        }
        catch (error) {
            callback(error as Error);
        }
    }

    deliver(raw: Buffer): void {
        if (this.destroyed) {
            throw new Error('cannot deliver to a destroyed recording duplex');
        }
        this.push(Buffer.from(raw));
    }
}

export class RecordingDuplexPair {
    readonly connectionA: RecordingDuplex;
    readonly connectionB: RecordingDuplex;
    readonly transcript: RecordedTransportWrite[] = [];
    readonly deliveries: RecordedTransportDelivery[] = [];
    private readonly pending: RecordedTransportWrite[] = [];
    private receiveChainA = Promise.resolve();
    private receiveChainB = Promise.resolve();
    private receiveErrorA: unknown;
    private receiveErrorB: unknown;
    private pendingInboundA = 0;
    private pendingInboundB = 0;
    private writeSequence = 0;
    private deliverySequence = 0;
    private isDestroyed = false;

    constructor(private readonly options: RecordingDuplexPairOptions) {
        this.connectionA = new RecordingDuplex(options.publicKeyB, raw => this.recordWrite('a-to-b', raw));
        this.connectionB = new RecordingDuplex(options.publicKeyA, raw => this.recordWrite('b-to-a', raw));
        this.connectionA.on('data', chunk => this.queueReceive('a', Buffer.from(chunk)));
        this.connectionB.on('data', chunk => this.queueReceive('b', Buffer.from(chunk)));
    }

    get pendingCount(): number {
        return this.pending.length;
    }

    get pendingInboundCount(): number {
        return this.pendingInboundA + this.pendingInboundB;
    }

    get deliveryVersion(): number {
        return this.deliveries.length;
    }

    peekNext(): RecordedTransportWrite | null {
        const next = this.pending[0];
        return next ? this.cloneWrite(next) : null;
    }

    async deliverNext(): Promise<boolean> {
        const next = this.pending.shift();
        if (!next) {
            return false;
        }
        await this.deliverBuffer(next.direction, next.raw, 'intact', [next.sequence]);
        return true;
    }

    async deliverNextFragmented(splitOffsets: number[]): Promise<boolean> {
        const next = this.pending[0];
        if (!next) {
            return false;
        }
        const offsets = Array.from(new Set(splitOffsets)).sort((a, b) => a - b);
        if (offsets.length === 0
            || offsets.some(offset => !Number.isInteger(offset) || offset <= 0 || offset >= next.raw.length)) {
            throw new Error('fragment split offsets must be unique integers inside the next write');
        }

        this.pending.shift();
        const boundaries = [0, ...offsets, next.raw.length];
        for (let index = 0; index < boundaries.length - 1; index += 1) {
            const fragment = next.raw.subarray(boundaries[index], boundaries[index + 1]);
            await this.deliverBuffer(next.direction, fragment, 'fragmented', [next.sequence], {
                fragmentIndex: index,
            });
        }
        return true;
    }

    async deliverNextCoalesced(count: number): Promise<boolean> {
        if (!Number.isInteger(count) || count < 2) {
            throw new Error('coalesced delivery count must be at least 2');
        }
        if (this.pending.length === 0) {
            return false;
        }
        if (this.pending.length < count) {
            throw new Error(`cannot coalesce ${count} writes with only ${this.pending.length} pending`);
        }

        const entries = this.pending.slice(0, count);
        const direction = entries[0].direction;
        if (entries.some(entry => entry.direction !== direction)) {
            throw new Error('coalesced writes must have the same direction');
        }

        this.pending.splice(0, count);
        await this.deliverBuffer(
            direction,
            Buffer.concat(entries.map(entry => entry.raw)),
            'coalesced',
            entries.map(entry => entry.sequence),
        );
        return true;
    }

    async duplicateNext(copies = 2): Promise<boolean> {
        if (!Number.isInteger(copies) || copies < 2) {
            throw new Error('duplicate delivery copies must be at least 2');
        }
        const next = this.pending.shift();
        if (!next) {
            return false;
        }

        for (let index = 0; index < copies; index += 1) {
            await this.deliverBuffer(next.direction, next.raw, 'duplicated', [next.sequence], {
                copyIndex: index,
            });
        }
        return true;
    }

    dropNext(): boolean {
        const next = this.pending.shift();
        if (!next) {
            return false;
        }
        this.recordDelivery(next.direction, next.raw, 'dropped', [next.sequence]);
        return true;
    }

    async pumpUntilIdle(): Promise<void> {
        while (await this.deliverNext()) {
            // Responses are appended to the same FIFO by delivery.
        }
        await this.idle();
    }

    async pumpUntil(options: PumpUntilOptions): Promise<boolean> {
        while (this.pending.length > 0) {
            const next = this.pending[0];
            const matches = next.messageTypes.includes(options.afterMessageType)
                && (!options.direction || next.direction === options.direction);
            await this.deliverNext();
            if (matches) {
                return true;
            }
        }
        return false;
    }

    async idle(): Promise<void> {
        await Promise.all([this.receiveChainA, this.receiveChainB]);
        const errors = [this.receiveErrorA, this.receiveErrorB].filter(error => error !== undefined);
        if (errors.length === 1) {
            throw errors[0];
        }
        if (errors.length > 1) {
            throw new AggregateError(errors, 'recording duplex receive failed');
        }
    }

    async destroy(): Promise<void> {
        if (this.isDestroyed) {
            return;
        }
        this.isDestroyed = true;
        try {
            await this.idle();
        }
        finally {
            this.connectionA.removeAllListeners('data');
            this.connectionB.removeAllListeners('data');
            this.connectionB.destroy();
            this.connectionA.destroy();
        }
    }

    private recordWrite(direction: TransportDirection, raw: Buffer): void {
        const copied = Buffer.from(raw);
        const entry: RecordedTransportWrite = {
            sequence: ++this.writeSequence,
            direction,
            raw: copied,
            ...decodeTrace(copied),
        };
        this.transcript.push(entry);
        this.pending.push(entry);
    }

    private async deliverBuffer(
        direction: TransportDirection,
        raw: Buffer,
        action: DeliveryAction,
        writeSequences: number[],
        details: Pick<RecordedTransportDelivery, 'copyIndex' | 'fragmentIndex'> = {},
    ): Promise<void> {
        const copied = Buffer.from(raw);
        this.recordDelivery(direction, copied, action, writeSequences, details);
        const target = direction === 'a-to-b' ? this.connectionB : this.connectionA;
        target.deliver(copied);
        await new Promise<void>(resolve => setImmediate(resolve));
        await this.idle();
    }

    private recordDelivery(
        direction: TransportDirection,
        raw: Buffer,
        action: DeliveryAction,
        writeSequences: number[],
        details: Pick<RecordedTransportDelivery, 'copyIndex' | 'fragmentIndex'> = {},
    ): void {
        const copied = Buffer.from(raw);
        this.deliveries.push({
            sequence: ++this.deliverySequence,
            direction,
            action,
            writeSequences: [...writeSequences],
            raw: copied,
            ...decodeTrace(copied),
            ...details,
        });
    }

    private queueReceive(target: 'a' | 'b', raw: Buffer): void {
        if (target === 'a') {
            this.pendingInboundA += 1;
            this.receiveChainA = this.receiveChainA.then(async () => {
                try {
                    await this.options.receiveAtA(Buffer.from(raw));
                }
                catch (error) {
                    this.receiveErrorA ??= error;
                }
                finally {
                    this.pendingInboundA -= 1;
                }
            });
            return;
        }

        this.pendingInboundB += 1;
        this.receiveChainB = this.receiveChainB.then(async () => {
            try {
                await this.options.receiveAtB(Buffer.from(raw));
            }
            catch (error) {
                this.receiveErrorB ??= error;
            }
            finally {
                this.pendingInboundB -= 1;
            }
        });
    }

    private cloneWrite(entry: RecordedTransportWrite): RecordedTransportWrite {
        return {
            ...entry,
            raw: Buffer.from(entry.raw),
            messageTypes: [...entry.messageTypes],
        };
    }
}

export function createRecordingDuplexPair(options: RecordingDuplexPairOptions): RecordingDuplexPair {
    return new RecordingDuplexPair(options);
}
