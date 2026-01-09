package org.keychain.cid;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class CidTest {
    @Test
    void validatesCidV0() {
        String cid = "QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2o7";
        assertEquals(true, Cid.isValid(cid));
    }

    @Test
    void validatesCidV1() {
        String cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
        assertEquals(true, Cid.isValid(cid));
    }

    @Test
    void rejectsInvalidCids() {
        assertEquals(false, Cid.isValid(null));
        assertEquals(false, Cid.isValid(""));
        assertEquals(false, Cid.isValid("Qm"));
        assertEquals(false, Cid.isValid("b"));
        assertEquals(false, Cid.isValid("QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2oO"));
        assertEquals(false, Cid.isValid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzd!"));
        assertEquals(false, Cid.isValid("cafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"));
    }
}
