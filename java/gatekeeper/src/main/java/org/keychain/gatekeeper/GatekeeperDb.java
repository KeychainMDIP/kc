package org.keychain.gatekeeper;

import java.util.List;
import java.util.Map;
import org.keychain.gatekeeper.model.BlockId;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.GatekeeperEvent;
import org.keychain.gatekeeper.model.JsonDbFile;
import org.keychain.gatekeeper.model.Operation;

public interface GatekeeperDb {
    void start();
    void stop();
    Object resetDb();
    Object addEvent(String did, GatekeeperEvent event);
    List<GatekeeperEvent> getEvents(String did);
    Object setEvents(String did, List<GatekeeperEvent> events);
    Object deleteEvents(String did);
    List<String> getAllKeys();
    int queueOperation(String registry, Operation op);
    List<Operation> getQueue(String registry);
    boolean clearQueue(String registry, List<Operation> batch);
    boolean addBlock(String registry, BlockInfo blockInfo);
    BlockInfo getBlock(String registry, BlockId blockId);
}
