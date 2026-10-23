package org.keychain.gatekeeper.model;

public class GetStatusResult {
    public long uptimeSeconds;
    public EventQueueStatus eventsQueue;
    public MemoryUsage memoryUsage;

    public GetStatusResult() {}
}
