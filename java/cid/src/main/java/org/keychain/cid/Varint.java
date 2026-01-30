package org.keychain.cid;

public final class Varint {
    private Varint() {
    }

    public static Decoded decodeUnsigned(byte[] input, int offset) {
        if (input == null) {
            throw new IllegalArgumentException("input");
        }
        if (offset < 0 || offset >= input.length) {
            throw new IllegalArgumentException("offset");
        }

        long value = 0;
        int shift = 0;

        for (int i = 0; i < 10; i += 1) {
            int index = offset + i;
            if (index >= input.length) {
                throw new IllegalArgumentException("varint overflow");
            }

            int b = input[index] & 0xFF;
            long bits = b & 0x7FL;
            if (bits != 0) {
                if (shift >= 63) {
                    throw new IllegalArgumentException("varint overflow");
                }
                long add = bits << shift;
                if (add < 0 || value > Long.MAX_VALUE - add) {
                    throw new IllegalArgumentException("varint overflow");
                }
                value += add;
            }

            if ((b & 0x80) == 0) {
                return new Decoded(value, i + 1);
            }

            shift += 7;
        }

        throw new IllegalArgumentException("varint overflow");
    }

    public static final class Decoded {
        public final long value;
        public final int length;

        private Decoded(long value, int length) {
            this.value = value;
            this.length = length;
        }
    }
}
