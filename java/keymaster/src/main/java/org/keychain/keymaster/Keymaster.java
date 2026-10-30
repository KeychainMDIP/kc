package org.keychain.keymaster;

import java.time.Instant;
import java.time.LocalDate;
import java.time.DateTimeException;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bitcoinj.crypto.DeterministicKey;
import org.keychain.cid.Cid;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.DocumentMetadata;
import org.keychain.gatekeeper.model.EcdsaJwkPublic;
import org.keychain.gatekeeper.model.Mdip;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.gatekeeper.model.Signature;
import org.keychain.keymaster.model.ChallengeReceipt;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Group;
import org.keychain.keymaster.model.CheckWalletResult;
import org.keychain.keymaster.model.FixWalletResult;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletStore;
import org.keychain.keymaster.store.WalletJsonMapper;

public class Keymaster {
    private static final DateTimeFormatter ISO_MILLIS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final String DEFAULT_REGISTRY = "hyperswarm";
    private static final String EPOCH_ISO = ISO_MILLIS.format(Instant.EPOCH);
    private static final int MAX_NAME_LENGTH = 32;
    private static Supplier<Instant> NOW_SUPPLIER = Instant::now;
    // shortcut: match the reference's portable URL check, expand in a separate URL-validation change.
    private static final Pattern CREDENTIAL_CONTEXT_URL = Pattern.compile(
        "^https?://[a-z\\d](?:[a-z\\d.-]*[a-z\\d])?(?::(\\d{1,5}))?(?:[/?#]|$)", Pattern.CASE_INSENSITIVE);
    private static final Pattern CREDENTIAL_DATE = Pattern.compile(
        "(-?(?:[1-9]\\d{3,}|0\\d{3}))-(\\d{2})-(\\d{2})T(\\d{2}):([0-5]\\d):([0-5]\\d)(?:\\.(\\d+))?(Z|[+-]\\d{2}:[0-5]\\d)");
    private final KeymasterWalletManager walletManager;
    private final KeymasterCrypto crypto;
    private final String passphrase;
    private final GatekeeperInterface gatekeeper;
    private final OperationFactory operationFactory;
    private final String defaultRegistry;
    private final String ephemeralRegistry;
    private final String didPrefix;
    private final int maxNameLength;

    public Keymaster(KeymasterOptions options) {
        this(
            Objects.requireNonNull(options, "options is required").wallet,
            options.gatekeeper,
            options.crypto,
            options.operationFactory != null ? options.operationFactory : new OperationFactory(options.crypto),
            options.passphrase,
            options.defaultRegistry,
            options.didPrefix,
            options.maxNameLength
        );
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperInterface gatekeeper,
        KeymasterCrypto crypto,
        OperationFactory operationFactory,
        String passphrase,
        String defaultRegistry
    ) {
        this(store, gatekeeper, crypto, operationFactory, passphrase, defaultRegistry, null, MAX_NAME_LENGTH);
    }

    private Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperInterface gatekeeper,
        KeymasterCrypto crypto,
        OperationFactory operationFactory,
        String passphrase,
        String defaultRegistry,
        String didPrefix,
        int maxNameLength
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
        if (didPrefix != null && !didPrefix.matches("did:[a-z0-9]+")) {
            throw new IllegalArgumentException("Invalid DID prefix");
        }
        if (maxNameLength <= 0) {
            throw new IllegalArgumentException("maxNameLength must be positive");
        }

