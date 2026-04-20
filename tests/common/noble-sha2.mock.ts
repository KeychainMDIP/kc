import { createHash } from 'crypto';

export function sha256(input: Uint8Array): Uint8Array {
    return createHash('sha256').update(Buffer.from(input)).digest();
}
