package org.keychain.gatekeeper.model;

public class IndexExportOperationRecord {
    public long seq;
    public String did;
    public GatekeeperEvent event;
    public String operationHash;
}
