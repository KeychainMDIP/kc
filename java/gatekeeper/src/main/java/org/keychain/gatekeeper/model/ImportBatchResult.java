package org.keychain.gatekeeper.model;

public class ImportBatchResult {
    public int queued;
    public int processed;
    public int rejected;
    public int total;
    public int[] rejectedIndices;
    public Integer capacityDeferred;
    public int[] capacityDeferredIndices;
    public int[] processedIndices;

    public ImportBatchResult() {}
}
