package org.keychain.gatekeeper;

import java.util.List;
import org.keychain.gatekeeper.ipfs.IpfsClient;

public class GatekeeperOptions {
    public GatekeeperDb db;
    public IpfsClient ipfs;
    public Object console;
    public String didPrefix;
    public Integer maxOpBytes;
    public Integer maxQueueSize;
    public List<String> registries;

    public GatekeeperOptions() {}
}
