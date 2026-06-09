const b4aMock = {
    from(value: string | ArrayBuffer | ArrayLike<number>, encoding?: BufferEncoding): Buffer {
        if (typeof value === 'string') {
            return Buffer.from(value, encoding);
        }

        return Buffer.from(value);
    },

    toString(value: Uint8Array, encoding?: BufferEncoding): string {
        return Buffer.from(value).toString(encoding);
    },
};

export default b4aMock;
