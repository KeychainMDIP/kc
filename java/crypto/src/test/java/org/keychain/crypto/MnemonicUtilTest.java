package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class MnemonicUtilTest {
    @Test
    void generatedMnemonicIsValid() {
        String mnemonic = MnemonicUtil.generateMnemonic();
        assertTrue(MnemonicUtil.validateMnemonic(mnemonic));
        assertEquals(12, mnemonic.trim().split("\\s+").length);
    }

    @Test
    void invalidMnemonicReturnsFalse() {
        assertFalse(MnemonicUtil.validateMnemonic("not a real mnemonic"));
    }
}
