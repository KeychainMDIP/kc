package org.keychain.keymaster;

public class CreateResponseOptions extends EncryptOptions {
    public Integer retries;
    public Integer delay;
    // Verification defaults to publishing receipts. Ignored during response creation.
    public Boolean publish;

    public CreateResponseOptions() {}
}
