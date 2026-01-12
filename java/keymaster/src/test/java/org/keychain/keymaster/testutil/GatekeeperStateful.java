package org.keychain.keymaster.testutil;

import java.util.HashMap;
import java.util.Map;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

public class GatekeeperStateful implements GatekeeperClient {
    public final Map<String, MdipDocument> docs = new HashMap<>();
    public Operation lastCreate;
    public Operation lastUpdate;
    public Operation lastDelete;
    public String createResponse;
    public BlockInfo blockResponse;

    @Override
    public String createDID(Operation operation) {
        lastCreate = operation;
        String did = createResponse != null ? createResponse : "did:test:created";
        if (operation != null && !docs.containsKey(did)) {
            MdipDocument doc = new MdipDocument();
            doc.didDocument = new MdipDocument.DidDocument();
            doc.didDocument.id = did;
            doc.didDocument.controller = operation.controller;
            doc.didDocumentData = operation.data;
            doc.mdip = operation.mdip;
            docs.put(did, doc);
        }
        return did;
    }

    @Override
    public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
        return docs.get(did);
    }

    @Override
    public boolean updateDID(Operation operation) {
        lastUpdate = operation;
        return true;
    }

    @Override
    public boolean deleteDID(Operation operation) {
        lastDelete = operation;
        return true;
    }

    @Override
    public BlockInfo getBlock(String registry) {
        return blockResponse;
    }
}
