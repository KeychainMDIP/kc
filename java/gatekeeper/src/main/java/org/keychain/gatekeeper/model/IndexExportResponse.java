package org.keychain.gatekeeper.model;

import java.util.List;

public class IndexExportResponse {
    public String mode;
    public String indexEpoch;
    public String cursor;
    public String checkpointCursor;
    public boolean hasMore;
    public List<IndexExportDIDRecord> dids;
    public List<IndexExportBlockRecord> blocks;
    public List<IndexExportOperationRecord> operations;
    public List<IndexExportRemovedOperationRecord> removedOperations;
}
