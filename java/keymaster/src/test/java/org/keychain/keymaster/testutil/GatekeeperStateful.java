package org.keychain.keymaster.testutil;

import java.util.HashMap;
import java.util.Map;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.keymaster.store.WalletJsonMapper;

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
            if (operation.publicJwk != null) {
                MdipDocument.VerificationMethod method = new MdipDocument.VerificationMethod();
                method.id = "#key-1";
                method.controller = did;
                method.type = "EcdsaSecp256k1";
                method.publicKeyJwk = operation.publicJwk;
                doc.didDocument.verificationMethod = java.util.List.of(method);
                doc.didDocument.authentication = java.util.List.of("#key-1");
            }
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
        if (operation != null && operation.doc != null) {
            MdipDocument stored = copyDoc(operation.doc);
            if (stored.didDocumentMetadata == null) {
                stored.didDocumentMetadata = new org.keychain.gatekeeper.model.DocumentMetadata();
            }
            if (stored.didDocumentMetadata.version == null) {
                stored.didDocumentMetadata.version = "2";
            }
            docs.put(operation.did, stored);
        }
        return true;
    }

    private static MdipDocument copyDoc(MdipDocument doc) {
        try {
            var mapper = WalletJsonMapper.mapper();
            String json = mapper.writeValueAsString(doc);
            return mapper.readValue(json, MdipDocument.class);
        } catch (Exception e) {
            return doc;
        }
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
