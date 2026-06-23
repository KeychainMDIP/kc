package org.keychain.cid;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class CidTest {
    @Test
    void validatesCidV0() {
        String cid = "QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2o7";
        assertTrue(Cid.isValid(cid));
    }

    @Test
    void validatesCidV1() {
        String cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
        assertTrue(Cid.isValid(cid));
    }

    @Test
    void rejectsInvalidCids() {
        assertFalse(Cid.isValid(null));
        assertFalse(Cid.isValid(""));
        assertFalse(Cid.isValid("Qm"));
        assertFalse(Cid.isValid("b"));
        assertFalse(Cid.isValid("QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2oO"));
        assertFalse(Cid.isValid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzd!"));
        assertFalse(Cid.isValid("cafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"));
    }
}