        this.crypto = crypto;
        this.passphrase = passphrase;
        this.gatekeeper = gatekeeper;
        this.operationFactory = operationFactory;
        this.defaultRegistry = normalizeRegistry(defaultRegistry);
        this.ephemeralRegistry = "hyperswarm";
        this.didPrefix = didPrefix;
        this.maxNameLength = maxNameLength;
        this.walletManager = new KeymasterWalletManager(store, crypto, passphrase);
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperInterface gatekeeper,
        KeymasterCrypto crypto,
        OperationFactory operationFactory,
        String passphrase
    ) {
        this(store, gatekeeper, crypto, operationFactory, passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperInterface gatekeeper,
        KeymasterCrypto crypto,
        String passphrase
    ) {
        this(store, gatekeeper, crypto, new OperationFactory(crypto), passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperInterface gatekeeper,
        KeymasterCrypto crypto,
        String passphrase,
        String defaultRegistry
    ) {
        this(store, gatekeeper, crypto, new OperationFactory(crypto), passphrase, defaultRegistry);
    }

    public Keymaster(WalletStore<WalletEncFile> store, KeymasterCrypto crypto, String passphrase) {
        this(store, null, crypto, passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(WalletStore<WalletEncFile> store, GatekeeperInterface gatekeeper, String passphrase) {
        this(store, gatekeeper, new KeymasterCryptoImpl(), passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(WalletStore<WalletEncFile> store, GatekeeperInterface gatekeeper, String passphrase, String defaultRegistry) {
        this(store, gatekeeper, new KeymasterCryptoImpl(), passphrase, defaultRegistry);
    }

    public Keymaster(WalletStore<WalletEncFile> store, String passphrase) {
        this(store, null, new KeymasterCryptoImpl(), passphrase, DEFAULT_REGISTRY);
    }

    public WalletFile loadWallet() {
        return walletManager.withWalletLock(() -> {
            WalletFile wallet = walletManager.loadWallet();
            return wallet == null ? newWallet(null, false) : wallet;
        });
    }

    public boolean saveWallet(WalletFile wallet, boolean overwrite) {
        return walletManager.saveWallet(wallet, overwrite);
    }

    public boolean saveWallet(WalletEncFile wallet, boolean overwrite) {
        if (wallet == null) {
            throw new IllegalArgumentException("wallet is required");
        }
        if (wallet.version != 1 || wallet.seed == null || wallet.seed.mnemonicEnc == null || wallet.enc == null) {
            throw new IllegalStateException("Keymaster: Unsupported wallet version.");
        }

        return walletManager.saveStoredWallet(wallet, overwrite);
    }

    public boolean mutateWallet(Consumer<WalletFile> mutator) {
        return walletManager.withWalletLock(() -> {
            loadWallet();
            return walletManager.mutateWallet(mutator);
        });
    }

    public java.util.Map<String, String> listNames(boolean includeIds) {
        WalletFile wallet = loadWallet();
        java.util.Map<String, String> names = new java.util.HashMap<>();
        if (wallet.names != null) {
            names.putAll(wallet.names);
        }
        if (includeIds && wallet.ids != null) {
            for (java.util.Map.Entry<String, IDInfo> entry : wallet.ids.entrySet()) {
                names.put(entry.getKey(), entry.getValue().did);
            }
        }
        return names;
    }

    public java.util.List<String> listIds() {
        WalletFile wallet = loadWallet();
        if (wallet.ids == null) {
            return new java.util.ArrayList<>();
        }
        return new java.util.ArrayList<>(wallet.ids.keySet());
    }

    public String getCurrentId() {
        WalletFile wallet = loadWallet();
        return wallet.current;
    }

    public boolean setCurrentId(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        mutateWallet(wallet -> {
            if (wallet.ids == null || !wallet.ids.containsKey(name)) {
                throw new IllegalArgumentException("unknown id");
            }
            wallet.current = name;
        });
        return true;
    }

    public boolean removeId(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        mutateWallet(wallet -> {
            if (wallet.ids == null || !wallet.ids.containsKey(name)) {
                throw new IllegalArgumentException("unknown id");
            }
            wallet.ids.remove(name);
            if (name.equals(wallet.current)) {
                wallet.current = wallet.ids.isEmpty() ? "" : wallet.ids.keySet().iterator().next();
            }
        });
        return true;
    }

    public boolean renameId(String currentName, String newName) {
        if (currentName == null || currentName.isBlank()) {
            throw new IllegalArgumentException("current name is required");
        }
        mutateWallet(wallet -> {
            String validNew = validateNameInternal(newName, wallet);
            if (wallet.ids == null || !wallet.ids.containsKey(currentName)) {
                throw new IllegalArgumentException("unknown id");
            }
            IDInfo info = wallet.ids.get(currentName);
            wallet.ids.put(validNew, info);
            wallet.ids.remove(currentName);
            if (currentName.equals(wallet.current)) {
                wallet.current = validNew;
            }
        });
        return true;
    }

    public boolean addName(String name, String did) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        mutateWallet(wallet -> {
            if (wallet.names == null) {
                wallet.names = new java.util.HashMap<>();
            }
            String valid = validateNameInternal(name, wallet);
            wallet.names.put(valid, did);
        });
        return true;
    }

    public String getName(String name) {
        WalletFile wallet = loadWallet();
        if (wallet.names != null && wallet.names.containsKey(name)) {
            return wallet.names.get(name);
        }
        return null;
    }

    public boolean removeName(String name) {
        mutateWallet(wallet -> {
            if (wallet.names == null || !wallet.names.containsKey(name)) {
                return;
            }
            wallet.names.remove(name);
        });
        return true;
    }

    public WalletFile newWallet(String mnemonic, boolean overwrite) {
        return walletManager.withWalletLock(() -> {
            String phrase = mnemonic == null || mnemonic.isEmpty() ? crypto.generateMnemonic() : mnemonic;

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

            return walletManager.loadWallet();
        });
    }

    public String decryptMnemonic() {
        WalletFile wallet = loadWallet();
        if (wallet == null || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalStateException("wallet mnemonic not available");
        }
        return MnemonicEncryption.decrypt(wallet.seed.mnemonicEnc, passphrase);
    }

    public String getMnemonicForDerivation(WalletFile wallet) {
        if (wallet == null || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalStateException("wallet mnemonic not available");
        }
        return MnemonicEncryption.decrypt(wallet.seed.mnemonicEnc, passphrase);
    }

    public WalletEncFile exportEncryptedWallet() {
        WalletFile wallet = loadWallet();
        WalletCrypto walletCrypto = new WalletCrypto(crypto, passphrase);
        return walletCrypto.encryptForStorage(wallet);
    }

    public java.util.List<String> listRegistries() {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        return gatekeeper.listRegistries();
    }

    public CheckWalletResult checkWallet() {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }

        WalletFile wallet = loadWallet();
        resolveSeedBank();

        CheckWalletResult result = new CheckWalletResult();

        if (wallet.ids != null) {
            for (IDInfo id : wallet.ids.values()) {
                tallyDid(id.did, result);
            }

            for (IDInfo id : wallet.ids.values()) {
                if (id.owned != null) {
                    for (String did : id.owned) {
                        tallyDid(did, result);
                    }
                }
                if (id.held != null) {
                    for (String did : id.held) {
                        tallyDid(did, result);
                    }
                }
            }
        }

        if (wallet.names != null) {
            for (String did : wallet.names.values()) {
                tallyDid(did, result);
            }
        }

        return result;
    }

    public FixWalletResult fixWallet() {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }

        FixWalletResult result = new FixWalletResult();
        mutateWallet(wallet -> {
            if (wallet.ids != null) {
                java.util.Iterator<java.util.Map.Entry<String, IDInfo>> iterator = wallet.ids.entrySet().iterator();
                while (iterator.hasNext()) {
                    java.util.Map.Entry<String, IDInfo> entry = iterator.next();
                    if (shouldRemoveDid(entry.getValue().did)) {
                        iterator.remove();
                        if (entry.getKey().equals(wallet.current)) {
                            wallet.current = wallet.ids.keySet().stream().findFirst().orElse("");
                        }
                        result.idsRemoved += 1;
                    }
                }

                for (IDInfo id : wallet.ids.values()) {
                    if (id.owned != null) {
                        for (int i = 0; i < id.owned.size(); i += 1) {
                            if (shouldRemoveDid(id.owned.get(i))) {
                                id.owned.remove(i);
                                i -= 1;
                                result.ownedRemoved += 1;
                            }
                        }
                    }
                    if (id.held != null) {
                        for (int i = 0; i < id.held.size(); i += 1) {
                            if (shouldRemoveDid(id.held.get(i))) {
                                id.held.remove(i);
                                i -= 1;
                                result.heldRemoved += 1;
                            }
                        }
                    }
                }
            }

            if (wallet.names != null) {
                java.util.Iterator<java.util.Map.Entry<String, String>> iterator = wallet.names.entrySet().iterator();
                while (iterator.hasNext()) {
                    java.util.Map.Entry<String, String> entry = iterator.next();
                    if (shouldRemoveDid(entry.getValue())) {
                        iterator.remove();
                        result.namesRemoved += 1;
                    }
                }
            }
        });

        return result;
    }

    public MdipDocument resolveSeedBank() {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        return resolveSeedBankFor(hdKeyPair());
    }

    private MdipDocument resolveSeedBankFor(JwkPair keypair) {
        Operation operation = new Operation();
        operation.type = "create";
        operation.created = EPOCH_ISO;

        Mdip mdip = new Mdip();
        mdip.version = 1;
        mdip.type = "agent";
        mdip.registry = defaultRegistry;
        operation.mdip = mdip;
        operation.publicJwk = JwkConverter.toEcdsaJwkPublic(keypair.publicJwk);

        String msgHash = crypto.hashJson(operation);
        Signature signature = new Signature();
        signature.signed = EPOCH_ISO;
        signature.hash = msgHash;
        signature.value = crypto.signHash(msgHash, keypair.privateJwk);
        operation.signature = signature;

        String did = gatekeeper.createDID(operation);
        return gatekeeper.resolveDID(did, null);
    }

    public boolean backupId() {
        return backupId(null);
    }

    public boolean backupId(String id) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        WalletFile wallet = loadWallet();
        String name = id;
        if (name == null || name.isBlank()) {
            name = wallet.current;
        }
        if (name == null || name.isBlank()) {
            throw new IllegalStateException("Keymaster: No current ID");
        }
        String owner = fetchIdInfo(null, wallet).did;
        IDInfo idInfo = fetchIdInfo(name, wallet);
        JwkPair keypair = hdKeyPair();

        java.util.Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("name", name);
        data.put("id", idInfo);
        String msg;
        try {
            msg = WalletJsonMapper.stringify(data);
        } catch (Exception e) {
            throw new IllegalStateException("backupId: unable to serialize data", e);
        }

        String backup = crypto.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
        MdipDocument doc = resolveDID(idInfo.did);
        String registry = doc != null && doc.mdip != null ? doc.mdip.registry : null;
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("no registry found for agent DID");
        }

        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("backup", backup);
        CreateAssetOptions options = new CreateAssetOptions();
        options.registry = registry;
        options.controller = idInfo.did;
        String vaultDid = createAssetFor(payload, owner, options);

        if (!(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
            doc.didDocumentData = new java.util.LinkedHashMap<>();
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> docData = (java.util.Map<String, Object>) doc.didDocumentData;
        docData.put("vault", vaultDid);
        doc.didDocumentData = docData;
        return updateDID(doc);
    }

    public String recoverId(String did) {
        return walletManager.withWalletLock(() -> recoverIdLocked(did));
    }

    private String recoverIdLocked(String did) {
        try {
            if (did == null || did.isBlank()) {
                throw new IllegalArgumentException("did is required");
            }
            JwkPair keypair = hdKeyPair();
            MdipDocument doc = resolveDID(did);
            if (doc == null || !(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
                throw new IllegalArgumentException("didDocumentData missing vault");
            }

            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> docData = (java.util.Map<String, Object>) doc.didDocumentData;
            Object vaultObj = docData.get("vault");
            if (!(vaultObj instanceof String)) {
                throw new IllegalArgumentException("didDocumentData missing vault");
            }

            Object vaultObjData = resolveAsset((String) vaultObj);
            if (!(vaultObjData instanceof java.util.Map<?, ?>)) {
                throw new IllegalArgumentException("backup not found in vault");
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> vaultData = (java.util.Map<String, Object>) vaultObjData;
            Object backupObj = vaultData.get("backup");
            if (!(backupObj instanceof String)) {
                throw new IllegalArgumentException("backup not found in vault");
            }

            String decrypted = crypto.decryptMessage(keypair.publicJwk, keypair.privateJwk, (String) backupObj);
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> data = WalletJsonMapper.mapper().readValue(decrypted, java.util.Map.class);
            Object nameObj = data.get("name");
            Object idObj = data.get("id");
            if (!(nameObj instanceof String) || !(idObj instanceof java.util.Map<?, ?>)) {
                throw new IllegalArgumentException("Invalid backup data");
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> idMap = (java.util.Map<String, Object>) idObj;
            IDInfo idInfo = WalletJsonMapper.mapper().convertValue(idMap, IDInfo.class);
            String name = (String) nameObj;

            if (!isValidDID(idInfo.did) || !didMatch(idInfo.did, getAgentDID(doc))) {
                throw new IllegalArgumentException("Invalid identity backup DID");
            }
            EcdsaJwkPublic currentPublicKey = getPublicKeyJwk(doc);
            MdipDocument.VerificationMethod method = doc.didDocument.verificationMethod.get(0);

            mutateWallet(wallet -> {
                if (wallet.ids == null) {
                    wallet.ids = new java.util.LinkedHashMap<>();
                }
                if (wallet.ids.containsKey(name)) {
                    throw new IllegalStateException(name + " already exists in wallet");
                }
                String storedName = validateNameInternal(name, wallet);
                if (idInfo.account == Integer.MAX_VALUE) {
                    throw new IllegalArgumentException("Identity account range exhausted");
                }
                int index = recoveredKeyIndex(method.id, idInfo.index);
                JwkPair recovered = getCurrentKeypairFromPath(wallet, idInfo.account, index);
                if (!Objects.equals(recovered.publicJwk.x, currentPublicKey.x)
                    || !Objects.equals(recovered.publicJwk.y, currentPublicKey.y)) {
                    throw new IllegalArgumentException("Current identity key does not belong to wallet");
                }
                idInfo.index = index;
                wallet.ids.put(storedName, idInfo);
                wallet.current = storedName;
                wallet.counter = Math.max(wallet.counter, idInfo.account + 1);
            });

            return trimName(name);
        } catch (Exception e) {
            if (e instanceof IllegalStateException) {
                throw (IllegalStateException) e;
            }
            throw new IllegalArgumentException("did", e);
        }
    }

    private static int recoveredKeyIndex(String methodId, int backupIndex) {
        if (methodId == null || !methodId.matches("#key-[1-9][0-9]*")) {
            return backupIndex;
        }
        try {
            double index = Double.parseDouble(methodId.substring(5)) - 1;
            // Match the reference's treatment of hints outside JavaScript's safe integer range.
            if (!Double.isFinite(index) || index > 9007199254740991d || index <= backupIndex) {
                return backupIndex;
            }
            if (index > Integer.MAX_VALUE) {
                throw new IllegalArgumentException("Identity key index exceeds Java derivation range");
            }
            return (int) index;
        } catch (NumberFormatException ignored) {
            return backupIndex;
        }
    }

    public boolean updateSeedBank(MdipDocument doc) {
        return updateSeedBankFor(doc, hdKeyPair());
    }

    private boolean updateSeedBankFor(MdipDocument doc, JwkPair keypair) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (doc == null || doc.didDocument == null || doc.didDocument.id == null || doc.didDocument.id.isBlank()) {
            throw new IllegalArgumentException("Invalid parameter: seed bank missing DID");
        }

        MdipDocument update = WalletJsonMapper.mapper().convertValue(doc, MdipDocument.class);
        String did = update.didDocument.id;
        String expectedPrevid = update.didDocumentMetadata != null ? update.didDocumentMetadata.versionId : null;
        MdipDocument current = gatekeeper.resolveDID(did, null);
        String previd = current != null && current.didDocumentMetadata != null ? current.didDocumentMetadata.versionId : null;
        if (expectedPrevid != null && !expectedPrevid.equals(previd)) {
            return false;
        }

        Operation operation = new Operation();
        operation.type = "update";
        operation.did = did;
        operation.previd = previd;
        operation.doc = update;

        String msgHash = crypto.hashJson(operation);
        Signature signature = new Signature();
        signature.signer = did;
        signature.signed = nowIso();
        signature.hash = msgHash;
        signature.value = crypto.signHash(msgHash, keypair.privateJwk);
        operation.signature = signature;

        return gatekeeper.updateDID(operation);
    }

    public String backupWallet() {
        return backupWallet(defaultRegistry, null);
    }

    public String backupWallet(String registry) {
        return backupWallet(registry, null);
    }

    public String backupWallet(String registry, WalletFile wallet) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (registry == null || registry.isBlank()) {
            registry = defaultRegistry;
        }
        if (wallet == null) {
            wallet = loadWallet();
        }
        wallet = WalletJsonMapper.mapper().convertValue(wallet, WalletFile.class);

        JwkPair keypair = hdKeyPair();
        MdipDocument seedBank = resolveSeedBankFor(keypair);
        String msg;
        try {
            msg = WalletJsonMapper.stringify(wallet);
        } catch (Exception e) {
            throw new IllegalStateException("backup wallet failed", e);
        }

        String backup = crypto.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);

        Operation operation = new Operation();
        operation.type = "create";
        operation.created = nowIso();

        Mdip mdip = new Mdip();
        mdip.version = 1;
        mdip.type = "asset";
        mdip.registry = registry;
        mdip.prefix = didPrefix;
        operation.mdip = mdip;
        operation.controller = seedBank.didDocument != null ? seedBank.didDocument.id : null;
        java.util.Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("backup", backup);
        operation.data = data;

        String msgHash = crypto.hashJson(operation);
        Signature signature = new Signature();
        signature.signer = operation.controller;
        signature.signed = nowIso();
        signature.hash = msgHash;
        signature.value = crypto.signHash(msgHash, keypair.privateJwk);
        operation.signature = signature;

        String backupDid = gatekeeper.createDID(operation);

        if (seedBank.didDocumentData instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> seedData = (java.util.Map<String, Object>) seedBank.didDocumentData;
            seedData.put("wallet", backupDid);
            seedBank.didDocumentData = seedData;
            if (!updateSeedBankFor(seedBank, keypair)) {
                throw new IllegalStateException("update seed bank failed");
            }
        }

        return backupDid;
    }

    public WalletFile recoverWallet() {
        return recoverWallet(null);
    }

    public WalletFile recoverWallet(String did) {
        return walletManager.withWalletLock(() -> recoverWalletLocked(did));
    }

    private WalletFile recoverWalletLocked(String did) {
        try {
            if (gatekeeper == null) {
                throw new IllegalStateException("gatekeeper not configured");
            }

            if (did == null || did.isBlank()) {
                MdipDocument seedBank = resolveSeedBank();
                if (seedBank.didDocumentData instanceof java.util.Map<?, ?>) {
                    @SuppressWarnings("unchecked")
                    java.util.Map<String, Object> data = (java.util.Map<String, Object>) seedBank.didDocumentData;
                    Object walletDid = data.get("wallet");
                    if (walletDid instanceof String) {
                        did = (String) walletDid;
                    }
                }
                if (did == null || did.isBlank()) {
                    throw new IllegalArgumentException("No backup DID found");
                }
            }

            JwkPair keypair = hdKeyPair();
            Object assetObj = resolveAsset(did);
            if (!(assetObj instanceof java.util.Map<?, ?>)) {
                throw new IllegalArgumentException("No asset data found");
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> data = (java.util.Map<String, Object>) assetObj;

            Object backupObj = data.get("backup");
            if (!(backupObj instanceof String)) {
                throw new IllegalArgumentException("Asset \"backup\" is missing or not a string");
            }

            String backup = crypto.decryptMessage(keypair.publicJwk, keypair.privateJwk, (String) backupObj);
            WalletFile recovered = WalletJsonMapper.mapper().readValue(backup, WalletFile.class);

            if (recovered.version != null && recovered.version == 1 && recovered.seed != null && recovered.seed.mnemonicEnc != null) {
                String mnemonic = decryptMnemonic();
                recovered.seed.mnemonicEnc = MnemonicEncryption.encrypt(mnemonic, passphrase);
            }

            mutateWallet(current -> replaceWallet(current, walletManager.upgradeWallet(recovered)));
            return loadWallet();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to recover wallet", e);
        }
    }

    public String createId(String name, String registry) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        String targetRegistry = registry == null || registry.isBlank() ? defaultRegistry : registry;

        return walletManager.withWalletLock(() -> {
            WalletFile initial = loadWallet();
            String validName = validateNameInternal(name, initial);
            int account = initial.counter;
            if (account == Integer.MAX_VALUE) {
                throw new IllegalStateException("Identity account range exhausted");
            }
            Operation signed = createIdOperation(validName, account, targetRegistry);
            if (loadWallet() != initial) {
                throw new IllegalStateException("Wallet changed during identity creation. Try again.");
            }
            // Reserve durably before publication, including ambiguous publication failures.
            mutateWallet(wallet -> wallet.counter = account + 1);
            WalletFile reserved = loadWallet();
            String did = gatekeeper.createDID(signed);
            if (loadWallet() != reserved) {
                throw new IllegalStateException("Wallet changed during identity creation. Try again.");
            }
            mutateWallet(wallet -> {
                String storedName = validateNameInternal(validName, wallet);
                IDInfo idInfo = new IDInfo();
                idInfo.did = did;
                idInfo.account = account;
                idInfo.index = 0;
                wallet.ids.put(storedName, idInfo);
                wallet.current = storedName;
            });
            return did;
        });
    }

    public String createId(String name, CreateIdOptions options) {
        String registry = options != null ? options.registry : null;
        return createId(name, registry);
    }

    public String createId(String name) {
        return createId(name, (CreateIdOptions) null);
    }

    public Operation createIdOperation(String name) {
        return createIdOperation(name, 0, (String) null);
    }

    public Operation createIdOperation(String name, int account) {
        return createIdOperation(name, account, (String) null);
    }

    public Operation createIdOperation(String name, CreateIdOptions options) {
        return createIdOperation(name, 0, options);
    }

    public Operation createIdOperation(String name, int account, String registry) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (account < 0) {
            throw new IllegalArgumentException("account must be non-negative");
        }
        String targetRegistry = registry == null || registry.isBlank() ? defaultRegistry : registry;

        WalletFile wallet = loadWallet();
        validateNameInternal(name, wallet);
        JwkPair keypair = getCurrentKeypairFromPath(wallet, account, 0);

        BlockInfo block = gatekeeper.getBlock(targetRegistry);
        String blockid = block != null ? block.hash : null;

        return operationFactory.createSignedCreateIdOperation(
            targetRegistry,
            JwkConverter.toEcdsaJwkPublic(keypair.publicJwk),
            keypair.privateJwk,
            blockid,
            didPrefix
        );
    }

    public Operation createIdOperation(String name, int account, CreateIdOptions options) {
        String registry = options != null ? options.registry : null;
        return createIdOperation(name, account, registry);
    }

    public String createAsset(Object data, String registry) {
        return createAsset(data, registry, null, null);
    }

    public String createAsset(Object data) {
        return createAsset(data, defaultRegistry, null, null);
    }

    public String createAsset(Object data, String registry, String controllerDid, String validUntil) {
        CreateAssetOptions options = new CreateAssetOptions();
        options.registry = registry;
        options.controller = controllerDid;
        options.validUntil = validUntil;
        return createAsset(data, options);
    }

    public String createAsset(Object data, CreateAssetOptions options) {
        String owner = fetchIdInfo(null).did;
        return createAssetFor(data, owner, options);
    }

    private String createAssetFor(Object data, String owner, CreateAssetOptions options) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }
        CreateAssetOptions effective = options != null
            ? WalletJsonMapper.mapper().convertValue(options, CreateAssetOptions.class) : new CreateAssetOptions();
        String registry = effective.registry == null || effective.registry.isBlank() ? defaultRegistry : effective.registry;
        validateValidUntil(effective.validUntil);
        WalletFile wallet = loadWallet();
        String name = effective.name != null && !effective.name.isEmpty()
            ? validateNameInternal(effective.name, wallet) : null;
        IDInfo controller = fetchIdInfo(effective.controller == null || effective.controller.isBlank() ? owner : effective.controller, wallet);
        String signerDid = controller.did;
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
            effective.validUntil,
            keypair.privateJwk,
            signerDid,
            didPrefix
        );

        String did = gatekeeper.createDID(signed);
        if (effective.validUntil == null) {
            addToOwned(did, owner);
        }
        if (name != null) {
            addName(name, did);
        }
        return did;
    }

    public String createSchema(String registry) {
        return createSchema(null, registry);
    }

    public String createSchema(Object schema, String registry) {
        CreateAssetOptions options = new CreateAssetOptions();
        if (registry != null && !registry.isBlank()) {
            options.registry = registry;
        }
        return createSchema(schema, options);
    }

    public String createSchema(Object schema, CreateAssetOptions options) {
        if (schema == null) {
            schema = defaultSchema();
        }
        if (!validateSchema(schema)) {
            throw new IllegalArgumentException("Invalid parameter: schema");
        }
        java.util.Map<String, Object> data = new java.util.HashMap<>();
        data.put("schema", schema);
        return createAsset(data, options);
    }

    public String createSchema(Object schema) {
        return createSchema(schema, (CreateAssetOptions) null);
    }

    public String createSchema() {
        return createSchema(null, (CreateAssetOptions) null);
    }

    public String createSchema(CreateAssetOptions options) {
        return createSchema(null, options);
    }

    public String createChallenge() {
        return createChallenge(new java.util.LinkedHashMap<>(), null);
    }

    public String createChallenge(java.util.Map<String, Object> challenge) {
        return createChallenge(challenge, null);
    }

    public String createChallenge(java.util.Map<String, Object> challenge, CreateAssetOptions options) {
        if (challenge == null) {
            throw new IllegalArgumentException("challenge");
        }
        if (challenge instanceof java.util.List<?>) {
            throw new IllegalArgumentException("challenge");
        }
        Object credentialsObj = challenge.get("credentials");
        if (credentialsObj != null && !(credentialsObj instanceof java.util.List<?>)) {
            throw new IllegalArgumentException("challenge.credentials");
        }

        CreateAssetOptions effective = options != null ? options : new CreateAssetOptions();
        if (effective.registry == null || effective.registry.isBlank()) {
            effective.registry = ephemeralRegistry;
        }
        if (effective.validUntil == null) {
            effective.validUntil = ISO_MILLIS.format(Instant.now().plusSeconds(3600));
        }

        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("challenge", challenge);
        return createAsset(payload, effective);
    }

    public Object getSchema(String did) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        Object data = resolveAsset(did);
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
            throw new IllegalArgumentException("Invalid parameter: schema");
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
        } catch (Exception e) {
            return false;
        }
    }

    public java.util.Map<String, Object> createTemplate(String schemaId) {
        if (!testSchema(schemaId)) {
            throw new IllegalArgumentException("Invalid parameter: schemaId");
        }
        String schemaDid = lookupDID(schemaId);
        Object schema = getSchema(schemaDid);
        java.util.Map<String, Object> template = generateSchema(schema);
        template.put("$schema", schemaDid);
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

    public java.util.List<String> listSchemas() {
        return listSchemas(null);
    }

    public String cloneAsset(String id) {
        return cloneAsset(id, null, null);
    }

    public String cloneAsset(String id, String registry, String controller) {
        String owner = fetchIdInfo(null).did;
        MdipDocument assetDoc = resolveDID(id);
        if (assetDoc == null || assetDoc.mdip == null || !"asset".equals(assetDoc.mdip.type)) {
            throw new IllegalArgumentException("id");
        }

        Map<String, Object> assetData = assetProperties(assetDoc.didDocumentData);
        assetData.put("cloned", assetDoc.didDocument != null ? assetDoc.didDocument.id : null);

        CreateAssetOptions options = new CreateAssetOptions();
        options.registry = registry;
        options.controller = controller;
        return createAssetFor(assetData, owner, options);
    }

    public String createResponse(String challengeDid) {
        return createResponse(challengeDid, null);
    }

    public String createResponse(String challengeDid, CreateResponseOptions options) {
        String responder = fetchIdInfo(null).did;
        CreateResponseOptions effective = options != null
            ? WalletJsonMapper.mapper().convertValue(options, CreateResponseOptions.class) : new CreateResponseOptions();
        // Protocol responses and their presentations remain controlled by the responder.
        effective.controller = null;
        effective.name = null;
        int retries = effective.retries != null ? effective.retries : 0;
        int delay = effective.delay != null ? effective.delay : 1000;

        if (effective.registry == null || effective.registry.isBlank()) {
            effective.registry = ephemeralRegistry;
        }
        if (effective.validUntil == null) {
            effective.validUntil = ISO_MILLIS.format(Instant.now().plusSeconds(3600));
        }

        MdipDocument doc = resolveWithRetries(challengeDid, retries, delay);
        if (doc == null) {
            throw new IllegalArgumentException("challengeDID does not resolve");
        }

        Object result = resolveAsset(challengeDid);
        if (!(result instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("Invalid parameter: challengeDID");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> resultMap = (java.util.Map<String, Object>) result;
        Object challengeObj = resultMap.get("challenge");
        if (!(challengeObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("Invalid parameter: challengeDID");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> challenge = (java.util.Map<String, Object>) challengeObj;

        String requestor = doc.didDocument != null ? doc.didDocument.controller : null;
        if (requestor == null || requestor.isBlank()) {
            throw new IllegalArgumentException("requestor undefined");
        }

        java.util.List<String> matches = new java.util.ArrayList<>();
        long now = NOW_SUPPLIER.get().toEpochMilli();
        Object credentialsObj = challenge.get("credentials");
        if (credentialsObj instanceof java.util.List<?>) {
            @SuppressWarnings("unchecked")
            java.util.List<Object> credentials = (java.util.List<Object>) credentialsObj;
            for (Object item : credentials) {
                if (!(item instanceof java.util.Map<?, ?>)) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> spec = (java.util.Map<String, Object>) item;
                String match = findMatchingCredential(spec, responder, now);
                if (match != null) {
                    matches.add(match);
                }
            }
        }

        java.util.List<java.util.Map<String, Object>> pairs = new java.util.ArrayList<>();
        for (String vcDid : matches) {
            String plaintext = decryptMessageFor(vcDid, responder);
            effective.includeHash = true;
            String vpDid = encryptMessageFor(plaintext, requestor, responder, effective);
            java.util.Map<String, Object> pair = new java.util.LinkedHashMap<>();
            pair.put("vc", vcDid);
            pair.put("vp", vpDid);
            pairs.add(pair);
        }

        int requested = credentialsObj instanceof java.util.List<?> ? ((java.util.List<?>) credentialsObj).size() : 0;
        int fulfilled = matches.size();
        boolean match = requested == fulfilled;

        java.util.Map<String, Object> response = new java.util.LinkedHashMap<>();
        response.put("challenge", challengeDid);
        response.put("credentials", pairs);
        response.put("requested", requested);
        response.put("fulfilled", fulfilled);
        response.put("match", match);
        response.put("responseNonce", crypto.generateRandomSalt());

        java.util.Map<String, Object> wrapper = new java.util.LinkedHashMap<>();
        wrapper.put("response", response);
        effective.includeHash = false;
        return encryptJsonFor(wrapper, requestor, responder, effective);
    }

    public java.util.Map<String, Object> verifyResponse(String responseDid) {
        return verifyResponse(responseDid, null);
    }

    public Map<String, Object> verifyResponse(String responseDid, CreateResponseOptions options) {
        return verifyResponseFor(responseDid, fetchIdInfo(null).did, options);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> verifyResponseFor(String responseDid, String verifier, CreateResponseOptions options) {
        CreateResponseOptions effective = options != null ? options : new CreateResponseOptions();
        int retries = effective.retries != null ? effective.retries : 0;
        int delay = effective.delay != null ? effective.delay : 1000;
        MdipDocument responseDoc = resolveWithRetries(responseDid, retries, delay);
        if (responseDoc == null) {
            throw new IllegalArgumentException("responseDID does not resolve");
        }
        Object data = responseDoc.didDocumentData;
        if (Boolean.TRUE.equals(responseDoc.didDocumentMetadata != null ? responseDoc.didDocumentMetadata.deactivated : null)
            || !(data instanceof Map<?, ?>)) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted");
        }
        Map<String, Object> asset = (Map<String, Object>) data;
        Object encrypted = asset.get("encrypted");
        if (!(encrypted instanceof Map<?, ?>) && !(asset.get("cipher_hash") instanceof String)) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted");
        }
        Map<String, Object> crypt = encrypted instanceof Map<?, ?> ? (Map<String, Object>) encrypted : asset;
        String responder = responseDoc.didDocument != null ? responseDoc.didDocument.controller : null;
        if (responder == null || responder.isEmpty()) {
            throw new IllegalArgumentException("Invalid parameter: response controller");
        }
        if (!responder.equals(crypt.get("sender"))) {
            throw new IllegalArgumentException("Invalid parameter: response sender");
        }
        // Use the response version whose controller and encrypted sender were checked.
        WalletFile wallet = loadWallet();
        Object wrapper = parseEncryptedJson(decryptAssetMessage(asset, wallet, fetchIdInfo(verifier, wallet)));
        if (!(wrapper instanceof Map<?, ?>) || !(((Map<?, ?>) wrapper).get("response") instanceof Map<?, ?>)) {
            throw new IllegalArgumentException("responseDID not a valid challenge response");
        }
        Map<String, Object> response = (Map<String, Object>) ((Map<?, ?>) wrapper).get("response");
        if (!(response.get("challenge") instanceof String)) {
            throw new IllegalArgumentException("Invalid parameter: challengeDID");
        }
        MdipDocument challengeDoc = resolveDID((String) response.get("challenge"));
        Map<String, Object> challenge = responseChallenge(challengeDoc);
        if (!verifier.equals(challengeDoc.didDocument != null ? challengeDoc.didDocument.controller : null)) {
            throw new IllegalArgumentException("Invalid parameter: requesterDid");
        }
        Object requirements = challenge.get("credentials");
        if (requirements != null && !(requirements instanceof List<?>)) {
            throw new IllegalArgumentException("Invalid parameter: challenge.credentials");
        }
        List<?> requested = requirements != null ? (List<?>) requirements : List.of();
        if (!(response.get("credentials") instanceof List<?>)) {
            throw new IllegalArgumentException("Invalid parameter: response.credentials");
        }
        Set<String> seen = new HashSet<>();
        List<Map<String, Object>> candidates = new ArrayList<>();
        List<List<Integer>> eligible = new ArrayList<>();
        long now = NOW_SUPPLIER.get().toEpochMilli();
        for (Object entry : (List<?>) response.get("credentials")) {
            if (!(entry instanceof Map<?, ?>)) continue;
            Map<?, ?> pair = (Map<?, ?>) entry;
            if (!(pair.get("vc") instanceof String) || !(pair.get("vp") instanceof String)) continue;
            String vpDid = (String) pair.get("vp");
            if (seen.contains(vpDid)) continue;
            Object vcData = resolveAsset((String) pair.get("vc"));
            Object vpData = resolveAsset(vpDid);
            if (!(vcData instanceof Map<?, ?>) || !(vpData instanceof Map<?, ?>)) continue;
            Object vcEncrypted = ((Map<?, ?>) vcData).get("encrypted");
            Object vpEncrypted = ((Map<?, ?>) vpData).get("encrypted");
            if (!(vcEncrypted instanceof Map<?, ?>) || !(vpEncrypted instanceof Map<?, ?>)) continue;
            Object hash = ((Map<?, ?>) vcEncrypted).get("cipher_hash");
            if (!(hash instanceof String) || !hash.equals(((Map<?, ?>) vpEncrypted).get("cipher_hash"))) continue;
            String plaintext = decryptMessageFor(vpDid, verifier);
            Object parsed = parseEncryptedJson(plaintext);
            if (!hash.equals(crypto.hashMessage(plaintext)) || !isVerifiableCredential(parsed)) continue;
            Map<String, Object> vp = (Map<String, Object>) parsed;
            if (!verifyCredentialSignature(vp) || !isCredentialCurrent(vp, now)
                || !responder.equals(((Map<?, ?>) vp.get("credentialSubject")).get("id"))) continue;
            List<?> types = (List<?>) vp.get("type");
            if (types.size() < 2 || !((String) types.get(1)).startsWith("did:")) continue;
            List<Integer> indexes = new ArrayList<>();
            for (int i = 0; i < requested.size(); i++) {
                if (!(requested.get(i) instanceof Map<?, ?>)) {
                    throw new IllegalArgumentException("Invalid parameter: challenge.credentials");
                }
                Map<?, ?> spec = (Map<?, ?>) requested.get(i);
                Object issuers = spec.get("issuers");
                if (types.get(1).equals(spec.get("schema")) && (issuers == null
                    || issuers instanceof List<?> && (((List<?>) issuers).isEmpty() || ((List<?>) issuers).contains(vp.get("issuer"))))) {
                    indexes.add(i);
                }
            }
            if (indexes.isEmpty()) continue;
            seen.add(vpDid);
            candidates.add(vp);
            eligible.add(indexes);
        }
        int[] assigned = new int[requested.size()];
        Arrays.fill(assigned, -1);
        for (int i = 0; i < candidates.size(); i++) {
            assignPresentation(i, eligible, assigned, new boolean[assigned.length]);
        }
        Set<Integer> matched = new HashSet<>();
        for (int index : assigned) if (index >= 0) matched.add(index);
        List<Map<String, Object>> vps = new ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) if (matched.contains(i)) vps.add(candidates.get(i));
        response.put("vps", vps);
        response.put("match", matched.size() == requested.size());
        response.put("responder", responder);
        if (!Boolean.FALSE.equals(effective.publish) && Boolean.TRUE.equals(response.get("match"))) {
            PublishChallengeReceiptOptions publication = new PublishChallengeReceiptOptions();
            publication.verification = response;
            publishChallengeReceiptsFor(responseDid, verifier, publication);
        }
        return response;
    }

    private static boolean assignPresentation(int presentation, List<List<Integer>> eligible, int[] assigned, boolean[] visited) {
        for (int index : eligible.get(presentation)) {
            if (visited[index]) continue;
            visited[index] = true;
            if (assigned[index] < 0 || assignPresentation(assigned[index], eligible, assigned, visited)) {
                assigned[index] = presentation;
                return true;
            }
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> responseChallenge(MdipDocument doc) {
        if (doc == null || Boolean.TRUE.equals(doc.didDocumentMetadata != null ? doc.didDocumentMetadata.deactivated : null)
            || !(doc.didDocumentData instanceof Map<?, ?>)
            || !(((Map<?, ?>) doc.didDocumentData).get("challenge") instanceof Map<?, ?>)) {
            throw new IllegalArgumentException("Invalid parameter: challengeDID");
        }
        return (Map<String, Object>) ((Map<?, ?>) doc.didDocumentData).get("challenge");
    }

    public List<String> publishChallengeReceipts(String responseDid) {
        return publishChallengeReceipts(responseDid, null);
    }

    public List<String> publishChallengeReceipts(String responseDid, PublishChallengeReceiptOptions options) {
        return publishChallengeReceiptsFor(responseDid, fetchIdInfo(null).did,
            options != null ? options : new PublishChallengeReceiptOptions());
    }

    @SuppressWarnings("unchecked")
    private List<String> publishChallengeReceiptsFor(String responseDid, String requester, PublishChallengeReceiptOptions options) {
        Map<String, Object> response = options.verification;
        if (response == null) {
            CreateResponseOptions verification = new CreateResponseOptions();
            verification.retries = options.retries;
            verification.delay = options.delay;
            verification.publish = false;
            response = verifyResponseFor(responseDid, requester, verification);
        }
        if (!Boolean.TRUE.equals(response.get("match"))) {
            throw new IllegalArgumentException("Invalid parameter: verification.match");
        }
        Object nonce = response.get("responseNonce");
        if (!(nonce instanceof String) || ((String) nonce).isEmpty()) {
            throw new IllegalArgumentException("Invalid parameter: response.responseNonce");
        }
        if (!(response.get("challenge") instanceof String)) {
            throw new IllegalArgumentException("Invalid parameter: challengeDID");
        }
        MdipDocument doc = resolveDID((String) response.get("challenge"));
        Map<String, Object> challenge = responseChallenge(doc);
        if (!requester.equals(doc.didDocument != null ? doc.didDocument.controller : null)) {
            throw new IllegalArgumentException("Invalid parameter: requesterDid");
        }
        Object vps = response.get("vps");
        Object credentials = challenge.get("credentials");
        if ((vps != null && !(vps instanceof List<?>)) || (credentials instanceof List<?>
            && !((List<?>) credentials).isEmpty() && vps == null)) {
            throw new IllegalArgumentException("Invalid parameter: verification.vps");
        }
        String commitment = crypto.hashJson(Map.of("responseDid", responseDid, "responseNonce", nonce));
        List<ChallengeReceipt> receipts = new ArrayList<>();
        for (Object vp : vps != null ? (List<?>) vps : List.of()) {
            if (!isVerifiableCredential(vp)) {
                throw new IllegalArgumentException("Invalid parameter: verification.vps");
            }
            Map<String, Object> credential = (Map<String, Object>) vp;
            List<?> types = (List<?>) credential.get("type");
            if (types.size() < 2 || !((String) types.get(1)).startsWith("did:")) {
                throw new IllegalArgumentException("Invalid parameter: verification.vps.type");
            }
            ChallengeReceipt receipt = new ChallengeReceipt();
            receipt.attesterDid = (String) credential.get("issuer");
            receipt.schemaDid = (String) types.get(1);
            receipt.requesterDid = requester;
            receipt.responseCommitment = commitment;
            receipts.add(receipt);
        }
        if (options.name != null && !options.name.isEmpty() && receipts.size() != 1) {
            throw new IllegalArgumentException("Invalid parameter: options.name");
        }
        CreateAssetOptions assetOptions = new CreateAssetOptions();
        assetOptions.registry = options.registry;
        assetOptions.validUntil = options.validUntil;
        assetOptions.name = options.name;
        List<String> dids = new ArrayList<>();
        for (ChallengeReceipt receipt : receipts) {
            dids.add(createAssetFor(Map.of("challengeReceipt", receipt), requester, assetOptions));
        }
        return dids;
    }

    public String createGroup(String name) {
        return createGroup(name, null);
    }

    public String createGroup(String name, CreateAssetOptions options) {
        java.util.Map<String, Object> group = new java.util.LinkedHashMap<>();
        group.put("name", name);
        group.put("members", new java.util.ArrayList<>());

        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("group", group);
        return createAsset(payload, options);
    }

    public Group getGroup(String id) {
        Map<String, Object> group = groupData(resolveDID(id));
        return group != null ? WalletJsonMapper.mapper().convertValue(group, Group.class) : null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> groupData(MdipDocument doc) {
        if (doc == null || doc.didDocument == null || doc.didDocument.controller == null
            || doc.didDocument.controller.isEmpty()
            || doc.didDocumentMetadata != null && Boolean.TRUE.equals(doc.didDocumentMetadata.deactivated)
            || !(doc.didDocumentData instanceof Map<?, ?>)) {
            return null;
        }
        Map<String, Object> data = (Map<String, Object>) doc.didDocumentData;
        if (data.get("members") instanceof List<?>) return data;
        Object group = data.get("group");
        return group instanceof Map<?, ?> ? (Map<String, Object>) group : null;
    }

    public boolean addGroupMember(String groupId, String memberId) {
        String groupDid = lookupDID(groupId);
        String memberDid = lookupDID(memberId);
        if (memberDid.equals(groupDid)) {
            throw new IllegalArgumentException("Invalid parameter: can't add a group to itself");
        }
        try {
            resolveDID(memberDid);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid parameter: memberId");
        }
        MdipDocument doc = resolveDID(groupDid);
        Map<String, Object> group = groupData(doc);
        if (group == null || !(group.get("members") instanceof List<?>)) {
            throw new IllegalArgumentException("Invalid parameter: groupId");
        }
        List<?> members = (List<?>) group.get("members");
        if (members.contains(memberDid)) return true;
        if (testGroup(memberId, groupId)) {
            throw new IllegalArgumentException("Invalid parameter: can't create mutual membership");
        }
        Set<Object> updated = new LinkedHashSet<>(members);
        updated.add(memberDid);
        return updateGroupMembers(doc, group, updated);
    }

    public boolean removeGroupMember(String groupId, String memberId) {
        String groupDid = lookupDID(groupId);
        String memberDid = lookupDID(memberId);
        try {
            resolveDID(memberDid);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid parameter: memberId");
        }
        MdipDocument doc = resolveDID(groupDid);
        Map<String, Object> group = groupData(doc);
        if (group == null || !(group.get("members") instanceof List<?>)) {
            throw new IllegalArgumentException("Invalid parameter: groupId");
        }
        List<?> members = (List<?>) group.get("members");
        if (!members.contains(memberDid)) return true;
        List<Object> updated = new ArrayList<>(members);
        updated.removeIf(memberDid::equals);
        return updateGroupMembers(doc, group, updated);
    }

    @SuppressWarnings("unchecked")
    private boolean updateGroupMembers(MdipDocument doc, Map<String, Object> group, Collection<?> members) {
        Map<String, Object> updated = new LinkedHashMap<>(group);
        updated.put("members", new ArrayList<>(members));
        if (doc.didDocumentData == group) {
            doc.didDocumentData = updated;
        } else {
            Map<String, Object> data = new LinkedHashMap<>((Map<String, Object>) doc.didDocumentData);
            data.put("group", updated);
            doc.didDocumentData = data;
        }
        if (!updateDID(doc)) {
            throw new IllegalStateException("DID update was rejected. Please try again.");
        }
        return true;
    }

    public boolean testGroup(String groupId) {
        return testGroup(groupId, null);
    }

    public boolean testGroup(String groupId, String memberId) {
        Set<String> visited = new HashSet<>();
        List<String> pending = new ArrayList<>(Collections.singletonList(groupId));
        String memberDid = memberId;
        while (!pending.isEmpty()) {
            String next = pending.remove(pending.size() - 1);
            try {
                String groupDid = lookupDID(next);
                if (!visited.add(groupDid)) continue;
                Group group = getGroup(groupDid);
                if (group == null) continue;
                if (memberDid == null || memberDid.isEmpty()) return true;
                memberDid = lookupDID(memberDid);
                if (group.members != null && group.members.contains(memberDid)) return true;
                if (group.members != null) {
                    for (int index = group.members.size() - 1; index >= 0; index--) {
                        pending.add(group.members.get(index));
                    }
                }
            } catch (Exception e) {
                // An unavailable member must not prevent checking the remaining branches.
            }
        }
        return false;
    }

    public java.util.List<String> listGroups(String owner) {
        java.util.List<String> assets = listAssets(owner);
        java.util.List<String> groups = new java.util.ArrayList<>();

        for (String did : assets) {
            if (testGroup(did)) {
                groups.add(did);
            }
        }

        return groups;
    }

    public java.util.List<String> listGroups() {
        return listGroups(null);
    }

    public java.util.Map<String, Object> bindCredential(String schemaId, String subjectId) {
        return bindCredential(schemaId, subjectId, null, null, null);
    }

    public java.util.Map<String, Object> bindCredential(
        String schemaId,
        String subjectId,
        BindCredentialOptions options
    ) {
        if (options == null) {
            return bindCredential(schemaId, subjectId, null, null, null);
        }
        return bindCredential(schemaId, subjectId, options.validFrom, options.validUntil, options.credential);
    }

    public java.util.Map<String, Object> bindCredential(
        String schemaId,
        String subjectId,
        String validFrom,
        String validUntil,
        java.util.Map<String, Object> credential
    ) {
        String issuer = fetchIdInfo(null).did;
        return bindCredentialFor(schemaId, subjectId, validFrom, validUntil, credential, issuer);
    }

    private java.util.Map<String, Object> bindCredentialFor(
        String schemaId, String subjectId, String validFrom, String validUntil,
        java.util.Map<String, Object> credential, String issuer
    ) {
        if (schemaId == null || schemaId.isBlank()) {
            throw new IllegalArgumentException("schemaId");
        }
        if (subjectId == null || subjectId.isBlank()) {
            throw new IllegalArgumentException("subjectId");
        }

        String from = validFrom != null && !validFrom.isEmpty() ? validFrom : nowIso();
        String type = lookupDID(schemaId);
        String subjectDid = lookupDID(subjectId);

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
        vc.put("issuer", issuer);
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
        String issuerDid = fetchIdInfo(null).did;
        if (credential == null) {
            throw new IllegalArgumentException("credential is required");
        }

        java.util.Map<String, Object> bound = credential;
        if (options != null && options.schema != null && options.subject != null) {
            bound = bindCredentialFor(
                options.schema, options.subject, options.validFrom, options.validUntil, credential, issuerDid
            );
        }

        Object issuer = bound.get("issuer");
        if (issuer == null || !issuer.equals(issuerDid)) {
            throw new IllegalArgumentException("credential.issuer");
        }

        java.util.Map<String, Object> signed = addSignatureInternal(bound, issuerDid);
        if (!isVerifiableCredential(signed)) {
            throw new IllegalArgumentException("credential");
        }
        String subjectId = (String) ((Map<?, ?>) signed.get("credentialSubject")).get("id");

        EncryptOptions encryption = options != null
            ? WalletJsonMapper.mapper().convertValue(options, EncryptOptions.class) : new EncryptOptions();
        encryption.includeHash = true;
        return encryptJsonFor(signed, subjectId, issuerDid, encryption);
    }

    public java.util.Map<String, Object> getCredential(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id is required");
        }
        String holder = fetchIdInfo(null).did;
        String did = lookupDID(id);
        Object vc = decryptJsonFor(did, holder);
        if (!isVerifiableCredential(vc)) {
            return null;
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> map = (java.util.Map<String, Object>) vc;
        return map;
    }

    public boolean removeCredential(String id) {
        String holder = fetchIdInfo(null).did;
        String did = lookupDID(id);
        return removeFromHeldFor(did, holder);
    }

    public java.util.List<String> listCredentials() {
        return listCredentials(null);
    }

    public java.util.List<String> listCredentials(String id) {
        IDInfo idInfo = fetchIdInfo(id);
        if (idInfo.held == null) {
            return new java.util.ArrayList<>();
        }
        return new java.util.ArrayList<>(idInfo.held);
    }

    public boolean acceptCredential(String id) {
        try {
            IDInfo current = fetchIdInfo(null);
            String did = lookupDID(id);
            Object vc = decryptJsonFor(did, current.did);
            if (!isVerifiableCredential(vc)) {
                return false;
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> map = (java.util.Map<String, Object>) vc;
            if (!current.did.equals(((Map<?, ?>) map.get("credentialSubject")).get("id")) || !verifyCredentialSignature(map)) {
                return false;
            }
            return addToHeldFor(did, current.did);
        } catch (Exception e) {
            return false;
        }
    }

    public java.util.List<String> listIssued() {
        return listIssued(null);
    }

    public java.util.List<String> listIssued(String issuer) {
        IDInfo id = fetchIdInfo(issuer);
        java.util.List<String> issued = new java.util.ArrayList<>();

        if (id.owned != null) {
            for (String did : id.owned) {
                try {
                    Object credential = decryptJsonFor(did, id.did);
                    if (isVerifiableCredential(credential)) {
                        @SuppressWarnings("unchecked")
                        java.util.Map<String, Object> map = (java.util.Map<String, Object>) credential;
                        if (id.did != null && id.did.equals(map.get("issuer"))) {
                            issued.add(did);
                        }
                    }
                } catch (Exception ignored) {
                    // Skip any malformed or non-credential assets.
                }
            }
        }

        return issued;
    }

    public boolean updateCredential(String did, java.util.Map<String, Object> credential) {
        String sender = fetchIdInfo(null).did;
        String credentialDid = lookupDID(did);
        Object original = decryptJsonFor(credentialDid, sender);
        if (!isVerifiableCredential(original)) {
            throw new IllegalArgumentException("did is not a credential");
        }
        Object claims = credential == null ? null : credential.get("credential");
        if (claims == null || Boolean.FALSE.equals(claims) || "".equals(claims)
            || claims instanceof Number && (((Number) claims).doubleValue() == 0 || Double.isNaN(((Number) claims).doubleValue()))
            || credential.get("credentialSubject") == null) {
            throw new IllegalArgumentException("credential");
        }

        Object subjectObj = credential.get("credentialSubject");
        if (!(subjectObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("credential");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
        Object subjectId = subject.get("id");
        if (!(subjectId instanceof String) || ((String) subjectId).isBlank()) {
            throw new IllegalArgumentException("credential");
        }
        if (!sender.equals(credential.get("issuer"))) {
            throw new IllegalArgumentException("credential.issuer");
        }

        java.util.Map<String, Object> unsigned = new java.util.LinkedHashMap<>(credential);
        unsigned.remove("signature");
        java.util.Map<String, Object> signed = addSignatureInternal(unsigned, sender);
        if (!isVerifiableCredential(signed)) {
            throw new IllegalArgumentException("credential");
        }

        String msg;
        try {
            msg = WalletJsonMapper.stringify(signed);
        } catch (Exception e) {
            throw new IllegalArgumentException("credential");
        }

        JwkPair senderKeypair = fetchKeyPair(sender);
        if (senderKeypair == null) {
            throw new IllegalArgumentException("no valid sender keypair");
        }

        MdipDocument holderDoc = resolveIdentityForCryptography((String) subjectId);
        EcdsaJwkPublic receivePublicJwk = getPublicKeyJwk(holderDoc);
        org.keychain.crypto.JwkPublic receiverCrypto = new org.keychain.crypto.JwkPublic(
            receivePublicJwk.kty,
            receivePublicJwk.crv,
            receivePublicJwk.x,
            receivePublicJwk.y
        );

        String cipherSender = crypto.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg);
        String cipherReceiver = crypto.encryptMessage(receiverCrypto, senderKeypair.privateJwk, msg);
        String msgHash = crypto.hashMessage(msg);

        MdipDocument doc = resolveDID(credentialDid);
        java.util.Map<String, Object> encrypted = new java.util.LinkedHashMap<>();
        encrypted.put("sender", sender);
        encrypted.put("created", nowIso());
        encrypted.put("cipher_hash", msgHash);
        encrypted.put("cipher_sender", cipherSender);
        encrypted.put("cipher_receiver", cipherReceiver);

        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("encrypted", encrypted);
        doc.didDocumentData = payload;
        return updateDID(doc);
    }

    public boolean revokeCredential(String credential) {
        return revokeDID(credential);
    }

    public java.util.Map<String, Object> publishCredential(String did) {
        return publishCredential(did, false);
    }

    public java.util.Map<String, Object> publishCredential(String did, PublishCredentialOptions options) {
        boolean reveal = options != null && Boolean.TRUE.equals(options.reveal);
        return publishCredential(did, reveal);
    }

    public java.util.Map<String, Object> publishCredential(String did, boolean reveal) {
        IDInfo id = fetchIdInfo(null);
        String credentialDid = lookupDID(did);
        Object vcObj = decryptJsonFor(credentialDid, id.did);
        if (!isVerifiableCredential(vcObj)) {
            throw new IllegalArgumentException("did is not a credential");
        }

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> vc = (java.util.Map<String, Object>) vcObj;
        Object subjectObj = vc.get("credentialSubject");
        if (subjectObj instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
            Object subjectId = subject.get("id");
            if (!(subjectId instanceof String) || !id.did.equals(subjectId)) {
                throw new IllegalArgumentException("only subject can publish a credential");
            }
        }

        MdipDocument doc = resolveDID(id.did);
        if (!(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
            doc.didDocumentData = new java.util.LinkedHashMap<>();
        }

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> data = (java.util.Map<String, Object>) doc.didDocumentData;
        Object manifestObj = data.get("manifest");
        java.util.Map<String, Object> manifest;
        if (manifestObj instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> manifestMap = (java.util.Map<String, Object>) manifestObj;
            manifest = manifestMap;
        } else {
            manifest = new java.util.LinkedHashMap<>();
        }

        java.util.Map<String, Object> stored = vc;
        if (!reveal) {
            stored = new java.util.LinkedHashMap<>(vc);
            stored.put("credential", null);
        }

        manifest.put(credentialDid, stored);
        data.put("manifest", manifest);
        doc.didDocumentData = data;

        boolean ok = updateDID(doc);
        if (!ok) {
            throw new IllegalStateException("update DID failed");
        }
        return stored;
    }

    public String unpublishCredential(String did) {
        IDInfo id = fetchIdInfo(null);
        MdipDocument doc = resolveDID(id.did);
        String credentialDid = lookupDID(did);

        if (doc.didDocumentData instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> data = (java.util.Map<String, Object>) doc.didDocumentData;
            Object manifestObj = data.get("manifest");
            if (manifestObj instanceof java.util.Map<?, ?>) {
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> manifest = (java.util.Map<String, Object>) manifestObj;
                if (manifest.containsKey(credentialDid)) {
                    manifest.remove(credentialDid);
                    data.put("manifest", manifest);
                    doc.didDocumentData = data;
                    if (!updateDID(doc)) {
                        throw new IllegalStateException("update DID failed");
                    }
                    return "OK credential " + did + " removed from manifest";
                }
            }
        }

        throw new IllegalArgumentException("did");
    }

    public MdipDocument resolveDID(String did) {
        return resolveDID(did, null);
    }

    public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        String actualDid = lookupDID(did);
        return checkedResolution(gatekeeper.resolveDID(actualDid, options));
    }

    private MdipDocument checkedResolution(MdipDocument doc) {
        if (doc != null && doc.didResolutionMetadata != null && doc.didResolutionMetadata.error != null) {
            String error = doc.didResolutionMetadata.error;
            if ("notFound".equals(error)) {
                throw new IllegalArgumentException("unknown");
            }
            if ("invalidDid".equals(error)) {
                throw new IllegalArgumentException("bad format");
            }
            throw new IllegalArgumentException("did");
        }
        return augmentDidMetadata(doc);
    }

    private MdipDocument augmentDidMetadata(MdipDocument doc) {
        if (doc != null) {
            String controller = null;
            if (doc.didDocument != null) {
                controller = doc.didDocument.controller != null ? doc.didDocument.controller : doc.didDocument.id;
            }
            DocumentMetadata metadata = doc.didDocumentMetadata != null ? doc.didDocumentMetadata : new DocumentMetadata();
            metadata.isOwned = controller != null && idInWallet(controller);
            doc.didDocumentMetadata = metadata;
        }
        return doc;
    }

    public boolean testAgent(String id) {
        MdipDocument doc = resolveDID(id);
        return doc != null && doc.mdip != null && "agent".equals(doc.mdip.type);
    }

    public boolean rotateKeys() {
        final boolean[] ok = {false};
        mutateWallet(wallet -> {
            IDInfo id = getCurrentIdInfo(wallet);
            if (id.index == Integer.MAX_VALUE) {
                throw new IllegalStateException("Identity key index range exhausted");
            }
            int nextIndex = id.index + 1;

            DeterministicKey master = walletManager.getHdKeyFromCacheOrMnemonic(wallet);
            DeterministicKey derived = HdKeyUtil.derivePath(master, id.account, nextIndex);
            JwkPair keypair = crypto.generateJwk(HdKeyUtil.privateKeyBytes(derived));

            MdipDocument doc = resolveDID(id.did);
            if (doc.didDocumentMetadata == null || (!Boolean.TRUE.equals(doc.didDocumentMetadata.confirmed)
                && !"1".equals(doc.didDocumentMetadata.version))) {
                throw new IllegalStateException("Keymaster: Cannot rotate keys");
            }
            if (doc.didDocument == null || doc.didDocument.verificationMethod == null
                || doc.didDocument.verificationMethod.isEmpty() || doc.didDocument.verificationMethod.get(0) == null) {
                throw new IllegalStateException("DID Document missing verificationMethod");
            }

            MdipDocument.VerificationMethod method = doc.didDocument.verificationMethod.get(0);
            method.id = "#key-" + ((long) nextIndex + 1);
            method.publicKeyJwk = JwkConverter.toEcdsaJwkPublic(keypair.publicJwk);
            doc.didDocument.authentication = java.util.List.of(method.id);

            ok[0] = updateDID(doc);
            if (!ok[0]) {
                throw new IllegalStateException("Cannot rotate keys");
            }

            id.index = nextIndex;
            // Keep an accepted rotation usable in memory if the subsequent wallet write fails.
            WalletFile cached = loadWallet();
            if (WalletJsonMapper.mapper().valueToTree(wallet.seed).equals(WalletJsonMapper.mapper().valueToTree(cached.seed))) {
                for (IDInfo cachedId : cached.ids.values()) {
                    if (didMatch(cachedId.did, id.did) && cachedId.account == id.account) {
                        cachedId.index = Math.max(cachedId.index, nextIndex);
                    }
                }
            }
        });

        return ok[0];
    }

    public boolean verifySignature(java.util.Map<String, Object> obj) {
        if (obj == null) {
            return false;
        }
        Object signatureObj = obj.get("signature");
        if (!(signatureObj instanceof java.util.Map<?, ?>)) {
            return false;
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> signature = (java.util.Map<String, Object>) signatureObj;
        Object signerObj = signature.get("signer");
        if (!(signerObj instanceof String) || ((String) signerObj).isBlank()) {
            return false;
        }

        java.util.Map<String, Object> copy = new java.util.LinkedHashMap<>(obj);
        copy.remove("signature");
        String msgHash = crypto.hashJson(copy);

        Object hashObj = signature.get("hash");
        if (hashObj instanceof String && !msgHash.equals(hashObj)) {
            return false;
        }

        Object signedObj = signature.get("signed");
        ResolveDIDOptions options = null;
        if (signedObj instanceof String) {
            options = new ResolveDIDOptions();
            options.versionTime = (String) signedObj;
        }
        MdipDocument doc = resolveDID((String) signerObj, options);
        EcdsaJwkPublic publicJwk = getPublicKeyJwk(doc);
        org.keychain.crypto.JwkPublic cryptoJwk = new org.keychain.crypto.JwkPublic(
            publicJwk.kty,
            publicJwk.crv,
            publicJwk.x,
            publicJwk.y
        );

        try {
            return crypto.verifySig(msgHash, (String) signature.get("value"), cryptoJwk);
        } catch (Exception e) {
            return false;
        }
    }

    private MdipDocument resolveWithRetries(String did, int retries, int delayMs) {
        while (retries >= 0) {
            try {
                return resolveDID(did);
            } catch (Exception e) {
                if (retries == 0) {
                    throw e;
                }
                retries -= 1;
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("interrupted");
                }
            }
        }
        return null;
    }

    private String findMatchingCredential(java.util.Map<String, Object> credential, String holder, long now) {
        IDInfo id = fetchIdInfo(holder);
        if (id.held == null) {
            return null;
        }

        for (String did : id.held) {
            try {
                Object docObj = decryptJsonFor(did, id.did);
                if (!isVerifiableCredential(docObj)) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> doc = (java.util.Map<String, Object>) docObj;
                Object subjectObj = doc.get("credentialSubject");
                if (!(subjectObj instanceof java.util.Map<?, ?>)) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
                Object subjectId = subject.get("id");
                if (!(subjectId instanceof String) || !id.did.equals(subjectId)) {
                    continue;
                }

                Object issuersObj = credential.get("issuers");
                if (issuersObj instanceof java.util.List<?> && !((List<?>) issuersObj).isEmpty()) {
                    Object issuerObj = doc.get("issuer");
                    if (issuerObj instanceof String && !((java.util.List<?>) issuersObj).contains(issuerObj)) {
                        continue;
                    }
                }

                Object schemaObj = credential.get("schema");
                Object typeObj = doc.get("type");
                List<?> types = (List<?>) typeObj;
                if (types.size() < 2 || !Objects.equals(types.get(1), schemaObj)) {
                    continue;
                }
                if (!isCredentialCurrent(doc, now) || !verifyCredentialSignature(doc)) {
                    continue;
                }

                return did;
            } catch (Exception ignored) {
                // Not encrypted or not a VC.
            }
        }

        return null;
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

    public Object resolveAsset(String did) {
        return resolveAsset(did, null);
    }

    public Object resolveAsset(String did, ResolveDIDOptions options) {
        MdipDocument doc = resolveDID(did, options);
        Object data = doc != null ? doc.didDocumentData : null;
        if (doc == null || doc.didDocument == null || doc.didDocument.controller == null
            || doc.didDocument.controller.isEmpty()
            || doc.didDocumentMetadata != null && Boolean.TRUE.equals(doc.didDocumentMetadata.deactivated)
            || data == null || Boolean.FALSE.equals(data) || "".equals(data)
            || data instanceof Number && (((Number) data).doubleValue() == 0 || Double.isNaN(((Number) data).doubleValue()))) {
            return new LinkedHashMap<String, Object>();
        }
        return data;
    }

    public boolean updateAsset(String did, java.util.Map<String, Object> data) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }

        MdipDocument doc = resolveDID(did);
        Map<String, Object> merged = assetProperties(doc.didDocumentData);
        merged.putAll(data);
        doc.didDocumentData = merged;
        return updateDID(doc);
    }

    private static Map<String, Object> assetProperties(Object data) {
        Map<String, Object> properties = new LinkedHashMap<>();
        if (data instanceof Map<?, ?>) {
            ((Map<?, ?>) data).forEach((key, value) -> properties.put((String) key, value));
        } else if (data instanceof List<?>) {
            List<?> values = (List<?>) data;
            for (int index = 0; index < values.size(); index++) {
                properties.put(Integer.toString(index), values.get(index));
            }
        } else if (data instanceof String) {
            String value = (String) data;
            // JavaScript object spread indexes strings by UTF-16 code unit.
            for (int index = 0; index < value.length(); index++) {
                properties.put(Integer.toString(index), value.substring(index, index + 1));
            }
        }
        return properties;
    }

    public boolean transferAsset(String assetDid, String controllerDid) {
        if (assetDid == null || assetDid.isBlank()) {
            throw new IllegalArgumentException("asset did is required");
        }
        if (controllerDid == null || controllerDid.isBlank()) {
            throw new IllegalArgumentException("controller did is required");
        }

        String resolvedAssetDid = lookupDID(assetDid);
        MdipDocument assetDoc = resolveDID(resolvedAssetDid);
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
        String resolvedControllerDid = controllerDoc.didDocument != null && controllerDoc.didDocument.id != null
            ? controllerDoc.didDocument.id
            : lookupDID(controllerDid);

        String prevOwner = assetDoc.didDocument.controller;
        if (resolvedControllerDid.equals(prevOwner)) {
            return true;
        }

        assetDoc.didDocument.controller = resolvedControllerDid;

        boolean ok = updateDID(assetDoc);
        if (ok && prevOwner != null) {
            removeFromOwned(resolvedAssetDid, prevOwner);
            try {
                addToOwned(resolvedAssetDid, resolvedControllerDid);
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

    public java.util.List<String> listAssets() {
        return listAssets(null);
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
        return ISO_MILLIS.format(NOW_SUPPLIER.get());
    }

    public java.util.Map<String, Object> addSignature(java.util.Map<String, Object> obj) {
        return addSignatureInternal(obj, null);
    }

    public java.util.Map<String, Object> addSignature(
        java.util.Map<String, Object> obj,
        String controllerDid
    ) {
        return addSignatureInternal(obj, controllerDid);
    }

    private java.util.Map<String, Object> addSignatureInternal(
        java.util.Map<String, Object> obj,
        String controllerDid
    ) {
        if (obj == null) {
            throw new IllegalArgumentException("obj");
        }

        IDInfo id = fetchIdInfo(controllerDid);
        JwkPair keypair = fetchKeyPair(id.did);
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

    public String validateName(String name) {
        return validateNameInternal(name, null);
    }

    private String validateNameInternal(String name, WalletFile wallet) {
        if (name == null || trimName(name).isEmpty()) {
            throw new IllegalArgumentException("Invalid parameter: name must be a non-empty string");
        }
        String trimmed = trimName(name);
        if (".".equals(trimmed) || "..".equals(trimmed)) {
            throw new IllegalArgumentException("Invalid parameter: name cannot be \".\" or \"..\"");
        }
        if (trimmed.length() > maxNameLength) {
            throw new IllegalArgumentException("Invalid parameter: name too long");
        }
        for (int i = 0; i < trimmed.length(); i += 1) {
            if (Character.isISOControl(trimmed.charAt(i))) {
                throw new IllegalArgumentException("Invalid parameter: name contains unprintable characters");
            }
        }
        if (wallet != null) {
            for (Map<?, ?> names : Arrays.asList(wallet.names, wallet.ids)) {
                if (names != null && names.keySet().stream().anyMatch(key -> trimName((String) key).equals(trimmed))) {
                    throw new IllegalArgumentException("Invalid parameter: name already used");
                }
            }
        }
        return trimmed;
    }

    private static String trimName(String name) {
        int start = 0;
        int end = name.length();
        while (start < end && isNameWhitespace(name.charAt(start))) {
            start++;
        }
        while (end > start && isNameWhitespace(name.charAt(end - 1))) {
            end--;
        }
        return name.substring(start, end);
    }

    private static boolean isNameWhitespace(char value) {
        // Match ECMAScript trim, including nonbreaking spaces and the byte-order mark.
        return value >= '\t' && value <= '\r' || value == '\ufeff' || value == '\u2028' || value == '\u2029'
            || Character.getType(value) == Character.SPACE_SEPARATOR;
    }

    private static String normalizeRegistry(String registry) {
        if (registry == null || registry.isBlank()) {
            return DEFAULT_REGISTRY;
        }
        return registry;
    }

    private void tallyDid(String did, CheckWalletResult result) {
        result.checked += 1;
        if (!isValidDID(did)) {
            result.invalid += 1;
            return;
        }
        try {
            MdipDocument doc = resolveDID(did);
            if (doc == null) {
                result.invalid += 1;
                return;
            }
            if (doc.didDocumentMetadata != null && Boolean.TRUE.equals(doc.didDocumentMetadata.deactivated)) {
                result.deleted += 1;
            }
        } catch (Exception e) {
            result.invalid += 1;
        }
    }

    private boolean shouldRemoveDid(String did) {
        if (!isValidDID(did)) {
            return true;
        }
        MdipDocument doc = resolveDID(did);
        if (doc == null) {
            throw new IllegalStateException("DID resolution failed");
        }
        return doc.didDocumentMetadata != null && Boolean.TRUE.equals(doc.didDocumentMetadata.deactivated);
    }

    private String encryptJsonFor(Object json, String receiverDid, String sender, EncryptOptions options) {
        String plaintext;
        try {
            plaintext = WalletJsonMapper.stringify(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("json", e);
        }
        return encryptMessageFor(plaintext, receiverDid, sender, options);
    }

    public String encryptMessage(String msg, String receiverDid) {
        return encryptMessage(msg, receiverDid, (EncryptOptions) null);
    }

    public String encryptMessage(String msg, String receiverDid, boolean includeHash) {
        EncryptOptions options = new EncryptOptions();
        options.includeHash = includeHash;
        return encryptMessage(msg, receiverDid, options);
    }

    public String encryptMessage(String msg, String receiverDid, EncryptOptions options) {
        return encryptMessageFor(msg, receiverDid, fetchIdInfo(null).did, options);
    }

    private String encryptMessageFor(String msg, String receiverDid, String senderDid, EncryptOptions options) {
        EncryptOptions effective = options != null ? options : new EncryptOptions();
        boolean includeHash = Boolean.TRUE.equals(effective.includeHash);
        boolean encryptForSender = effective.encryptForSender == null || effective.encryptForSender;
        if (receiverDid == null || receiverDid.isBlank()) {
            throw new IllegalArgumentException("receiver did is required");
        }
        String resolvedReceiver = lookupDID(receiverDid);
        IDInfo sender = fetchIdInfo(senderDid);
        JwkPair senderKeypair = fetchKeyPair(sender.did);
        if (senderKeypair == null) {
            throw new IllegalArgumentException("no valid sender keypair");
        }

        MdipDocument doc = resolveIdentityForCryptography(resolvedReceiver);
        EcdsaJwkPublic receiverJwk = getPublicKeyJwk(doc);
        org.keychain.crypto.JwkPublic receiverCrypto = new org.keychain.crypto.JwkPublic(
            receiverJwk.kty,
            receiverJwk.crv,
            receiverJwk.x,
            receiverJwk.y
        );

        String cipherSender = encryptForSender
            ? crypto.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg)
            : null;
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
        return createAssetFor(payload, sender.did, effective);
    }

    public String encryptJSON(Object json, String receiverDid) {
        return encryptJSON(json, receiverDid, (EncryptOptions) null);
    }

    public String encryptJSON(Object json, String receiverDid, boolean includeHash) {
        EncryptOptions options = new EncryptOptions();
        options.includeHash = includeHash;
        return encryptJSON(json, receiverDid, options);
    }

    public String encryptJSON(Object json, String receiverDid, EncryptOptions options) {
        return encryptJsonFor(json, receiverDid, fetchIdInfo(null).did, options);
    }

    public Object decryptJSON(String did) {
        return decryptJsonFor(did, fetchIdInfo(null).did);
    }

    private Object decryptJsonFor(String did, String recipient) {
        String plaintext = decryptMessageFor(did, recipient);
        return parseEncryptedJson(plaintext);
    }

    private Object parseEncryptedJson(String plaintext) {
        try {
            return WalletJsonMapper.mapper().readValue(plaintext, Object.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted JSON");
        }
    }

    public String decryptMessage(String did) {
        return decryptMessageFor(did, fetchIdInfo(null).did);
    }

    private String decryptMessageFor(String did, String recipient) {
        WalletFile wallet = loadWallet();
        IDInfo id = fetchIdInfo(recipient, wallet);
        Object assetObj = resolveAsset(did);
        return decryptAssetMessage(assetObj, wallet, id);
    }

    private String decryptAssetMessage(Object assetObj, WalletFile wallet, IDInfo id) {
        if (!(assetObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> data = (java.util.Map<String, Object>) assetObj;
        Object nested = data.get("encrypted");
        java.util.Map<String, Object> encrypted;
        if (nested instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> nestedMap = (java.util.Map<String, Object>) nested;
            encrypted = nestedMap;
        } else {
            encrypted = data;
        }

        Object senderObj = encrypted.get("sender");
        Object createdObj = encrypted.get("created");
        Object senderCipherObj = encrypted.get("cipher_sender");
        Object receiverCipherObj = encrypted.get("cipher_receiver");
        if (!(senderObj instanceof String) || !(createdObj instanceof String)) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted");
        }
        String senderDid = (String) senderObj;
        String created = (String) createdObj;
        String cipherSender = senderCipherObj instanceof String ? (String) senderCipherObj : null;
        String cipherReceiver = receiverCipherObj instanceof String ? (String) receiverCipherObj : null;
        if (cipherSender == null && cipherReceiver == null) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted");
        }

        MdipDocument senderDoc = resolveIdentityForCryptography(senderDid, created);
        EcdsaJwkPublic senderPublicJwk = getPublicKeyJwk(senderDoc);
        org.keychain.crypto.JwkPublic senderCrypto = new org.keychain.crypto.JwkPublic(
            senderPublicJwk.kty,
            senderPublicJwk.crv,
            senderPublicJwk.x,
            senderPublicJwk.y
        );

        String ciphertext = senderDid.equals(id.did) && cipherSender != null ? cipherSender : cipherReceiver;
        if (ciphertext == null) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted");
        }
        return decryptWithDerivedKeys(wallet, id, senderCrypto, ciphertext);
    }

    private String decryptWithDerivedKeys(
        WalletFile wallet,
        IDInfo id,
        org.keychain.crypto.JwkPublic senderPublicJwk,
        String ciphertext
    ) {
        DeterministicKey master = walletManager.getHdKeyFromCacheOrMnemonic(wallet);
        for (int index = id.index; index >= 0; index -= 1) {
            DeterministicKey derived = HdKeyUtil.derivePath(master, id.account, index);
            JwkPair receiver = crypto.generateJwk(HdKeyUtil.privateKeyBytes(derived));
            try {
                return crypto.decryptMessage(senderPublicJwk, receiver.privateJwk, ciphertext);
            } catch (Exception ignored) {
                // try older keys
            }
        }
        throw new IllegalArgumentException("ID can't decrypt ciphertext");
    }

    private static boolean isVerifiableCredential(Object obj) {
        if (!(obj instanceof Map<?, ?>)) {
            return false;
        }
        Map<?, ?> vc = (Map<?, ?>) obj;
        Object context = vc.get("@context");
        Object type = vc.get("type");
        Object subject = vc.get("credentialSubject");
        Object signature = vc.get("signature");
        Object fromValue = vc.get("validFrom");
        Object untilValue = vc.get("validUntil");
        double from = credentialTimestamp(fromValue);
        double until = credentialTimestamp(untilValue);
        if (!(context instanceof List<?>) || ((List<?>) context).isEmpty()
            || !"https://www.w3.org/ns/credentials/v2".equals(((List<?>) context).get(0))) {
            return false;
        }
        for (Object value : (List<?>) context) {
            if (!(value instanceof String)) return false;
            Matcher url = CREDENTIAL_CONTEXT_URL.matcher((String) value);
            if (!url.find() || url.group(1) != null && Integer.parseInt(url.group(1)) > 65535) return false;
        }
        if (!(type instanceof List<?>) || !((List<?>) type).contains("VerifiableCredential")
            || ((List<?>) type).stream().anyMatch(value -> !(value instanceof String) || ((String) value).isEmpty())
            || !(vc.get("issuer") instanceof String) || !isValidDID((String) vc.get("issuer"))
            || fromValue != null && !Double.isFinite(from)
            || untilValue != null && !Double.isFinite(until)
            || fromValue != null && untilValue != null && !credentialPeriodOrdered((String) fromValue, (String) untilValue, from, until)
            || !(subject instanceof Map<?, ?>) || !(((Map<?, ?>) subject).get("id") instanceof String)
            || !isValidDID((String) ((Map<?, ?>) subject).get("id"))
            || !(signature instanceof Map<?, ?>)) {
            return false;
        }
        Map<?, ?> sig = (Map<?, ?>) signature;
        return sig.get("signer") instanceof String && isValidDID((String) sig.get("signer"))
            && Double.isFinite(credentialTimestamp(sig.get("signed")))
            && (!sig.containsKey("hash") || sig.get("hash") instanceof String && !((String) sig.get("hash")).isEmpty())
            && sig.get("value") instanceof String && !((String) sig.get("value")).isEmpty();
    }

    private boolean verifyCredentialSignature(Map<String, Object> credential) {
        Object signature = credential.get("signature");
        return credential.get("issuer") instanceof String && signature instanceof Map<?, ?>
            && credential.get("issuer").equals(((Map<?, ?>) signature).get("signer"))
            && verifySignature(credential);
    }

    private static double credentialTimestamp(Object value) {
        if (!(value instanceof String)) return Double.NaN;
        Matcher match = CREDENTIAL_DATE.matcher((String) value);
        if (!match.matches()) return Double.NaN;
        try {
            int year = Integer.parseInt(match.group(1));
            int month = Integer.parseInt(match.group(2));
            int day = Integer.parseInt(match.group(3));
            int hour = Integer.parseInt(match.group(4));
            int minute = Integer.parseInt(match.group(5));
            int second = Integer.parseInt(match.group(6));
            String fraction = match.group(7) == null ? "" : match.group(7);
            String zone = match.group(8);
            if (hour > 24 || hour == 24 && (minute != 0 || second != 0 || hasNonzeroDigit(fraction, 0))) return Double.NaN;
            long epochDay = LocalDate.of(year, month, day).toEpochDay();
            // Keep the reference Date range before timezone adjustment and fractional rounding.
            if (Math.abs(epochDay) > 100_000_000L) return Double.NaN;
            String firstDigits = fraction.substring(0, Math.min(3, fraction.length()));
            int millis = Integer.parseInt((firstDigits + "000").substring(0, 3));
            long time = epochDay * 86_400_000L + hour * 3_600_000L + minute * 60_000L + second * 1000L + millis;
            if (Math.abs(time) > 8_640_000_000_000_000L) return Double.NaN;
            long offset = 0;
            if (!"Z".equals(zone)) {
                offset = (Integer.parseInt(zone.substring(1, 3)) * 60L + Integer.parseInt(zone.substring(4, 6))) * 60_000L;
                if (offset > 14 * 60 * 60_000L) return Double.NaN;
                if (zone.charAt(0) == '-') offset = -offset;
            }
            // Round up so comparisons against the integer millisecond clock preserve the boundary.
            return time - offset + (hasNonzeroDigit(fraction, 3) ? 1 : 0);
        } catch (DateTimeException | NumberFormatException invalid) {
            return Double.NaN;
        }
    }

    private static boolean credentialPeriodOrdered(String fromValue, String untilValue, double from, double until) {
        if (from != until) return from < until;
        String fromRemainder = credentialFractionRemainder(fromValue);
        String untilRemainder = credentialFractionRemainder(untilValue);
        double fromBase = from - (hasNonzeroDigit(fromRemainder, 0) ? 1 : 0);
        double untilBase = until - (hasNonzeroDigit(untilRemainder, 0) ? 1 : 0);
        if (fromBase != untilBase) return fromBase < untilBase;
        int length = Math.max(fromRemainder.length(), untilRemainder.length());
        for (int index = 0; index < length; index++) {
            char fromDigit = index < fromRemainder.length() ? fromRemainder.charAt(index) : '0';
            char untilDigit = index < untilRemainder.length() ? untilRemainder.charAt(index) : '0';
            if (fromDigit != untilDigit) return fromDigit < untilDigit;
        }
        return true;
    }

    private static String credentialFractionRemainder(String value) {
        Matcher match = CREDENTIAL_DATE.matcher(value);
        String fraction = match.matches() ? match.group(7) : null;
        return fraction != null && fraction.length() > 3 ? fraction.substring(3) : "";
    }

    private static boolean hasNonzeroDigit(String value, int start) {
        for (int index = start; index < value.length(); index++) {
            if (value.charAt(index) != '0') return true;
        }
        return false;
    }

    private static boolean isCredentialCurrent(Map<String, Object> credential, long now) {
        Object from = credential.get("validFrom");
        Object until = credential.get("validUntil");
        return (from == null || credentialTimestamp(from) <= now) && (until == null || now < credentialTimestamp(until));
    }

    public boolean addToOwned(String did, String ownerDid) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        mutateWallet(wallet -> {
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

    public boolean addToHeld(String did) {
        return addToHeldFor(did, fetchIdInfo(null).did);
    }

    private boolean addToHeldFor(String did, String holder) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        mutateWallet(wallet -> {
            IDInfo idInfo = fetchIdInfo(holder, wallet);
            if (idInfo.held == null) {
                idInfo.held = new java.util.ArrayList<>();
            }
            if (!idInfo.held.contains(did)) {
                idInfo.held.add(did);
            }
        });
        return true;
    }

    public boolean removeFromHeld(String did) {
        return removeFromHeldFor(did, fetchIdInfo(null).did);
    }

    private boolean removeFromHeldFor(String did, String holder) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        final boolean[] changed = {false};
        mutateWallet(wallet -> {
            IDInfo idInfo = fetchIdInfo(holder, wallet);
            if (idInfo.held == null) {
                return;
            }
            if (idInfo.held.removeIf(did::equals)) {
                changed[0] = true;
            }
        });
        return changed[0];
    }

    public boolean removeFromOwned(String did, String ownerDid) {
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        final boolean[] ownerFound = {false};
        mutateWallet(wallet -> {
            try {
                IDInfo idInfo = fetchIdInfo(ownerDid, wallet);
                if (idInfo.owned == null) {
                    return;
                }
                ownerFound[0] = true;
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

    public boolean idInWallet(String did) {
        try {
            fetchIdInfo(did);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public IDInfo fetchIdInfo(String nameOrDid, WalletFile wallet) {
        WalletFile currentWallet = wallet != null ? wallet : loadWallet();
        if (currentWallet == null) {
            throw new IllegalStateException("wallet not loaded");
        }

        IDInfo idInfo = null;
        if (nameOrDid == null || nameOrDid.isBlank()) {
            if (currentWallet.current == null || currentWallet.current.isBlank()) {
                throw new IllegalStateException("Keymaster: No current ID");
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

        MdipDocument doc = resolveIdentityForCryptography(id.did);
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

    private MdipDocument resolveIdentityForCryptography(String did) {
        return resolveIdentityForCryptography(did, null);
    }

    private MdipDocument resolveIdentityForCryptography(String did, String versionTime) {
        String identityDid = lookupDID(did);
        ResolveDIDOptions options = new ResolveDIDOptions();
        options.confirm = true;
        options.versionTime = versionTime;
        MdipDocument doc = gatekeeper.resolveDID(identityDid, options);
        if (doc != null && doc.didResolutionMetadata != null && "notFound".equals(doc.didResolutionMetadata.error)) {
            // Use only the immutable create key while registry confirmation is pending.
            ResolveDIDOptions initial = new ResolveDIDOptions();
            initial.versionSequence = 1;
            initial.versionTime = versionTime;
            doc = gatekeeper.resolveDID(identityDid, initial);
        }
        return checkedResolution(doc);
    }

    public boolean updateDID(MdipDocument doc) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (doc == null || doc.didDocument == null || doc.didDocument.id == null || doc.didDocument.id.isBlank()) {
            throw new IllegalArgumentException("doc.didDocument.id is required");
        }

        MdipDocument update = WalletJsonMapper.mapper().convertValue(doc, MdipDocument.class);
        String did = update.didDocument.id;
        String expectedPrevid = update.didDocumentMetadata != null ? update.didDocumentMetadata.versionId : null;
        MdipDocument current = resolveDID(did);
        String currentPrevid = current != null && current.didDocumentMetadata != null ? current.didDocumentMetadata.versionId : null;
        if (expectedPrevid != null && !expectedPrevid.equals(currentPrevid)) {
            return false;
        }
        String previd = expectedPrevid != null ? expectedPrevid : currentPrevid;
        String registry = current != null && current.mdip != null ? current.mdip.registry : null;

        if (current != null) {
            MdipDocument currentCopy = WalletJsonMapper.mapper().convertValue(current, MdipDocument.class);
            MdipDocument docCopy = WalletJsonMapper.mapper().convertValue(update, MdipDocument.class);
            currentCopy.didDocumentMetadata = null;
            currentCopy.didResolutionMetadata = null;
            docCopy.didDocumentMetadata = null;
            docCopy.didResolutionMetadata = null;
            String currentHash = crypto.hashJson(currentCopy);
            String updateHash = crypto.hashJson(docCopy);
            if (currentHash.equals(updateHash)) {
                return true;
            }
        }

        BlockInfo block = gatekeeper.getBlock(registry);
        String blockid = block != null ? block.hash : null;

        String signerDid = current != null && current.didDocument != null
            ? (current.mdip != null && "agent".equals(current.mdip.type) ? current.didDocument.id : current.didDocument.controller)
            : did;

        JwkPair keypair = fetchKeyPair(signerDid);
        if (keypair == null) {
            throw new IllegalStateException("addSignature: no keypair");
        }
        Operation signed = operationFactory.createSignedUpdateDidOperation(
            did,
            previd,
            blockid,
            update,
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
            ? (current.mdip != null && "agent".equals(current.mdip.type) ? current.didDocument.id : current.didDocument.controller)
            : did;

        JwkPair keypair = fetchKeyPair(signerDid);
        if (keypair == null) {
            throw new IllegalStateException("addSignature: no keypair");
        }
        Operation signed = new OperationSignerImpl(crypto).sign(operation, keypair.privateJwk, signerDid);
        return gatekeeper.deleteDID(signed);
    }

    public boolean revokeDID(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id is required");
        }
        String did = lookupDID(id);
        MdipDocument current = resolveDID(did);
        String controller = current != null && current.didDocument != null ? current.didDocument.controller : null;

        boolean ok = deleteDID(did);
        if (ok && controller != null && !controller.isBlank()) {
            removeFromOwned(did, controller);
        }
        return ok;
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
            throw new IllegalStateException("Keymaster: No current ID");
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

    public JwkPair hdKeyPair() {
        WalletFile wallet = loadWallet();
        DeterministicKey master = walletManager.getHdKeyFromCacheOrMnemonic(wallet);
        return crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
    }

    private static void replaceWallet(WalletFile target, WalletFile source) {
        target.version = source.version;
        target.seed = source.seed;
        target.counter = source.counter;
        target.ids = source.ids;
        target.current = source.current;
        target.names = source.names;
        target.extras = source.extras;
        Map<String, Object> metadata = new LinkedHashMap<>(source.additionalProperties());
        target.additionalProperties().clear();
        target.additionalProperties().putAll(metadata);
    }

    private static boolean didMatch(String did1, String did2) {
        if (did1 == null || did2 == null) {
            return false;
        }
        String suffix1 = did1.substring(did1.lastIndexOf(':') + 1);
        String suffix2 = did2.substring(did2.lastIndexOf(':') + 1);
        return suffix1.equals(suffix2);
    }

    private void validateValidUntil(String validUntil) {
        if (validUntil == null) {
            return;
        }
        if (validUntil.isBlank()) {
            throw new IllegalArgumentException("options.validUntil");
        }
        try {
            Instant.parse(validUntil);
            return;
        } catch (java.time.format.DateTimeParseException ignored) {
            // fall through
        }
        try {
            java.time.LocalDate.parse(validUntil);
        } catch (java.time.format.DateTimeParseException ignored) {
            throw new IllegalArgumentException("options.validUntil");
        }
    }

    private static boolean isValidDID(String did) {
        if (did == null || !did.startsWith("did:")) {
            return false;
        }
        String[] parts = did.split(":", -1);
        if (parts.length < 3) {
            return false;
        }
        String suffix = parts[parts.length - 1];
        if (suffix == null || suffix.isBlank()) {
            return false;
        }
        return Cid.isValid(suffix);
    }

    public EcdsaJwkPublic getPublicKeyJwk(MdipDocument doc) {
        if (doc == null || doc.didDocument == null || doc.didDocument.verificationMethod == null) {
            throw new IllegalArgumentException("Missing didDocument.");
        }
        if (doc.didDocument.verificationMethod.isEmpty()) {
            throw new IllegalArgumentException("The DID document does not contain any verification methods.");
        }
        EcdsaJwkPublic publicKeyJwk = doc.didDocument.verificationMethod.get(0).publicKeyJwk;
        if (publicKeyJwk == null) {
            throw new IllegalArgumentException("The publicKeyJwk is missing in the first verification method.");
        }
        return publicKeyJwk;
    }

    public String getAgentDID(MdipDocument doc) {
        if (doc == null || doc.mdip == null || !"agent".equals(doc.mdip.type)) {
            throw new IllegalArgumentException("Document is not an agent");
        }
        if (doc.didDocument == null || doc.didDocument.id == null || doc.didDocument.id.isBlank()) {
            throw new IllegalArgumentException("Agent document does not have a DID");
        }
        return doc.didDocument.id;
    }
}
