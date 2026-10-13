package org.keychain.gatekeeper.model;

public class ProcessEventsResult {
    public Boolean busy;
    public Integer added;
    public Integer merged;
    public Integer rejected;
    public Integer pending;
    public Boolean hasMore;
    public Integer capacityDeferred;
    public String[] capacityDeferredHashes;

    public ProcessEventsResult() {}
}
