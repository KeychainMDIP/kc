package org.keychain.keymaster.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.keychain.crypto.EncryptedMnemonic;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class Seed {
    public String mnemonic;
    public HdKey hdkey;
    public EncryptedMnemonic mnemonicEnc;
}
