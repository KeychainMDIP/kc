package org.keychain.gatekeeper.model;

import java.util.List;
import java.util.Map;

public class CheckDIDsResult {
    public int total;
    public CheckDIDsResultByType byType;
    public Map<String, Integer> byRegistry;
    public Map<String, Integer> byVersion;
    public List<GatekeeperEvent> eventsQueue;

    public CheckDIDsResult() {}
}
