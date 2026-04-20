type B4aInput = string | Uint8Array | Buffer;

function toBuffer(value: B4aInput, encoding?: BufferEncoding): Buffer {
    if (typeof value === 'string') {
        return Buffer.from(value, encoding);
    }

    return Buffer.from(value);
}

const b4a = {
    from(value: B4aInput, encoding?: BufferEncoding): Buffer {
        return toBuffer(value, encoding);
    },
    toString(value: B4aInput, encoding?: BufferEncoding): string {
        return toBuffer(value).toString(encoding);
    },
};

export const from = b4a.from;
export const toString = b4a.toString;
export default b4a;
