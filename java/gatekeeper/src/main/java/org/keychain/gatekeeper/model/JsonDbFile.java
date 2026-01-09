package org.keychain.gatekeeper.model;

import java.util.List;
import java.util.Map;

public class JsonDbFile {
    public Map<String, List<GatekeeperEvent>> dids;
    public Map<String, java.util.List<Operation>> queue;
    public Map<String, Object> blocks;
    public Map<String, Object> hashes;

    public JsonDbFile() {}
}
