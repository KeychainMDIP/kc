package org.keychain.crypto;

public class EncryptedMnemonic {
    public String salt;
    public String iv;
    public String data;

    public EncryptedMnemonic() {}

    public EncryptedMnemonic(String salt, String iv, String data) {
        this.salt = salt;
        this.iv = iv;
        this.data = data;
    }
}
