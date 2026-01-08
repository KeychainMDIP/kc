package org.keychain.gatekeeper;

import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

public interface GatekeeperClient {
    String createDID(Operation operation);
    MdipDocument resolveDID(String did, ResolveDIDOptions options);
    boolean updateDID(Operation operation);
    boolean deleteDID(Operation operation);
    BlockInfo getBlock(String registry);
}
