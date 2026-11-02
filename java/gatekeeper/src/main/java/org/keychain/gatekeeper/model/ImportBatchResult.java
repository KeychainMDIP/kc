package org.keychain.gatekeeper.model;

import java.util.List;

public class ImportBatchResult {
    public int queued;
    public int processed;
    public int rejected;
    public int total;
    public List<Integer> rejectedIndices;

    public ImportBatchResult() {}
}
