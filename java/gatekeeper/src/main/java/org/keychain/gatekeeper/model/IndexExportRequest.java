package org.keychain.gatekeeper.model;

public class IndexExportRequest {
    public String mode;
    public String cursor;
    public String checkpointCursor;
    public Integer limit;
    public Boolean includeOperations;
}
