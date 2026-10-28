package org.keychain.gatekeeper.model;

import java.util.List;

public class IndexExportDIDRecord {
    public String did;
    public List<GatekeeperEvent> events;
    public Boolean removed;
}
