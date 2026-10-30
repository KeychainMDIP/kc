package org.keychain.gatekeeper.model;

import java.util.List;

public class ProcessEventsResult {
    public Boolean busy;
    public Integer added;
    public Integer merged;
    public Integer rejected;
    public Integer pending;
    public List<String> acceptedHashes;
    public List<GatekeeperEvent> acceptedEvents;
    public List<Operation> rejectedOperations;

    public ProcessEventsResult() {}
}
