package org.keychain.crypto;

public class HdKey {
    public final String xpriv;
    public final String xpub;

    public HdKey(String xpriv, String xpub) {
        this.xpriv = xpriv;
        this.xpub = xpub;
    }
}
