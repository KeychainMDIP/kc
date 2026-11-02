package org.keychain.keymaster;

import java.util.Map;

public class PublishChallengeReceiptOptions {
    // Only reuse a trusted result from verifyResponse(), not caller-supplied response data.
    public Map<String, Object> verification;
    public Integer retries;
    public Integer delay;
    public String registry;
    public String validUntil;
    public String name;
}
