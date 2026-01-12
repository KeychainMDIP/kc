package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.DocumentMetadata;
import org.keychain.gatekeeper.model.Mdip;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.GatekeeperRecorder;
import org.keychain.keymaster.testutil.GatekeeperStateful;

class KeymasterTest {
    private static final String MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    @Test
    void loadWalletUsesManagerCache() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        CountingCrypto crypto = new CountingCrypto();
        Keymaster keymaster = new Keymaster(store, crypto, "passphrase");

        WalletFile first = keymaster.loadWallet();
        WalletFile second = keymaster.loadWallet();

        assertSame(first, second);
        assertEquals(1, crypto.decryptCount);
    }

    @Test
    void newWalletPersistsAndDecryptsMnemonic() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        Keymaster keymaster = new Keymaster(store, "passphrase");

        WalletFile wallet = keymaster.newWallet(
            MNEMONIC,
            true
        );

        assertNotNull(wallet);
        assertNotNull(keymaster.loadWallet());
        assertEquals(
            MNEMONIC,
            keymaster.decryptMnemonic()
        );
    }

    @Test
    void createIdBuildsSignedOperationAndUpdatesWallet() throws Exception {
        ObjectMapper mapper = mapper();
        JsonNode vectors = loadOperations(mapper);
        JsonNode createNode = vectors.get("createId");

        WalletEncFile stored = buildStoredWalletWithCounter(0, new HashMap<>(), null);
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.createResponse = "did:test:created";
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = createNode.get("blockid").asText();

        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        OperationBuilder builder = new OperationBuilder(
            Clock.fixed(Instant.parse(createNode.get("created").asText()), ZoneOffset.UTC)
        );
        OperationSignerImpl signer = new OperationSignerImpl(
            crypto,
            Clock.fixed(Instant.parse(createNode.get("signed").asText()), ZoneOffset.UTC)
        );
        OperationFactory factory = new OperationFactory(builder, signer);
        Keymaster keymaster = new Keymaster(store, gatekeeper, crypto, factory, "passphrase");

        String did = keymaster.createId("Alice", createNode.get("registry").asText());
        assertEquals("did:test:created", did);

        JsonNode expected = createNode.get("signedOperation");
        assertEquals(expected, mapper.valueToTree(gatekeeper.lastCreate));

        WalletFile wallet = keymaster.loadWallet();
        assertEquals(1, wallet.counter);
        assertEquals("Alice", wallet.current);
        assertEquals("did:test:created", wallet.ids.get("Alice").did);
        assertEquals(0, wallet.ids.get("Alice").account);
        assertEquals(0, wallet.ids.get("Alice").index);
    }

    @Test
    void resolveDidDelegatesToGatekeeper() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.resolveResponse = new MdipDocument();

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        MdipDocument resolved = keymaster.resolveDID("did:test:alice");
        assertSame(gatekeeper.resolveResponse, resolved);
        assertEquals("did:test:alice", gatekeeper.lastResolveDid);
    }

    @Test
    void updateDidBuildsSignedOperation() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.resolveResponse = buildCurrentDocFor("did:test:alice", "Signet", "v1");

        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        Keymaster keymaster = new Keymaster(store, gatekeeper, crypto, "passphrase");

        MdipDocument update = new MdipDocument();
        update.didDocument = new MdipDocument.DidDocument();
        update.didDocument.id = "did:test:alice";
        update.didDocument.controller = "did:test:alice";
        update.didDocumentData = Map.of("foo", "bar");
        update.mdip = gatekeeper.resolveResponse.mdip;
        update.didDocumentMetadata = new DocumentMetadata();
        update.didDocumentMetadata.updated = "2024-01-01T00:00:00.000Z";
        update.didResolutionMetadata = new MdipDocument.DidResolutionMetadata();

        assertTrue(keymaster.updateDID(update));

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        assertEquals("update", op.type);
        assertEquals("did:test:alice", op.did);
        assertEquals("v1", op.previd);
        assertEquals("blockhash", op.blockid);
        assertNotNull(op.doc);
        assertNull(op.doc.didDocumentMetadata);
        assertNull(op.doc.didResolutionMetadata);

        @SuppressWarnings("unchecked")
        Map<String, Object> docData = (Map<String, Object>) op.doc.didDocumentData;
        assertEquals("bar", docData.get("foo"));

        String expectedHash = crypto.hashJson(unsignedUpdate(op));
        assertEquals(expectedHash, op.signature.hash);

        JwkPair keypair = deriveKeypair();
        String expectedSig = crypto.signHash(expectedHash, keypair.privateJwk);
        assertEquals(expectedSig, op.signature.value);
        assertEquals("did:test:alice", op.signature.signer);
        assertNotNull(op.signature.signed);
    }

    @Test
    void deleteDidBuildsSignedOperation() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.resolveResponse = buildCurrentDocFor("did:test:alice", "Signet", "v1");

        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        Keymaster keymaster = new Keymaster(store, gatekeeper, crypto, "passphrase");

        assertTrue(keymaster.deleteDID("did:test:alice"));

        Operation op = gatekeeper.lastDelete;
        assertNotNull(op);
        assertEquals("delete", op.type);
        assertEquals("did:test:alice", op.did);
        assertEquals("v1", op.previd);
        assertEquals("blockhash", op.blockid);
        assertNull(op.doc);

        String expectedHash = crypto.hashJson(unsignedDelete(op));
        assertEquals(expectedHash, op.signature.hash);

        JwkPair keypair = deriveKeypair();
        String expectedSig = crypto.signHash(expectedHash, keypair.privateJwk);
        assertEquals(expectedSig, op.signature.value);
        assertEquals("did:test:alice", op.signature.signer);
        assertNotNull(op.signature.signed);
    }

    @Test
    void updateAssetMergesData() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";

        MdipDocument current = buildCurrentDocFor("did:test:asset", "Signet", "v1");
        current.mdip.type = "asset";
        current.didDocumentData = new HashMap<>();
        @SuppressWarnings("unchecked")
        Map<String, Object> currentData = (Map<String, Object>) current.didDocumentData;
        currentData.put("a", 1);
        gatekeeper.resolveResponse = current;

        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        Keymaster keymaster = new Keymaster(store, gatekeeper, crypto, "passphrase");

        Map<String, Object> update = new HashMap<>();
        update.put("b", 2);
        assertTrue(keymaster.updateAsset("did:test:asset", update));

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        assertNotNull(op.doc);
        @SuppressWarnings("unchecked")
        Map<String, Object> merged = (Map<String, Object>) op.doc.didDocumentData;
        assertEquals(1, merged.get("a"));
        assertEquals(2, merged.get("b"));
    }

    @Test
    void listAssetsReturnsOwned() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        alice.owned = new java.util.ArrayList<>();
        alice.owned.add("did:test:asset1");
        ids.put("Alice", alice);

        WalletEncFile stored = buildStoredWalletWithCounter(0, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        Keymaster keymaster = new Keymaster(store, "passphrase");
        java.util.List<String> assets = keymaster.listAssets("Alice");
        assertEquals(1, assets.size());
        assertEquals("did:test:asset1", assets.get(0));
    }

    @Test
    void transferAssetUpdatesControllerAndOwned() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        alice.owned = new java.util.ArrayList<>();
        alice.owned.add("did:test:asset1");
        ids.put("Alice", alice);

        IDInfo bob = new IDInfo();
        bob.did = "did:test:bob";
        bob.account = 1;
        bob.index = 0;
        bob.owned = new java.util.ArrayList<>();
        ids.put("Bob", bob);

        WalletEncFile stored = buildStoredWalletWithCounter(2, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";

        MdipDocument assetDoc = buildCurrentDocFor("did:test:asset1", "Signet", "v1");
        assetDoc.mdip.type = "asset";
        assetDoc.didDocument.controller = "did:test:alice";
        gatekeeper.docs.put("did:test:asset1", assetDoc);

        MdipDocument bobDoc = buildCurrentDocFor("did:test:bob", "Signet", "v1");
        gatekeeper.docs.put("did:test:bob", bobDoc);

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        assertTrue(keymaster.transferAsset("did:test:asset1", "did:test:bob"));

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        assertNotNull(op.doc);
        assertEquals("did:test:bob", op.doc.didDocument.controller);

        WalletFile wallet = keymaster.loadWallet();
        assertTrue(wallet.ids.get("Alice").owned.isEmpty());
        assertEquals(1, wallet.ids.get("Bob").owned.size());
        assertEquals("did:test:asset1", wallet.ids.get("Bob").owned.get(0));
    }

    @Test
    void createSchemaUsesAssetPayload() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:schema";
        gatekeeper.resolveResponse = buildAgentDocWithKey("did:test:alice", deriveKeypair());

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        String did = keymaster.createSchema("Signet");
        assertEquals("did:test:schema", did);

        Operation op = gatekeeper.lastCreate;
        assertNotNull(op);
        assertNotNull(op.data);
        assertEquals("create", op.type);
        assertEquals("asset", op.mdip.type);

        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) op.data;
        assertTrue(data.containsKey("schema"));
        @SuppressWarnings("unchecked")
        Map<String, Object> schema = (Map<String, Object>) data.get("schema");
        assertEquals("object", schema.get("type"));
        assertTrue(schema.containsKey("properties"));
    }

    @Test
    void getSetTestSchemaRoundTrip() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.resolveResponse = buildAgentDocWithKey("did:test:alice", deriveKeypair());

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> schema = new HashMap<>();
        schema.put("$schema", "http://json-schema.org/draft-07/schema#");
        schema.put("type", "object");
        Map<String, Object> props = new HashMap<>();
        props.put("name", Map.of("type", "string"));
        schema.put("properties", props);

        assertTrue(keymaster.setSchema("did:test:schema", schema));
        assertNotNull(gatekeeper.lastUpdate);

        MdipDocument asset = buildCurrentDocFor("did:test:schema", "Signet", "v2");
        asset.mdip.type = "asset";
        asset.didDocumentData = Map.of("schema", schema);
        gatekeeper.resolveResponse = asset;

        Object fetched = keymaster.getSchema("did:test:schema");
        assertNotNull(fetched);
        assertTrue(keymaster.testSchema("did:test:schema"));
    }

    @Test
    void createTemplateFromSchema() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.resolveResponse = buildAgentDocWithKey("did:test:alice", deriveKeypair());

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> schema = new HashMap<>();
        schema.put("$schema", "http://json-schema.org/draft-07/schema#");
        schema.put("type", "object");
        Map<String, Object> props = new HashMap<>();
        props.put("firstName", Map.of("type", "string"));
        props.put("lastName", Map.of("type", "string"));
        schema.put("properties", props);

        MdipDocument asset = buildCurrentDocFor("did:test:schema", "Signet", "v1");
        asset.mdip.type = "asset";
        asset.didDocumentData = Map.of("schema", schema);
        gatekeeper.resolveResponse = asset;

        Map<String, Object> template = keymaster.createTemplate("did:test:schema");
        assertEquals("did:test:schema", template.get("$schema"));
        assertEquals("TBD", template.get("firstName"));
        assertEquals("TBD", template.get("lastName"));
    }

    @Test
    void listSchemasFiltersAssets() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        alice.owned = new java.util.ArrayList<>();
        alice.owned.add("did:test:schema");
        alice.owned.add("did:test:asset");
        ids.put("Alice", alice);

        WalletEncFile stored = buildStoredWalletWithCounter(0, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        MdipDocument schemaDoc = buildCurrentDocFor("did:test:schema", "Signet", "v1");
        schemaDoc.mdip.type = "asset";
        schemaDoc.didDocumentData = Map.of(
            "schema",
            Map.of(
                "$schema", "http://json-schema.org/draft-07/schema#",
                "type", "object",
                "properties", Map.of("email", Map.of("type", "string"))
            )
        );
        gatekeeper.docs.put("did:test:schema", schemaDoc);

        MdipDocument assetDoc = buildCurrentDocFor("did:test:asset", "Signet", "v1");
        assetDoc.mdip.type = "asset";
        assetDoc.didDocumentData = Map.of("foo", "bar");
        gatekeeper.docs.put("did:test:asset", assetDoc);

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        java.util.List<String> schemas = keymaster.listSchemas("Alice");
        assertEquals(1, schemas.size());
        assertEquals("did:test:schema", schemas.get(0));
    }

    @Test
    void bindCredentialBuildsVerifiableCredential() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.resolveResponse = buildAgentDocWithKey("did:test:alice", deriveKeypair());

        Map<String, Object> schema = new HashMap<>();
        schema.put("$schema", "http://json-schema.org/draft-07/schema#");
        schema.put("type", "object");
        Map<String, Object> props = new HashMap<>();
        props.put("givenName", Map.of("type", "string"));
        schema.put("properties", props);

        MdipDocument asset = buildCurrentDocFor("did:test:schema", "Signet", "v1");
        asset.mdip.type = "asset";
        asset.didDocumentData = Map.of("schema", schema);
        gatekeeper.resolveResponse = asset;

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        Map<String, Object> vc = keymaster.bindCredential("did:test:schema", "did:test:subject");

        assertEquals("did:test:alice", vc.get("issuer"));
        @SuppressWarnings("unchecked")
        List<String> types = (List<String>) vc.get("type");
        assertEquals("VerifiableCredential", types.get(0));
        assertEquals("did:test:schema", types.get(1));

        @SuppressWarnings("unchecked")
        Map<String, Object> subject = (Map<String, Object>) vc.get("credentialSubject");
        assertEquals("did:test:subject", subject.get("id"));

        @SuppressWarnings("unchecked")
        Map<String, Object> credential = (Map<String, Object>) vc.get("credential");
        assertEquals("TBD", credential.get("givenName"));
    }

    @Test
    void issueCredentialEncryptsAndSigns() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair();
        MdipDocument aliceDoc = buildAgentDocWithKey("did:test:alice", aliceKeypair);

        JwkPair bobKeypair = deriveKeypair();
        MdipDocument bobDoc = buildAgentDocWithKey("did:test:bob", bobKeypair);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", aliceDoc);
        gatekeeper.docs.put("did:test:bob", bobDoc);
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:encrypted";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> credential = new HashMap<>();
        credential.put("issuer", "did:test:alice");
        credential.put("credentialSubject", Map.of("id", "did:test:bob"));
        credential.put("credential", Map.of("email", "bob@example.com"));

        String did = keymaster.issueCredential(credential);
        assertEquals("did:test:encrypted", did);

        Operation op = gatekeeper.lastCreate;
        assertNotNull(op);
        assertNotNull(op.data);

        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) op.data;
        @SuppressWarnings("unchecked")
        Map<String, Object> encrypted = (Map<String, Object>) data.get("encrypted");
        assertEquals("did:test:alice", encrypted.get("sender"));
        assertNotNull(encrypted.get("cipher_sender"));
        assertNotNull(encrypted.get("cipher_receiver"));
        assertNotNull(encrypted.get("cipher_hash"));
    }

    @Test
    void issueCredentialBindsWithOptions() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair();
        MdipDocument aliceDoc = buildAgentDocWithKey("did:test:alice", aliceKeypair);

        JwkPair bobKeypair = deriveKeypair();
        MdipDocument bobDoc = buildAgentDocWithKey("did:test:bob", bobKeypair);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", aliceDoc);
        gatekeeper.docs.put("did:test:bob", bobDoc);
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:encrypted";

        Map<String, Object> schema = new HashMap<>();
        schema.put("$schema", "http://json-schema.org/draft-07/schema#");
        schema.put("type", "object");
        Map<String, Object> props = new HashMap<>();
        props.put("email", Map.of("type", "string"));
        schema.put("properties", props);

        MdipDocument schemaDoc = buildCurrentDocFor("did:test:schema", "Signet", "v1");
        schemaDoc.mdip.type = "asset";
        schemaDoc.didDocumentData = Map.of("schema", schema);
        gatekeeper.docs.put("did:test:schema", schemaDoc);

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        IssueCredentialOptions options = new IssueCredentialOptions();
        options.schema = "did:test:schema";
        options.subject = "did:test:bob";
        options.validFrom = "2024-01-01T00:00:00.000Z";
        options.validUntil = "2025-01-01T00:00:00.000Z";

        Map<String, Object> unbound = keymaster.createTemplate("did:test:schema");
        String did = keymaster.issueCredential(unbound, options);
        assertEquals("did:test:encrypted", did);

        Operation op = gatekeeper.lastCreate;
        assertNotNull(op);
        @SuppressWarnings("unchecked")
        Map<String, Object> encrypted = (Map<String, Object>) ((Map<String, Object>) op.data).get("encrypted");
        assertNotNull(encrypted);
    }

    @Test
    void issueCredentialRejectsWrongIssuer() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        gatekeeper.resolveResponse = buildAgentDocWithKey("did:test:alice", deriveKeypair());

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        Map<String, Object> credential = new HashMap<>();
        credential.put("issuer", "did:test:other");
        credential.put("credentialSubject", Map.of("id", "did:test:alice"));
        credential.put("credential", Map.of("email", "a@example.com"));

        try {
            keymaster.issueCredential(credential);
            throw new IllegalStateException("expected exception");
        } catch (IllegalArgumentException e) {
            assertEquals("credential.issuer", e.getMessage());
        }
    }

    @Test
    void encryptDecryptJsonRoundTrip() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        IDInfo bob = new IDInfo();
        bob.did = "did:test:bob";
        bob.account = 1;
        bob.index = 0;
        ids.put("Bob", bob);

        WalletEncFile stored = buildStoredWalletWithCounter(2, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put("did:test:bob", buildAgentDocWithKey("did:test:bob", bobKeypair));
        gatekeeper.createResponse = "did:test:encrypted";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        Map<String, Object> payload = Map.of("foo", "bar");
        String did = keymaster.encryptJSON(payload, "did:test:bob");

        keymaster.mutateWallet(wallet -> wallet.current = "Bob");
        Object decrypted = keymaster.decryptJSON(did);
        assertTrue(decrypted instanceof Map<?, ?>);
        @SuppressWarnings("unchecked")
        Map<String, Object> decryptedMap = (Map<String, Object>) decrypted;
        assertEquals("bar", decryptedMap.get("foo"));
    }

    @Test
    void getCredentialReturnsVerifiableCredential() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair();
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.createResponse = "did:test:vc";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc = new HashMap<>();
        vc.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc.put("issuer", "did:test:alice");
        vc.put("credentialSubject", Map.of("id", "did:test:alice"));
        vc.put("credential", Map.of("email", "alice@example.com"));

        String did = keymaster.encryptJSON(vc, "did:test:alice");
        Map<String, Object> fetched = keymaster.getCredential(did);
        assertNotNull(fetched);
        assertEquals("did:test:alice", fetched.get("issuer"));
    }

    @Test
    void getCredentialReturnsNullForNonCredential() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair();
        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.createResponse = "did:test:blob";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        String did = keymaster.encryptJSON(Map.of("foo", "bar"), "did:test:alice");
        Map<String, Object> fetched = keymaster.getCredential(did);
        assertEquals(null, fetched);
    }

    @Test
    void acceptCredentialAddsToHeld() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        IDInfo bob = new IDInfo();
        bob.did = "did:test:bob";
        bob.account = 1;
        bob.index = 0;
        ids.put("Bob", bob);

        WalletEncFile stored = buildStoredWalletWithCounter(2, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put("did:test:bob", buildAgentDocWithKey("did:test:bob", bobKeypair));
        gatekeeper.createResponse = "did:test:cred";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc = new HashMap<>();
        vc.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc.put("issuer", "did:test:alice");
        vc.put("credentialSubject", Map.of("id", "did:test:bob"));
        vc.put("credential", Map.of("email", "bob@example.com"));

        String did = keymaster.encryptJSON(vc, "did:test:bob");

        keymaster.mutateWallet(wallet -> wallet.current = "Bob");
        assertTrue(keymaster.acceptCredential(did));

        WalletFile wallet = keymaster.loadWallet();
        assertNotNull(wallet.ids.get("Bob").held);
        assertEquals(1, wallet.ids.get("Bob").held.size());
        assertEquals(did, wallet.ids.get("Bob").held.get(0));
    }

    @Test
    void acceptCredentialRejectsWrongSubject() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        IDInfo bob = new IDInfo();
        bob.did = "did:test:bob";
        bob.account = 1;
        bob.index = 0;
        ids.put("Bob", bob);

        WalletEncFile stored = buildStoredWalletWithCounter(2, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put("did:test:bob", buildAgentDocWithKey("did:test:bob", bobKeypair));
        gatekeeper.createResponse = "did:test:cred";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc = new HashMap<>();
        vc.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc.put("issuer", "did:test:alice");
        vc.put("credentialSubject", Map.of("id", "did:test:bob"));
        vc.put("credential", Map.of("email", "bob@example.com"));

        String did = keymaster.encryptJSON(vc, "did:test:bob");

        // Alice is current ID and is not the subject
        assertEquals("Alice", keymaster.loadWallet().current);
        assertEquals(false, keymaster.acceptCredential(did));
    }

    @Test
    void listCredentialsReturnsHeld() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        WalletEncFile stored = buildStoredWalletWithCounter(1, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        Keymaster keymaster = new Keymaster(store, "passphrase");
        keymaster.addToHeld("did:test:cred1");
        keymaster.addToHeld("did:test:cred2");

        List<String> held = keymaster.listCredentials(null);
        assertEquals(2, held.size());
        assertEquals(true, held.contains("did:test:cred1"));
        assertEquals(true, held.contains("did:test:cred2"));
    }

    @Test
    void removeCredentialRemovesHeldEntry() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        WalletEncFile stored = buildStoredWalletWithCounter(1, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        Keymaster keymaster = new Keymaster(store, "passphrase");
        keymaster.addToHeld("did:test:cred1");
        assertEquals(true, keymaster.removeCredential("did:test:cred1"));
        assertEquals(0, keymaster.listCredentials(null).size());
    }

    @Test
    void listIssuedFiltersByIssuer() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put("did:test:bob", buildAgentDocWithKey("did:test:bob", bobKeypair));
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc1 = new HashMap<>();
        vc1.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc1.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc1.put("issuer", "did:test:alice");
        vc1.put("credentialSubject", Map.of("id", "did:test:bob"));
        vc1.put("credential", Map.of("email", "bob@example.com"));
        gatekeeper.createResponse = "did:test:cred1";
        String did1 = keymaster.encryptJSON(vc1, "did:test:bob");

        Map<String, Object> vc2 = new HashMap<>();
        vc2.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc2.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc2.put("issuer", "did:test:bob");
        vc2.put("credentialSubject", Map.of("id", "did:test:bob"));
        vc2.put("credential", Map.of("email", "bob2@example.com"));
        gatekeeper.createResponse = "did:test:cred2";
        String did2 = keymaster.encryptJSON(vc2, "did:test:bob");

        List<String> issued = keymaster.listIssued(null);
        assertEquals(1, issued.size());
        assertEquals(true, issued.contains(did1));
        assertEquals(false, issued.contains(did2));
    }

    @Test
    void updateCredentialReencryptsPayload() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put("did:test:bob", buildAgentDocWithKey("did:test:bob", bobKeypair));
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:cred";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc = new HashMap<>();
        vc.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc.put("issuer", "did:test:alice");
        vc.put("credentialSubject", Map.of("id", "did:test:bob"));
        vc.put("credential", Map.of("email", "bob@example.com"));

        String did = keymaster.encryptJSON(vc, "did:test:bob");

        Map<String, Object> updated = new HashMap<>(vc);
        updated.put("credential", Map.of("email", "bob-updated@example.com"));
        assertTrue(keymaster.updateCredential(did, updated));

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        assertNotNull(op.doc);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) op.doc.didDocumentData;
        @SuppressWarnings("unchecked")
        Map<String, Object> encrypted = (Map<String, Object>) data.get("encrypted");
        assertEquals("did:test:alice", encrypted.get("sender"));
        assertNotNull(encrypted.get("cipher_sender"));
        assertNotNull(encrypted.get("cipher_receiver"));
        assertNotNull(encrypted.get("cipher_hash"));
    }

    @Test
    void publishCredentialAddsManifestEntry() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        IDInfo bob = new IDInfo();
        bob.did = "did:test:bob";
        bob.account = 1;
        bob.index = 0;
        ids.put("Bob", bob);

        WalletEncFile stored = buildStoredWalletWithCounter(2, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put("did:test:bob", buildAgentDocWithKey("did:test:bob", bobKeypair));
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:cred";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc = new HashMap<>();
        vc.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc.put("issuer", "did:test:alice");
        vc.put("credentialSubject", Map.of("id", "did:test:bob"));
        vc.put("credential", Map.of("email", "bob@example.com"));

        String did = keymaster.encryptJSON(vc, "did:test:bob");

        keymaster.mutateWallet(wallet -> wallet.current = "Bob");
        Map<String, Object> published = keymaster.publishCredential(did, false);
        assertNotNull(published);
        assertEquals(null, published.get("credential"));

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) op.doc.didDocumentData;
        @SuppressWarnings("unchecked")
        Map<String, Object> manifest = (Map<String, Object>) data.get("manifest");
        assertNotNull(manifest.get(did));
    }

    @Test
    void unpublishCredentialRemovesManifestEntry() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = "did:test:alice";
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        IDInfo bob = new IDInfo();
        bob.did = "did:test:bob";
        bob.account = 1;
        bob.index = 0;
        ids.put("Bob", bob);

        WalletEncFile stored = buildStoredWalletWithCounter(2, ids, "Bob");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";

        MdipDocument bobDoc = buildCurrentDocFor("did:test:bob", "Signet", "v1");
        Map<String, Object> manifest = new HashMap<>();
        manifest.put("did:test:cred", Map.of("issuer", "did:test:alice"));
        bobDoc.didDocumentData = new HashMap<>();
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) bobDoc.didDocumentData;
        data.put("manifest", manifest);
        gatekeeper.docs.put("did:test:bob", bobDoc);

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        String message = keymaster.unpublishCredential("did:test:cred");
        assertEquals("OK credential did:test:cred removed from manifest", message);

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        @SuppressWarnings("unchecked")
        Map<String, Object> updatedData = (Map<String, Object>) op.doc.didDocumentData;
        @SuppressWarnings("unchecked")
        Map<String, Object> updatedManifest = (Map<String, Object>) updatedData.get("manifest");
        assertEquals(false, updatedManifest.containsKey("did:test:cred"));
    }

    @Test
    void revokeCredentialRemovesOwnedEntry() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put("did:test:bob", buildAgentDocWithKey("did:test:bob", bobKeypair));
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:cred";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc = new HashMap<>();
        vc.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc.put("issuer", "did:test:alice");
        vc.put("credentialSubject", Map.of("id", "did:test:bob"));
        vc.put("credential", Map.of("email", "bob@example.com"));

        String did = keymaster.encryptJSON(vc, "did:test:bob");
        WalletFile wallet = keymaster.loadWallet();
        assertEquals(true, wallet.ids.get("Alice").owned.contains(did));

        assertTrue(keymaster.revokeCredential(did));
        assertNotNull(gatekeeper.lastDelete);
        assertEquals(did, gatekeeper.lastDelete.did);

        WalletFile updated = keymaster.loadWallet();
        assertEquals(false, updated.ids.get("Alice").owned.contains(did));
    }

    @Test
    void sendCredentialCreatesNoticeAsset() {
        String aliceDid = "did:test:QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2o7";
        String bobDid = "did:test:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
        String credentialDid = "did:test:bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo alice = new IDInfo();
        alice.did = aliceDid;
        alice.account = 0;
        alice.index = 0;
        ids.put("Alice", alice);

        WalletEncFile stored = buildStoredWalletWithCounter(1, ids, "Alice");
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put(aliceDid, buildAgentDocWithKey(aliceDid, aliceKeypair));
        gatekeeper.docs.put(bobDid, buildAgentDocWithKey(bobDid, bobKeypair));
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> vc = new HashMap<>();
        vc.put("@context", List.of("https://www.w3.org/ns/credentials/v2"));
        vc.put("type", List.of("VerifiableCredential", "did:test:schema"));
        vc.put("issuer", aliceDid);
        vc.put("credentialSubject", Map.of("id", bobDid));
        vc.put("credential", Map.of("email", "bob@example.com"));

        gatekeeper.createResponse = credentialDid;
        String encryptedDid = keymaster.encryptJSON(vc, bobDid);

        gatekeeper.createResponse = bobDid;
        String noticeDid = keymaster.sendCredential(encryptedDid);
        assertEquals(bobDid, noticeDid);

        Operation op = gatekeeper.lastCreate;
        assertNotNull(op);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) op.data;
        @SuppressWarnings("unchecked")
        Map<String, Object> notice = (Map<String, Object>) data.get("notice");
        assertEquals(List.of(bobDid), notice.get("to"));
        assertEquals(List.of(encryptedDid), notice.get("dids"));
    }

    @Test
    void createNoticeBuildsNoticeAsset() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        String bobDid = "did:test:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
        String credDid = "did:test:bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put(bobDid, buildAgentDocWithKey(bobDid, bobKeypair));
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:notice";

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> message = new HashMap<>();
        message.put("to", List.of(bobDid));
        message.put("dids", List.of(credDid));

        String did = keymaster.createNotice(message);
        assertEquals("did:test:notice", did);

        Operation op = gatekeeper.lastCreate;
        assertNotNull(op);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) op.data;
        @SuppressWarnings("unchecked")
        Map<String, Object> notice = (Map<String, Object>) data.get("notice");
        assertEquals(List.of(bobDid), notice.get("to"));
        assertEquals(List.of(credDid), notice.get("dids"));
    }

    @Test
    void updateNoticeUpdatesAsset() {
        WalletEncFile stored = buildStoredWallet();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        String bobDid = "did:test:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
        String credDid = "did:test:bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

        JwkPair aliceKeypair = deriveKeypair(0, 0);
        JwkPair bobKeypair = deriveKeypair(1, 0);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.docs.put("did:test:alice", buildAgentDocWithKey("did:test:alice", aliceKeypair));
        gatekeeper.docs.put(bobDid, buildAgentDocWithKey(bobDid, bobKeypair));
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";

        MdipDocument noticeDoc = buildCurrentDocFor("did:test:notice", "Signet", "v1");
        noticeDoc.mdip.type = "asset";
        noticeDoc.didDocumentData = Map.of("notice", Map.of("to", List.of("did:test:alice"), "dids", List.of("did:test:old")));
        gatekeeper.docs.put("did:test:notice", noticeDoc);

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

        Map<String, Object> message = new HashMap<>();
        message.put("to", List.of(bobDid));
        message.put("dids", List.of(credDid));

        assertTrue(keymaster.updateNotice("did:test:notice", message));

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) op.doc.didDocumentData;
        @SuppressWarnings("unchecked")
        Map<String, Object> notice = (Map<String, Object>) data.get("notice");
        assertEquals(List.of(bobDid), notice.get("to"));
        assertEquals(List.of(credDid), notice.get("dids"));
    }

    @Test
    void getBlockDelegatesToGatekeeper() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        GatekeeperRecorder gatekeeper = new GatekeeperRecorder();
        BlockInfo block = new BlockInfo();
        block.hash = "hash";
        gatekeeper.blockResponse = block;

        Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
        BlockInfo resolved = keymaster.getBlock("Signet");
        assertSame(block, resolved);
        assertEquals("Signet", gatekeeper.lastBlockRegistry);
    }

    @Test
    void roundTripCreateResolveUpdate() {
        WalletEncFile stored = buildStoredWalletWithCounter(0, new HashMap<>(), null);
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        store.saveWallet(stored, true);

        GatekeeperStateful gatekeeper = new GatekeeperStateful();
        gatekeeper.blockResponse = new BlockInfo();
        gatekeeper.blockResponse.hash = "blockhash";
        gatekeeper.createResponse = "did:test:roundtrip";
        gatekeeper.docs.put(
            "did:test:roundtrip",
            buildCurrentDocFor("did:test:roundtrip", "Signet", "v1")
        );

        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        Keymaster keymaster = new Keymaster(store, gatekeeper, crypto, "passphrase");

        String did = keymaster.createId("Alice", "Signet");
        assertEquals("did:test:roundtrip", did);
        assertNotNull(gatekeeper.lastCreate);

        MdipDocument resolved = keymaster.resolveDID(did);
        assertSame(gatekeeper.docs.get(did), resolved);

        MdipDocument update = new MdipDocument();
        update.didDocument = new MdipDocument.DidDocument();
        update.didDocument.id = did;
        update.didDocument.controller = did;
        update.didDocumentData = Map.of("hello", "world");
        update.mdip = gatekeeper.docs.get(did).mdip;

        assertTrue(keymaster.updateDID(update));

        Operation op = gatekeeper.lastUpdate;
        assertNotNull(op);
        assertEquals("update", op.type);
        assertEquals(did, op.did);
        assertEquals("v1", op.previd);
        assertEquals("blockhash", op.blockid);

        String expectedHash = crypto.hashJson(unsignedUpdate(op));
        assertEquals(expectedHash, op.signature.hash);

        JwkPair keypair = deriveKeypair();
        String expectedSig = crypto.signHash(expectedHash, keypair.privateJwk);
        assertEquals(expectedSig, op.signature.value);
        assertEquals(did, op.signature.signer);
    }

    private static WalletEncFile buildStoredWallet() {
        HashMap<String, IDInfo> ids = new HashMap<>();
        IDInfo id = new IDInfo();
        id.did = "did:test:alice";
        id.account = 0;
        id.index = 0;
        ids.put("Alice", id);
        return buildStoredWalletWithCounter(0, ids, "Alice");
    }

    private static WalletEncFile buildStoredWalletWithCounter(
        int counter,
        HashMap<String, IDInfo> ids,
        String current
    ) {
        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.counter = counter;
        wallet.ids = ids;
        wallet.names = new HashMap<>();
        wallet.current = current;

        Seed seed = new Seed();
        seed.mnemonicEnc = MnemonicEncryption.encrypt(MNEMONIC, "passphrase");
        wallet.seed = seed;

        WalletCrypto walletCrypto = new WalletCrypto("passphrase");
        return walletCrypto.encryptForStorage(wallet);
    }

    private static JwkPair deriveKeypair() {
        return deriveKeypair(0, 0);
    }

    private static JwkPair deriveKeypair(int account, int index) {
        var master = HdKeyUtil.masterFromMnemonic(MNEMONIC);
        var derived = HdKeyUtil.derivePath(master, account, index);
        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        return crypto.generateJwk(HdKeyUtil.privateKeyBytes(derived));
    }

    private static MdipDocument buildCurrentDocFor(String did, String registry, String versionId) {
        MdipDocument current = new MdipDocument();
        current.didDocument = new MdipDocument.DidDocument();
        current.didDocument.id = did;
        current.didDocument.controller = did;

        Mdip mdip = new Mdip();
        mdip.registry = registry;
        mdip.type = "agent";
        mdip.version = 1;
        current.mdip = mdip;

        DocumentMetadata metadata = new DocumentMetadata();
        metadata.versionId = versionId;
        current.didDocumentMetadata = metadata;
        return current;
    }

    private static MdipDocument buildAgentDocWithKey(String did, JwkPair keypair) {
        MdipDocument doc = buildCurrentDocFor(did, "Signet", "v1");
        MdipDocument.VerificationMethod method = new MdipDocument.VerificationMethod();
        method.id = "#key-1";
        method.controller = did;
        method.type = "EcdsaSecp256k1";
        method.publicKeyJwk = JwkConverter.toEcdsaJwkPublic(keypair.publicJwk);
        doc.didDocument.verificationMethod = java.util.List.of(method);
        doc.didDocument.authentication = java.util.List.of("#key-1");
        return doc;
    }

    private static Operation unsignedUpdate(Operation op) {
        Operation unsigned = new Operation();
        unsigned.type = op.type;
        unsigned.did = op.did;
        unsigned.previd = op.previd;
        unsigned.blockid = op.blockid;
        unsigned.doc = op.doc;
        return unsigned;
    }

    private static Operation unsignedDelete(Operation op) {
        Operation unsigned = new Operation();
        unsigned.type = op.type;
        unsigned.did = op.did;
        unsigned.previd = op.previd;
        unsigned.blockid = op.blockid;
        return unsigned;
    }

    private static ObjectMapper mapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
        return mapper;
    }

    private static JsonNode loadOperations(ObjectMapper mapper) throws Exception {
        try (InputStream input = KeymasterTest.class.getResourceAsStream("/vectors/operations-v1.json")) {
            assertNotNull(input, "operations-v1.json should be present in test resources");
            return mapper.readTree(input);
        }
    }

    private static class CountingCrypto extends KeymasterCryptoImpl {
        int decryptCount = 0;

        @Override
        public String decryptMessage(org.keychain.crypto.JwkPublic pubKey, org.keychain.crypto.JwkPrivate privKey, String ciphertextB64Url) {
            decryptCount += 1;
            return super.decryptMessage(pubKey, privKey, ciphertextB64Url);
        }
    }

}
