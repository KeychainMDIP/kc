package org.keychain.gatekeeper.model;

public class GetStatusResult {
    public long uptimeSeconds;
    public CheckDIDsResult dids;
    public MemoryUsage memoryUsage;

    public GetStatusResult() {}
}
