package org.keychain.gatekeeper.model;

public class ImportBatchResult {
    public int queued;
    public int processed;
    public int rejected;
    public int total;

    public ImportBatchResult() {}
}
