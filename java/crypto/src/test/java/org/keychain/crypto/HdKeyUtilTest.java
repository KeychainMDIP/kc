package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.Test;
import org.bitcoinj.crypto.DeterministicKey;

class HdKeyUtilTest {
    @Test
    void derivePathReturnsKey() {
        String mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        DeterministicKey master = HdKeyUtil.masterFromMnemonic(mnemonic);
        DeterministicKey child = HdKeyUtil.derivePath(master, 0, 0);

        assertNotNull(child);
        assertEquals(32, HdKeyUtil.privateKeyBytes(child).length);
    }
}
