package org.keychain.gatekeeper;

import java.util.List;
import org.keychain.gatekeeper.model.BlockId;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.GatekeeperEvent;
import org.keychain.gatekeeper.model.GetDIDOptions;
import org.keychain.gatekeeper.model.ImportBatchResult;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ProcessEventsResult;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.gatekeeper.model.VerifyDbOptions;
import org.keychain.gatekeeper.model.VerifyDbResult;

public interface GatekeeperInterface {
    List<String> listRegistries();
    boolean resetDb();
    VerifyDbResult verifyDb(VerifyDbOptions options);
    String createDID(Operation operation);
    MdipDocument resolveDID(String did, ResolveDIDOptions options);
    boolean updateDID(Operation operation);
    boolean deleteDID(Operation operation);
    Object getDIDs(GetDIDOptions options);
    List<List<GatekeeperEvent>> exportDIDs(List<String> dids);
    ImportBatchResult importDIDs(List<List<GatekeeperEvent>> dids);
    boolean removeDIDs(List<String> dids);
    List<GatekeeperEvent> exportBatch(List<String> dids);
    ImportBatchResult importBatch(List<GatekeeperEvent> batch);
    ProcessEventsResult processEvents();
    List<Operation> getQueue(String registry);
    boolean clearQueue(String registry, List<Operation> events);
    String addData(byte[] data);
    byte[] getData(String cid);
    String addJSON(Object json);
    Object getJSON(String cid);
    String addText(String text);
    String getText(String cid);
    BlockInfo getBlock(String registry);
    BlockInfo getBlock(String registry, BlockId blockId);
    boolean addBlock(String registry, BlockInfo blockInfo);
    String generateDID(Operation operation);
}
