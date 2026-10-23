package org.keychain.gatekeeper.model;

public class EventQueueStatus {
    public long staged;
    public long pending;
    public long processing;
    public long total;
    public boolean active;

    public EventQueueStatus() {}
}
