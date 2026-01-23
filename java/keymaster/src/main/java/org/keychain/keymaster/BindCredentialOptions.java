package org.keychain.keymaster;

import java.util.Map;

public class BindCredentialOptions {
    public String validFrom;
    public String validUntil;
    public Map<String, Object> credential;

    public BindCredentialOptions() {}
}
