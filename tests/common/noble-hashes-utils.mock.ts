import { randomBytes as cryptoRandomBytes } from 'crypto';

export function isBytes(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array;
}

export function abytes(value: Uint8Array): Uint8Array {
    if (!isBytes(value)) {
        throw new Error('Uint8Array expected');
    }

    return value;
}

export function anumber(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('non-negative safe integer expected');
    }

    return value;
}

export function ahash<T>(value: T): T {
    return value;
}

export function utf8ToBytes(input: string): Uint8Array {
    return Buffer.from(input, 'utf8');
}

export function toBytes(input: string | Uint8Array): Uint8Array {
    if (typeof input === 'string') {
        return utf8ToBytes(input);
    }

    return input;
}

export function bytesToHex(input: Uint8Array): string {
    return Buffer.from(input).toString('hex');
}

export function hexToBytes(input: string): Uint8Array {
    return Buffer.from(input, 'hex');
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    return Buffer.concat(arrays.map(array => Buffer.from(array)));
}

export function randomBytes(bytesLength = 32): Uint8Array {
    return cryptoRandomBytes(bytesLength);
}

export function createHasher<T>(factory: T): T {
    return factory;
}
