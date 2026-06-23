package org.keychain.crypto;

public class HdKeyJson {
    public final String xpriv;
    public final String xpub;
    public final String chainCode;
    public final Integer depth;
    public final Integer index;
    public final Integer parentFingerprint;

    public HdKeyJson(
        String xpriv,
        String xpub,
        String chainCode,
        Integer depth,
        Integer index,
        Integer parentFingerprint
    ) {
        this.xpriv = xpriv;
        this.xpub = xpub;
        this.chainCode = chainCode;
        this.depth = depth;
        this.index = index;
        this.parentFingerprint = parentFingerprint;
    }
}
