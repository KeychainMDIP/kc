function toBuffer(value: string | Uint8Array | Buffer, encoding?: BufferEncoding): Buffer {
    if (typeof value === 'string') {
        return Buffer.from(value, encoding);
    }

    return Buffer.from(value);
}

const b4a = {
    from(value: string | Uint8Array | Buffer, encoding?: BufferEncoding): Buffer {
        return toBuffer(value, encoding);
    },
    toString(value: string | Uint8Array | Buffer, encoding?: BufferEncoding): string {
        return toBuffer(value).toString(encoding);
    },
};

export const from = b4a.from;
export const toString = b4a.toString;
export default b4a;
