package org.keychain.cid;

public final class Cid {
    private Cid() {
    }

    public static boolean isValid(String cid) {
        if (cid == null || cid.isBlank()) {
            return false;
        }

        try {
            if (cid.startsWith("Q")) {
                return validateV0(cid);
            }
            return validateV1(cid);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static boolean validateV0(String cid) {
        byte[] bytes = Base58Btc.decode(cid);
        if (bytes.length != 34) {
            return false;
        }
        return (bytes[0] == 0x12) && (bytes[1] == 0x20);
    }

    private static boolean validateV1(String cid) {
        byte[] bytes = Multibase.decode(cid);
        if (bytes.length < 4) {
            return false;
        }

        Varint.Decoded version = Varint.decodeUnsigned(bytes, 0);
        if (version.value != 1) {
            return false;
        }

        int offset = version.length;
        Varint.Decoded codec = Varint.decodeUnsigned(bytes, offset);
        offset += codec.length;
        if (offset >= bytes.length) {
            return false;
        }

        Varint.Decoded multihashCode = Varint.decodeUnsigned(bytes, offset);
        offset += multihashCode.length;
        if (offset >= bytes.length) {
            return false;
        }

        Varint.Decoded digestLength = Varint.decodeUnsigned(bytes, offset);
        offset += digestLength.length;

        if (digestLength.value < 0 || digestLength.value > Integer.MAX_VALUE) {
            return false;
        }

        int remaining = bytes.length - offset;
        return remaining == (int) digestLength.value;
    }
}
