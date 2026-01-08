package org.keychain.keymaster.model;

import org.keychain.crypto.EncryptedMnemonic;

public class Seed {
    public String mnemonic;
    public HdKey hdkey;
    public EncryptedMnemonic mnemonicEnc;
}
