package org.keychain.keymaster;

public class IssueCredentialOptions extends EncryptOptions {
    public String schema;
    public String subject;
    public String validFrom;

    public IssueCredentialOptions() {}
}
