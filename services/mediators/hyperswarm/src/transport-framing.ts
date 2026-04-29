const FRAME_HEADER_BYTES = 4;
const EMPTY_BUFFER: Buffer = Buffer.alloc(0);
const JSON_OBJECT_START = 0x7b;
const JSON_OBJECT_END = 0x7d;
const JSON_QUOTE = 0x22;
const JSON_ESCAPE = 0x5c;

export const DEFAULT_MAX_FRAMED_MESSAGE_BYTES = 16 * 1024 * 1024;

export interface DecodedFramedMessagesResult {
    messages: Buffer[];
    remaining: Buffer;
    error?: string;
}

export interface DecodedLegacyJsonMessagesResult {
    messages: Buffer[];
    remaining: Buffer;
    error?: string;
}

export function supportsLegacyRawTransportMessage(messageType: string): boolean {
    return messageType === 'ping'
        || messageType === 'sync'
        || messageType === 'batch'
        || messageType === 'queue';
}

function isJsonWhitespace(byte: number): boolean {
    return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

export function encodeFramedMessage(
    payload: string | Uint8Array,
    maxMessageBytes = DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
): Buffer {
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);

    if (body.length === 0) {
        throw new Error('framed message payload must not be empty');
    }

    if (!Number.isInteger(maxMessageBytes) || maxMessageBytes <= 0) {
        throw new Error('maxMessageBytes must be a positive integer');
    }

    if (body.length > maxMessageBytes) {
        throw new Error(`framed message payload exceeds max size of ${maxMessageBytes} bytes`);
    }

    const framed = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length);
    framed.writeUInt32BE(body.length, 0);
    body.copy(framed, FRAME_HEADER_BYTES);
    return framed;
}

export function decodeFramedMessages(
    buffer: Buffer,
    maxMessageBytes = DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
): DecodedFramedMessagesResult {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('buffer must be a Buffer');
    }

    if (!Number.isInteger(maxMessageBytes) || maxMessageBytes <= 0) {
        throw new Error('maxMessageBytes must be a positive integer');
    }

    let offset = 0;
    const messages: Buffer[] = [];

    while ((buffer.length - offset) >= FRAME_HEADER_BYTES) {
        const frameLength = buffer.readUInt32BE(offset);
        if (frameLength === 0) {
            return {
                messages,
                remaining: EMPTY_BUFFER,
                error: 'invalid framed message length 0',
            };
        }

        if (frameLength > maxMessageBytes) {
            return {
                messages,
                remaining: EMPTY_BUFFER,
                error: `framed message length ${frameLength} exceeds max ${maxMessageBytes}`,
            };
        }

        const frameEnd = offset + FRAME_HEADER_BYTES + frameLength;
        if (buffer.length < frameEnd) {
            break;
        }

        messages.push(buffer.subarray(offset + FRAME_HEADER_BYTES, frameEnd));
        offset = frameEnd;
    }

    return {
        messages,
        remaining: offset === buffer.length ? EMPTY_BUFFER : Buffer.from(buffer.subarray(offset)),
    };
}

export function decodeLegacyJsonMessages(
    buffer: Buffer,
    maxMessageBytes = DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
    maxMessages = Number.MAX_SAFE_INTEGER,
): DecodedLegacyJsonMessagesResult {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('buffer must be a Buffer');
    }

    if (!Number.isInteger(maxMessageBytes) || maxMessageBytes <= 0) {
        throw new Error('maxMessageBytes must be a positive integer');
    }

    if (!Number.isInteger(maxMessages) || maxMessages <= 0) {
        throw new Error('maxMessages must be a positive integer');
    }

    let offset = 0;
    const messages: Buffer[] = [];

    while (offset < buffer.length && messages.length < maxMessages) {
        while (offset < buffer.length && isJsonWhitespace(buffer[offset])) {
            offset += 1;
        }

        if (offset >= buffer.length) {
            break;
        }

        const start = offset;
        if (buffer[start] !== JSON_OBJECT_START) {
            return {
                messages,
                remaining: EMPTY_BUFFER,
                error: `invalid legacy JSON message prefix byte ${buffer[start]}`,
            };
        }

        let depth = 0;
        let inString = false;
        let escaped = false;
        let messageEnd = -1;

        for (let index = start; index < buffer.length; index += 1) {
            const byte = buffer[index];

            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (byte === JSON_ESCAPE) {
                    escaped = true;
                    continue;
                }

                if (byte === JSON_QUOTE) {
                    inString = false;
                }
                continue;
            }

            if (byte === JSON_QUOTE) {
                inString = true;
                continue;
            }

            if (byte === JSON_OBJECT_START) {
                depth += 1;
                continue;
            }

            if (byte === JSON_OBJECT_END) {
                depth -= 1;
                if (depth === 0) {
                    messageEnd = index + 1;
                    break;
                }
            }
        }

        if (messageEnd === -1) {
            const pendingLength = buffer.length - start;
            if (pendingLength > maxMessageBytes) {
                return {
                    messages,
                    remaining: EMPTY_BUFFER,
                    error: `legacy JSON message length ${pendingLength} exceeds max ${maxMessageBytes}`,
                };
            }

            return {
                messages,
                remaining: Buffer.from(buffer.subarray(start)),
            };
        }

        const messageLength = messageEnd - start;
        if (messageLength > maxMessageBytes) {
            return {
                messages,
                remaining: EMPTY_BUFFER,
                error: `legacy JSON message length ${messageLength} exceeds max ${maxMessageBytes}`,
            };
        }

        messages.push(buffer.subarray(start, messageEnd));
        offset = messageEnd;
    }

    return {
        messages,
        remaining: offset === buffer.length ? EMPTY_BUFFER : Buffer.from(buffer.subarray(offset)),
    };
}

export class FramedMessageParser {
    private buffer: Buffer = EMPTY_BUFFER;
    private readonly maxMessageBytes: number;

    constructor(maxMessageBytes = DEFAULT_MAX_FRAMED_MESSAGE_BYTES) {
        if (!Number.isInteger(maxMessageBytes) || maxMessageBytes <= 0) {
            throw new Error('maxMessageBytes must be a positive integer');
        }

        this.maxMessageBytes = maxMessageBytes;
    }

    push(chunk: Buffer | Uint8Array): { messages: Buffer[]; error?: string } {
        const incoming = Buffer.from(chunk);
        if (incoming.length === 0) {
            return { messages: [] };
        }

        this.buffer = this.buffer.length === 0 ? incoming : Buffer.concat([this.buffer, incoming]);
        const decoded = decodeFramedMessages(this.buffer, this.maxMessageBytes);
        this.buffer = decoded.error ? EMPTY_BUFFER : decoded.remaining;

        return {
            messages: decoded.messages,
            error: decoded.error,
        };
    }

    get pendingBytes(): number {
        return this.buffer.length;
    }
}
