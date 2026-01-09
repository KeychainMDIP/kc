package org.keychain.keymaster;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.function.Consumer;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import org.bitcoinj.crypto.DeterministicKey;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import java.util.ArrayList;
import java.util.List;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.EcdsaJwkPublic;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletStore;
import org.keychain.keymaster.store.WalletJsonMapper;

public class Keymaster {
    private static final DateTimeFormatter ISO_MILLIS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final String DEFAULT_REGISTRY = "hyperswarm";
    private final KeymasterWalletManager walletManager;
    private final KeymasterCrypto crypto;
    private final String passphrase;
    private final GatekeeperClient gatekeeper;
    private final OperationFactory operationFactory;

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperClient gatekeeper,
        KeymasterCrypto crypto,
        OperationFactory operationFactory,
        String passphrase
    ) {
        if (store == null) {
            throw new IllegalArgumentException("store is required");
        }
        if (crypto == null) {
            throw new IllegalArgumentException("crypto is required");
        }
        if (operationFactory == null) {
            throw new IllegalArgumentException("operationFactory is required");
        }
        if (passphrase == null || passphrase.isEmpty()) {
            throw new IllegalArgumentException("passphrase is required");
        }

        this.crypto = crypto;
        this.passphrase = passphrase;
        this.gatekeeper = gatekeeper;
        this.operationFactory = operationFactory;
        this.walletManager = new KeymasterWalletManager(store, crypto, passphrase);
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperClient gatekeeper,
        KeymasterCrypto crypto,
        String passphrase
    ) {
        this(store, gatekeeper, crypto, new OperationFactory(crypto), passphrase);
    }

    public Keymaster(WalletStore<WalletEncFile> store, KeymasterCrypto crypto, String passphrase) {
        this(store, null, crypto, passphrase);
    }

    public Keymaster(WalletStore<WalletEncFile> store, GatekeeperClient gatekeeper, String passphrase) {
        this(store, gatekeeper, new KeymasterCryptoImpl(), passphrase);
    }

    public Keymaster(WalletStore<WalletEncFile> store, String passphrase) {
        this(store, null, new KeymasterCryptoImpl(), passphrase);
    }

    public WalletFile loadWallet() {
        return walletManager.loadWallet();
    }

    public boolean saveWallet(WalletFile wallet, boolean overwrite) {
        return walletManager.saveWallet(wallet, overwrite);
    }

    public boolean mutateWallet(Consumer<WalletFile> mutator) {
        return walletManager.mutateWallet(mutator);
    }

    public WalletFile newWallet(String mnemonic, boolean overwrite) {
        String phrase = mnemonic != null ? mnemonic : crypto.generateMnemonic();

        Seed seed = new Seed();
        seed.mnemonicEnc = MnemonicEncryption.encrypt(phrase, passphrase);

        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.seed = seed;
        wallet.counter = 0;
        wallet.ids = new HashMap<>();

        boolean ok = saveWallet(wallet, overwrite);
        if (!ok) {
            throw new IllegalStateException("save wallet failed");
        }

        return wallet;
    }

    public String decryptMnemonic() {
        WalletFile wallet = loadWallet();
        if (wallet == null || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalStateException("wallet mnemonic not available");
        }
        return MnemonicEncryption.decrypt(wallet.seed.mnemonicEnc, passphrase);
    }

    public String createId(String name, String registry) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("registry is required");
        }

        final String[] createdDid = new String[1];
        walletManager.mutateWallet(wallet -> {
            if (wallet.ids != null && wallet.ids.containsKey(name)) {
                throw new IllegalArgumentException("name already exists");
            }

            int account = wallet.counter;
            int index = 0;
            JwkPair keypair = getCurrentKeypairFromPath(wallet, account, index);

            BlockInfo block = gatekeeper.getBlock(registry);
            String blockid = block != null ? block.hash : null;

            Operation signed = operationFactory.createSignedCreateIdOperation(
                registry,
                JwkConverter.toEcdsaJwkPublic(keypair.publicJwk),
                keypair.privateJwk,
                blockid
            );

            String did = gatekeeper.createDID(signed);
            createdDid[0] = did;

            IDInfo idInfo = new IDInfo();
            idInfo.did = did;
            idInfo.account = account;
            idInfo.index = index;

            wallet.ids.put(name, idInfo);
            wallet.counter = account + 1;
            wallet.current = name;
        });

        return createdDid[0];
    }

    public String createAsset(Object data, String registry) {
        return createAsset(data, registry, null, null);
    }

    public String createAsset(Object data, String registry, String controllerDid, String validUntil) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("registry is required");
        }

        WalletFile wallet = loadWallet();
        IDInfo idInfo = controllerDid != null ? fetchIdInfo(controllerDid, wallet) : fetchIdInfo(null, wallet);
        String signerDid = idInfo.did;
        JwkPair keypair = fetchKeyPair(signerDid);
        if (keypair == null) {
            throw new IllegalStateException("no keypair available for controller");
        }
        BlockInfo block = gatekeeper.getBlock(registry);
        String blockid = block != null ? block.hash : null;

        Operation signed = operationFactory.createSignedCreateAssetOperation(
            registry,
            signerDid,
            data,
            blockid,
            validUntil,
            keypair.privateJwk,
            signerDid
        );

        String did = gatekeeper.createDID(signed);
        if (validUntil == null) {
            String createdDid = did;
            walletManager.mutateWallet(updated -> {
                IDInfo current = getCurrentIdInfo(updated);
                if (current.owned == null) {
                    current.owned = new ArrayList<>();
                }
                List<String> owned = current.owned;
                if (!owned.contains(createdDid)) {
                    owned.add(createdDid);
                }
            });
        }
        return did;
    }

    public String createSchema(String registry) {
        return createSchema(null, registry);
    }

    public String createSchema(Object schema, String registry) {
        if (schema == null) {
            schema = defaultSchema();
        }
        if (!validateSchema(schema)) {
            throw new IllegalArgumentException("schema is invalid");
        }
        java.util.Map<String, Object> data = new java.util.HashMap<>();
        data.put("schema", schema);
        return createAsset(data, registry);
    }

    public Object getSchema(String did) {
        MdipDocument doc = resolveAsset(did);
        if (doc == null) {
            return null;
        }
        Object data = doc.didDocumentData;
        if (data instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> map = (java.util.Map<String, Object>) data;
            if (map.containsKey("schema")) {
                return map.get("schema");
            }
            // legacy schemas stored directly
            if (map.containsKey("properties")) {
                return map;
            }
        }
        return null;
    }

    public boolean setSchema(String did, Object schema) {
        if (!validateSchema(schema)) {
            throw new IllegalArgumentException("schema is invalid");
        }
        java.util.Map<String, Object> data = new java.util.HashMap<>();
        data.put("schema", schema);
        return updateAsset(did, data);
    }

    public boolean testSchema(String did) {
        try {
            Object schema = getSchema(did);
            if (!(schema instanceof java.util.Map<?, ?>)) {
                return false;
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> map = (java.util.Map<String, Object>) schema;
            if (map.isEmpty()) {
                return false;
            }
            return validateSchema(schema);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public java.util.Map<String, Object> createTemplate(String schemaId) {
        if (!testSchema(schemaId)) {
            throw new IllegalArgumentException("schemaId");
        }
        Object schema = getSchema(schemaId);
        java.util.Map<String, Object> template = generateSchema(schema);
        template.put("$schema", schemaId);
        return template;
    }

    public java.util.List<String> listSchemas(String ownerDid) {
        java.util.List<String> assets = listAssets(ownerDid);
        java.util.List<String> schemas = new java.util.ArrayList<>();
        for (String did : assets) {
            if (testSchema(did)) {
                schemas.add(did);
            }
        }
        return schemas;
    }

    public java.util.Map<String, Object> bindCredential(String schemaId, String subjectId) {
        return bindCredential(schemaId, subjectId, null, null, null);
    }

    public java.util.Map<String, Object> bindCredential(
        String schemaId,
        String subjectId,
        String validFrom,
        String validUntil,
        java.util.Map<String, Object> credential
    ) {
        if (schemaId == null || schemaId.isBlank()) {
            throw new IllegalArgumentException("schemaId");
        }
        if (subjectId == null || subjectId.isBlank()) {
            throw new IllegalArgumentException("subjectId");
        }

        String from = validFrom != null ? validFrom : nowIso();
        String type = lookupDID(schemaId);
        String subjectDid = lookupDID(subjectId);
        IDInfo issuer = fetchIdInfo(null);

        java.util.Map<String, Object> boundCredential = credential;
        if (boundCredential == null) {
            Object schema = getSchema(type);
            boundCredential = generateSchema(schema);
        }

        java.util.Map<String, Object> subject = new java.util.LinkedHashMap<>();
        subject.put("id", subjectDid);

        java.util.List<String> types = new java.util.ArrayList<>();
        types.add("VerifiableCredential");
        types.add(type);

        java.util.List<String> context = new java.util.ArrayList<>();
        context.add("https://www.w3.org/ns/credentials/v2");
        context.add("https://www.w3.org/ns/credentials/examples/v2");

        java.util.Map<String, Object> vc = new java.util.LinkedHashMap<>();
        vc.put("@context", context);
        vc.put("type", types);
        vc.put("issuer", issuer.did);
        vc.put("validFrom", from);
        if (validUntil != null) {
            vc.put("validUntil", validUntil);
        }
        vc.put("credentialSubject", subject);
        vc.put("credential", boundCredential);

        return vc;
    }

    public String issueCredential(java.util.Map<String, Object> credential) {
        return issueCredential(credential, null);
    }

    public String issueCredential(java.util.Map<String, Object> credential, IssueCredentialOptions options) {
        if (credential == null) {
            throw new IllegalArgumentException("credential is required");
        }

        java.util.Map<String, Object> bound = credential;
        if (options != null && options.schema != null && options.subject != null) {
            bound = bindCredential(
                options.schema,
                options.subject,
                options.validFrom,
                options.validUntil,
                credential
            );
        }

        Object issuer = bound.get("issuer");
        IDInfo current = fetchIdInfo(null);
        if (issuer == null || !issuer.equals(current.did)) {
            throw new IllegalArgumentException("credential.issuer");
        }

        java.util.Map<String, Object> signed = addSignature(bound, null);
        Object subjectObj = signed.get("credentialSubject");
        if (!(subjectObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("credential.credentialSubject.id");
        }

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
        Object subjectId = subject.get("id");
        if (!(subjectId instanceof String) || ((String) subjectId).isBlank()) {
            throw new IllegalArgumentException("credential.credentialSubject.id");
        }

        return encryptJSON(signed, (String) subjectId, true);
    }

    public MdipDocument resolveDID(String did) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        return gatekeeper.resolveDID(did, null);
    }

    public String lookupDID(String nameOrDid) {
        if (nameOrDid == null || nameOrDid.isBlank()) {
            throw new IllegalArgumentException("name or did is required");
        }
        if (nameOrDid.startsWith("did:")) {
            return nameOrDid;
        }

        WalletFile wallet = loadWallet();
        if (wallet != null && wallet.names != null && wallet.names.containsKey(nameOrDid)) {
            return wallet.names.get(nameOrDid);
        }
        if (wallet != null && wallet.ids != null && wallet.ids.containsKey(nameOrDid)) {
            return wallet.ids.get(nameOrDid).did;
        }

        throw new IllegalArgumentException("unknown id");
    }

    public MdipDocument resolveAsset(String did) {
        MdipDocument doc = resolveDID(did);
        if (doc == null || doc.mdip == null || !"asset".equals(doc.mdip.type)) {
            throw new IllegalArgumentException("did is not an asset");
        }
        return doc;
    }

    public boolean updateAsset(String did, java.util.Map<String, Object> data) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }

        MdipDocument doc = resolveDID(did);
        java.util.Map<String, Object> merged = new java.util.HashMap<>();
        Object currentData = doc.didDocumentData;
        if (currentData instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> current = (java.util.Map<String, Object>) currentData;
            merged.putAll(current);
        }
        merged.putAll(data);
        doc.didDocumentData = merged;
        return updateDID(doc);
    }

    public boolean transferAsset(String assetDid, String controllerDid) {
        if (assetDid == null || assetDid.isBlank()) {
            throw new IllegalArgumentException("asset did is required");
        }
        if (controllerDid == null || controllerDid.isBlank()) {
            throw new IllegalArgumentException("controller did is required");
        }

        MdipDocument assetDoc = resolveDID(assetDid);
        if (assetDoc.mdip == null || !"asset".equals(assetDoc.mdip.type)) {
            throw new IllegalArgumentException("asset did is not an asset");
        }
        if (assetDoc.didDocument == null || assetDoc.didDocument.id == null) {
            throw new IllegalArgumentException("asset didDocument is missing");
        }

        MdipDocument controllerDoc = resolveDID(controllerDid);
        if (controllerDoc.mdip == null || !"agent".equals(controllerDoc.mdip.type)) {
            throw new IllegalArgumentException("controller did is not an agent");
        }

        String prevOwner = assetDoc.didDocument.controller;
        if (controllerDid.equals(prevOwner)) {
            return true;
        }

        assetDoc.didDocument.controller = controllerDoc.didDocument != null
            ? controllerDoc.didDocument.id
            : controllerDid;

        boolean ok = updateDID(assetDoc);
        if (ok && prevOwner != null) {
            removeFromOwned(assetDid, prevOwner);
            try {
                addToOwned(assetDid, controllerDid);
            } catch (IllegalArgumentException ignored) {
                // controller not in wallet
            }
        }

        return ok;
    }

    public java.util.List<String> listAssets(String ownerDid) {
        IDInfo idInfo = fetchIdInfo(ownerDid);
        return idInfo.owned != null ? idInfo.owned : java.util.Collections.emptyList();
    }

    private static boolean validateSchema(Object schema) {
        try {
            generateSchema(schema);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static java.util.Map<String, Object> generateSchema(Object schema) {
        if (!(schema instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("schema");
        }

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> schemaMap = (java.util.Map<String, Object>) schema;
        Object propsObj = schemaMap.get("properties");
        if (schemaMap.get("$schema") == null || propsObj == null) {
            throw new IllegalArgumentException("schema");
        }
        if (!(propsObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("schema");
        }

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> props = (java.util.Map<String, Object>) propsObj;
        java.util.Map<String, Object> template = new java.util.LinkedHashMap<>();
        for (String key : props.keySet()) {
            template.put(key, "TBD");
        }
        return template;
    }

    private static java.util.Map<String, Object> defaultSchema() {
        java.util.Map<String, Object> root = new java.util.LinkedHashMap<>();
        root.put("$schema", "http://json-schema.org/draft-07/schema#");
        root.put("type", "object");

        java.util.Map<String, Object> properties = new java.util.LinkedHashMap<>();
        java.util.Map<String, Object> propertyName = new java.util.LinkedHashMap<>();
        propertyName.put("type", "string");
        properties.put("propertyName", propertyName);
        root.put("properties", properties);

        java.util.List<String> required = new java.util.ArrayList<>();
        required.add("propertyName");
        root.put("required", required);
        return root;
    }

    private static String nowIso() {
        return ISO_MILLIS.format(Instant.now());
    }

    private java.util.Map<String, Object> addSignature(
        java.util.Map<String, Object> obj,
        String controllerDid
    ) {
        if (obj == null) {
            throw new IllegalArgumentException("obj");
        }

        IDInfo id = fetchIdInfo(controllerDid);
        JwkPair keypair = fetchKeyPair(controllerDid);
        if (keypair == null) {
            throw new IllegalArgumentException("addSignature: no keypair");
        }

        java.util.Map<String, Object> unsigned = new java.util.LinkedHashMap<>(obj);
        unsigned.remove("signature");

        String msgHash = crypto.hashJson(unsigned);
        String signatureValue = crypto.signHash(msgHash, keypair.privateJwk);

        java.util.Map<String, Object> signature = new java.util.LinkedHashMap<>();
        signature.put("signer", id.did);
        signature.put("signed", nowIso());
        signature.put("hash", msgHash);
        signature.put("value", signatureValue);

        java.util.Map<String, Object> signed = new java.util.LinkedHashMap<>(unsigned);
        signed.put("signature", signature);
        return signed;
    }

    private String encryptJSON(Object json, String receiverDid, boolean includeHash) {
        String plaintext;
        try {
            plaintext = WalletJsonMapper.mapper().writeValueAsString(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("json");
        }
        return encryptMessage(plaintext, receiverDid, includeHash);
    }

    private String encryptMessage(String msg, String receiverDid, boolean includeHash) {
        if (receiverDid == null || receiverDid.isBlank()) {
            throw new IllegalArgumentException("receiver did is required");
        }
        IDInfo sender = fetchIdInfo(null);
        JwkPair senderKeypair = fetchKeyPair(null);
        if (senderKeypair == null) {
            throw new IllegalArgumentException("no valid sender keypair");
        }

        ResolveDIDOptions options = new ResolveDIDOptions();
        options.confirm = true;
        MdipDocument doc = gatekeeper.resolveDID(receiverDid, options);
        EcdsaJwkPublic receiverJwk = getPublicKeyJwk(doc);
        org.keychain.crypto.JwkPublic receiverCrypto = new org.keychain.crypto.JwkPublic(
            receiverJwk.kty,
            receiverJwk.crv,
            receiverJwk.x,
            receiverJwk.y
        );

        String cipherSender = crypto.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg);
        String cipherReceiver = crypto.encryptMessage(receiverCrypto, senderKeypair.privateJwk, msg);
        String cipherHash = includeHash ? crypto.hashMessage(msg) : null;

        java.util.Map<String, Object> encrypted = new java.util.LinkedHashMap<>();
        encrypted.put("sender", sender.did);
        encrypted.put("created", nowIso());
        if (cipherHash != null) {
            encrypted.put("cipher_hash", cipherHash);
        }
        encrypted.put("cipher_sender", cipherSender);
        encrypted.put("cipher_receiver", cipherReceiver);

        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("encrypted", encrypted);
        return createAsset(payload, DEFAULT_REGISTRY);
    }

    public boolean addToOwned(String did, String ownerDid) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        walletManager.mutateWallet(wallet -> {
            IDInfo idInfo = fetchIdInfo(ownerDid, wallet);
            if (idInfo.owned == null) {
                idInfo.owned = new java.util.ArrayList<>();
            }
            if (!idInfo.owned.contains(did)) {
                idInfo.owned.add(did);
            }
        });
        return true;
    }

    public boolean removeFromOwned(String did, String ownerDid) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        final boolean[] ownerFound = {false};
        walletManager.mutateWallet(wallet -> {
            try {
                IDInfo idInfo = fetchIdInfo(ownerDid, wallet);
                ownerFound[0] = true;
                if (idInfo.owned == null) {
                    return;
                }
                idInfo.owned.removeIf(item -> did.equals(item));
            } catch (IllegalArgumentException ignored) {
                ownerFound[0] = false;
            }
        });
        return ownerFound[0];
    }

    public IDInfo fetchIdInfo(String nameOrDid) {
        return fetchIdInfo(nameOrDid, null);
    }

    public IDInfo fetchIdInfo(String nameOrDid, WalletFile wallet) {
        WalletFile currentWallet = wallet != null ? wallet : loadWallet();
        if (currentWallet == null) {
            throw new IllegalStateException("wallet not loaded");
        }

        IDInfo idInfo = null;
        if (nameOrDid == null || nameOrDid.isBlank()) {
            if (currentWallet.current == null || currentWallet.current.isBlank()) {
                throw new IllegalStateException("no current id");
            }
            idInfo = currentWallet.ids != null ? currentWallet.ids.get(currentWallet.current) : null;
        } else if (nameOrDid.startsWith("did")) {
            if (currentWallet.ids != null) {
                for (IDInfo info : currentWallet.ids.values()) {
                    if (didMatch(nameOrDid, info.did)) {
                        idInfo = info;
                        break;
                    }
                }
            }
        } else {
            idInfo = currentWallet.ids != null ? currentWallet.ids.get(nameOrDid) : null;
        }

        if (idInfo == null) {
            throw new IllegalArgumentException("unknown id");
        }

        return idInfo;
    }

    public JwkPair fetchKeyPair(String nameOrDid) {
        WalletFile wallet = loadWallet();
        IDInfo id = fetchIdInfo(nameOrDid, wallet);
        DeterministicKey master = walletManager.getHdKeyFromCacheOrMnemonic(wallet);

        if (gatekeeper == null) {
            DeterministicKey derived = HdKeyUtil.derivePath(master, id.account, id.index);
            return crypto.generateJwk(HdKeyUtil.privateKeyBytes(derived));
        }

        ResolveDIDOptions options = new ResolveDIDOptions();
        options.confirm = true;
        MdipDocument doc = gatekeeper.resolveDID(id.did, options);
        EcdsaJwkPublic confirmed = getPublicKeyJwk(doc);

        for (int i = id.index; i >= 0; i -= 1) {
            DeterministicKey derived = HdKeyUtil.derivePath(master, id.account, i);
            JwkPair keypair = crypto.generateJwk(HdKeyUtil.privateKeyBytes(derived));
            if (confirmed != null && confirmed.x != null && confirmed.y != null) {
                if (confirmed.x.equals(keypair.publicJwk.x) && confirmed.y.equals(keypair.publicJwk.y)) {
                    return keypair;
                }
            }
        }

        return null;
    }

    public boolean updateDID(MdipDocument doc) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (doc == null || doc.didDocument == null || doc.didDocument.id == null || doc.didDocument.id.isBlank()) {
            throw new IllegalArgumentException("doc.didDocument.id is required");
        }

        String did = doc.didDocument.id;
        MdipDocument current = resolveDID(did);
        String previd = current != null && current.didDocumentMetadata != null ? current.didDocumentMetadata.versionId : null;
        String registry = current != null && current.mdip != null ? current.mdip.registry : null;

        BlockInfo block = gatekeeper.getBlock(registry);
        String blockid = block != null ? block.hash : null;

        String signerDid = current != null && current.didDocument != null
            ? (current.didDocument.controller != null ? current.didDocument.controller : current.didDocument.id)
            : did;

        JwkPair keypair = getCurrentKeypair(loadWallet());
        Operation signed = operationFactory.createSignedUpdateDidOperation(
            did,
            previd,
            blockid,
            doc,
            keypair.privateJwk,
            signerDid
        );

        return gatekeeper.updateDID(signed);
    }

    public boolean deleteDID(String did) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }

        MdipDocument current = resolveDID(did);
        String previd = current != null && current.didDocumentMetadata != null ? current.didDocumentMetadata.versionId : null;
        String registry = current != null && current.mdip != null ? current.mdip.registry : null;

        BlockInfo block = gatekeeper.getBlock(registry);
        String blockid = block != null ? block.hash : null;

        Operation operation = new Operation();
        operation.type = "delete";
        operation.did = did;
        operation.previd = previd;
        operation.blockid = blockid;

        String signerDid = current != null && current.didDocument != null
            ? (current.didDocument.controller != null ? current.didDocument.controller : current.didDocument.id)
            : did;

        JwkPair keypair = getCurrentKeypair(loadWallet());
        Operation signed = new OperationSignerImpl(crypto).sign(operation, keypair.privateJwk, signerDid);
        return gatekeeper.deleteDID(signed);
    }

    public BlockInfo getBlock(String registry) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("registry is required");
        }
        return gatekeeper.getBlock(registry);
    }

    IDInfo getCurrentIdInfo(WalletFile wallet) {
        if (wallet == null) {
            throw new IllegalStateException("wallet not loaded");
        }
        if (wallet.current == null || wallet.current.isBlank()) {
            throw new IllegalStateException("no current id");
        }
        if (wallet.ids == null || !wallet.ids.containsKey(wallet.current)) {
            throw new IllegalStateException("current id not found in wallet");
        }
        return wallet.ids.get(wallet.current);
    }

    JwkPair getCurrentKeypair(WalletFile wallet) {
        IDInfo id = getCurrentIdInfo(wallet);
        return getCurrentKeypairFromPath(wallet, id.account, id.index);
    }

    private JwkPair getCurrentKeypairFromPath(WalletFile wallet, int account, int index) {
        DeterministicKey master = walletManager.getHdKeyFromCacheOrMnemonic(wallet);
        DeterministicKey derived = HdKeyUtil.derivePath(master, account, index);
        return crypto.generateJwk(HdKeyUtil.privateKeyBytes(derived));
    }

    private static boolean didMatch(String did1, String did2) {
        if (did1 == null || did2 == null) {
            return false;
        }
        String suffix1 = did1.substring(did1.lastIndexOf(':') + 1);
        String suffix2 = did2.substring(did2.lastIndexOf(':') + 1);
        return suffix1.equals(suffix2);
    }

    private static EcdsaJwkPublic getPublicKeyJwk(MdipDocument doc) {
        if (doc == null || doc.didDocument == null || doc.didDocument.verificationMethod == null) {
            throw new IllegalArgumentException("didDocument missing verificationMethod");
        }
        if (doc.didDocument.verificationMethod.isEmpty()) {
            throw new IllegalArgumentException("didDocument missing verificationMethod");
        }
        EcdsaJwkPublic publicKeyJwk = doc.didDocument.verificationMethod.get(0).publicKeyJwk;
        if (publicKeyJwk == null) {
            throw new IllegalArgumentException("didDocument missing publicKeyJwk");
        }
        return publicKeyJwk;
    }
}
