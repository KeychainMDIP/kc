package org.keychain.keymaster.testutil;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.DocumentMetadata;
import org.keychain.gatekeeper.model.Mdip;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;

public class GatekeeperStub implements GatekeeperClient {
    private static final String DEFAULT_SEED_DID = "did:test:seed";
    private static final String DEFAULT_ASSET_PREFIX = "did:test:asset";

    private final Map<String, MdipDocument> docs = new HashMap<>();
    private final String seedDid;
    private final String assetPrefix;
    private int assetCounter = 0;

    public GatekeeperStub() {
        this(DEFAULT_SEED_DID, DEFAULT_ASSET_PREFIX);
    }

    public GatekeeperStub(String seedDid) {
        this(seedDid, DEFAULT_ASSET_PREFIX);
    }

    public GatekeeperStub(String seedDid, String assetPrefix) {
        this.seedDid = seedDid;
        this.assetPrefix = assetPrefix != null ? assetPrefix : DEFAULT_ASSET_PREFIX;
    }

    public void addDoc(String did, boolean deactivated) {
        MdipDocument doc = new MdipDocument();
        doc.didDocument = new MdipDocument.DidDocument();
        doc.didDocument.id = did;
        Mdip mdip = new Mdip();
        mdip.version = 1;
        mdip.type = "agent";
        mdip.registry = "hyperswarm";
        doc.mdip = mdip;
        doc.didDocumentMetadata = new DocumentMetadata();
        doc.didDocumentMetadata.deactivated = deactivated;
        docs.put(did, doc);
    }

    public void removeDIDs(List<String> dids) {
        for (String did : dids) {
            docs.remove(did);
        }
    }

    public void putDoc(MdipDocument doc) {
        if (doc == null || doc.didDocument == null || doc.didDocument.id == null) {
            throw new IllegalArgumentException("doc.didDocument.id is required");
        }
        docs.put(doc.didDocument.id, doc);
    }

    @Override
    public List<String> listRegistries() {
        return List.of("local", "hyperswarm", "TFTC");
    }

    @Override
    public String createDID(Operation operation) {
        boolean isSeedBank = operation != null
            && operation.mdip != null
            && "agent".equals(operation.mdip.type)
            && "1970-01-01T00:00:00.000Z".equals(operation.created);

        String did = isSeedBank ? seedDid : assetPrefix + "-" + assetCounter++;
        if (docs.containsKey(did)) {
            return did;
        }

        MdipDocument doc = new MdipDocument();
        doc.didDocument = new MdipDocument.DidDocument();
        doc.didDocument.id = did;
        doc.didDocument.controller = operation != null ? operation.controller : null;
        doc.didDocumentData = operation != null && operation.data != null
            ? operation.data
            : new HashMap<>();
        doc.mdip = operation != null ? operation.mdip : null;
        if (operation != null && operation.publicJwk != null) {
            MdipDocument.VerificationMethod method = new MdipDocument.VerificationMethod();
            method.id = "#key-1";
            method.controller = did;
            method.type = "EcdsaSecp256k1";
            method.publicKeyJwk = operation.publicJwk;
            doc.didDocument.verificationMethod = List.of(method);
            doc.didDocument.authentication = List.of("#key-1");
        }
        doc.didDocumentMetadata = new DocumentMetadata();
        doc.didDocumentMetadata.versionId = "v1";
        docs.put(did, doc);
        return did;
    }

    @Override
    public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
        return docs.get(did);
    }

    @Override
    public boolean updateDID(Operation operation) {
        if (operation != null && operation.doc != null) {
            if (operation.doc.didDocumentMetadata == null) {
                operation.doc.didDocumentMetadata = new DocumentMetadata();
            }
            operation.doc.didDocumentMetadata.versionId = "v2";
            docs.put(operation.did, operation.doc);
        }
        return true;
    }

    @Override
    public boolean deleteDID(Operation operation) {
        if (operation != null && docs.containsKey(operation.did)) {
            MdipDocument doc = docs.get(operation.did);
            if (doc.didDocumentMetadata == null) {
                doc.didDocumentMetadata = new DocumentMetadata();
            }
            doc.didDocumentMetadata.deactivated = true;
            docs.put(operation.did, doc);
        }
        return true;
    }

    @Override
    public BlockInfo getBlock(String registry) {
        return null;
    }
}
