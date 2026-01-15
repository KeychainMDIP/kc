package org.keychain.gatekeeper.model;

import java.util.List;

public class GatekeeperEvent {
    public String registry;
    public String time;
    public List<Integer> ordinal;
    public Operation operation;
    public String did;
    public String opid;
    public MdipRegistration blockchain;

    public GatekeeperEvent() {}
}
