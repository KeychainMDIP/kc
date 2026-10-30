package org.keychain.keymaster.testutil;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.bitcoinj.core.Base58;
import org.keychain.crypto.JwkPublic;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.gatekeeper.model.DocumentMetadata;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.keymaster.store.WalletJsonMapper;

public class TestGatekeeper {
    private final ObjectMapper mapper = WalletJsonMapper.mapper();
    private final KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
    private final Map<String, String> operationDids = new HashMap<>();
    public Consumer<String> beforeResolve = did -> {};
    public Consumer<String> afterResolve = did -> {};
    public final List<String> resolvedDids = Collections.synchronizedList(new ArrayList<>());
    public final List<ResolveDIDOptions> resolveOptions = Collections.synchronizedList(new ArrayList<>());
    public final List<Operation> submitted = new ArrayList<>();
    public final List<Operation> created = new ArrayList<>();
    public final Map<String, MdipDocument> docs = Collections.synchronizedMap(new LinkedHashMap<>());
    public final Map<String, MdipDocument> initial = new HashMap<>();
    public boolean confirmed = true;
    public boolean rejectUpdate;
    public boolean requestedInitialKey;
    public int updates;
    public Consumer<Operation> beforeCreate = operation -> {};
    public Runnable afterCreate = () -> {};
    public Runnable afterUpdate = () -> {};
    public final GatekeeperInterface client = (GatekeeperInterface) Proxy.newProxyInstance(
        GatekeeperInterface.class.getClassLoader(), new Class<?>[] {GatekeeperInterface.class}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "getBlock": return null;
                case "createDID": return create((Operation) args[0]);
                case "resolveDID": return resolve((String) args[0], (ResolveDIDOptions) args[1]);
                case "updateDID": return update((Operation) args[0]);
                default: throw new AssertionError("Unexpected Gatekeeper call: " + method.getName());
            }
        });

    public MdipDocument doc(String did) { return docs.get(suffix(did)); }
    public MdipDocument vault(String did) { return doc((String) ((Map<?, ?>) doc(did).didDocumentData).get("vault")); }

    private String create(Operation operation) {
        beforeCreate.accept(operation);
        byte[] multihash = new byte[34];
        multihash[0] = 0x12;
        multihash[1] = 0x20;
        ByteBuffer.wrap(multihash, 30, 4).putInt(created.size() + 1);
        String operationJson = org.keychain.crypto.CanonicalJson.canonicalize(operation);
        if (operationDids.containsKey(operationJson)) return operationDids.get(operationJson);
        String did = (operation.mdip.prefix != null ? operation.mdip.prefix : "did:test") + ":" + Base58.encode(multihash);
        MdipDocument doc = new MdipDocument();
        doc.mdip = operation.mdip;
        doc.didDocument = new MdipDocument.DidDocument();
        doc.didDocument.id = did;
        doc.didDocument.controller = operation.controller;
        doc.didDocumentData = operation.data == null ? new LinkedHashMap<>() : operation.data;
        doc.didDocumentMetadata = new DocumentMetadata();
        doc.didDocumentMetadata.version = "1";
        doc.didDocumentMetadata.versionId = "version-" + did + "-1";
        doc.didDocumentMetadata.confirmed = confirmed;
        if ("agent".equals(operation.mdip.type)) {
            var method = new MdipDocument.VerificationMethod();
            method.id = "#key-1";
            method.publicKeyJwk = operation.publicJwk;
            doc.didDocument.verificationMethod = new ArrayList<>(List.of(method));
            assertSignature(operation, operation.publicJwk);
        } else {
            assertSignature(operation, doc(operation.controller).didDocument.verificationMethod.get(0).publicKeyJwk);
        }
        created.add(operation);
        operationDids.put(operationJson, did);
        docs.put(suffix(did), copy(doc));
        initial.put(suffix(did), copy(doc));
        afterCreate.run();
        return did;
    }

    private MdipDocument resolve(String did, ResolveDIDOptions options) {
        resolvedDids.add(did);
        resolveOptions.add(options == null ? null : mapper.convertValue(options, ResolveDIDOptions.class));
        beforeResolve.accept(did);
        MdipDocument doc = doc(did);
        if (options != null && Integer.valueOf(1).equals(options.versionSequence)) {
            requestedInitialKey = true;
            return copy(initial.get(suffix(did)));
        }
        if (doc == null || options != null && Boolean.TRUE.equals(options.confirm) && !Boolean.TRUE.equals(doc.didDocumentMetadata.confirmed)) {
            MdipDocument missing = new MdipDocument();
            missing.didResolutionMetadata = new MdipDocument.DidResolutionMetadata();
            missing.didResolutionMetadata.error = "notFound";
            return missing;
        }
        MdipDocument result = copy(doc);
        afterResolve.accept(did);
        return result;
    }

    private synchronized boolean update(Operation operation) {
        submitted.add(operation);
        MdipDocument previous = doc(operation.did);
        MdipDocument signer = "agent".equals(previous.mdip.type) ? previous : doc(previous.didDocument.controller);
        assertSignature(operation, signer.didDocument.verificationMethod.get(0).publicKeyJwk);
        if (rejectUpdate || !java.util.Objects.equals(previous.didDocumentMetadata.versionId, operation.previd)) return false;
        MdipDocument next = copy(operation.doc);
        next.didDocumentMetadata = new DocumentMetadata();
        next.didDocumentMetadata.confirmed = previous.didDocumentMetadata.confirmed;
        next.didDocumentMetadata.version = Integer.toString(Integer.parseInt(previous.didDocumentMetadata.version) + 1);
        next.didDocumentMetadata.versionId = "version-" + operation.did + "-" + next.didDocumentMetadata.version;
        docs.put(suffix(operation.did), next);
        updates++;
        afterUpdate.run();
        return true;
    }

    private void assertSignature(Operation operation, org.keychain.gatekeeper.model.EcdsaJwkPublic key) {
        Operation unsigned = mapper.convertValue(operation, Operation.class);
        unsigned.signature = null;
        assertEquals(crypto.hashJson(unsigned), operation.signature.hash);
        assertTrue(crypto.verifySig(operation.signature.hash, operation.signature.value, new JwkPublic(key.kty, key.crv, key.x, key.y)));
    }

    private MdipDocument copy(MdipDocument doc) { return mapper.convertValue(doc, MdipDocument.class); }
    private static String suffix(String did) { return did.substring(did.lastIndexOf(':') + 1); }
}
