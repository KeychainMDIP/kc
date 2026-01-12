package org.keychain.keymaster.testutil;

import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

public class GatekeeperRecorder implements GatekeeperClient {
    public Operation lastCreate;
    public Operation lastUpdate;
    public Operation lastDelete;
    public String lastResolveDid;
    public String lastBlockRegistry;
    public String createResponse = "did:test:created";
    public MdipDocument resolveResponse;
    public BlockInfo blockResponse;
    public java.util.List<String> registries = java.util.List.of("local", "hyperswarm", "TFTC");

    @Override
    public java.util.List<String> listRegistries() {
        return registries;
    }

    @Override
    public String createDID(Operation operation) {
        lastCreate = operation;
        return createResponse;
    }

    @Override
    public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
        lastResolveDid = did;
        return resolveResponse;
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
        lastBlockRegistry = registry;
        return blockResponse;
    }
}
