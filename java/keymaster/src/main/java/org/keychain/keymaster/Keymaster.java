package org.keychain.keymaster;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Consumer;
import java.util.function.Supplier;
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
    private final KeymasterWalletManager walletManager;
    private final KeymasterCrypto crypto;
    private final String passphrase;
    private final GatekeeperInterface gatekeeper;
    private final OperationFactory operationFactory;
    private final String defaultRegistry;
    private final String ephemeralRegistry;

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperInterface gatekeeper,
        KeymasterCrypto crypto,
        OperationFactory operationFactory,
        String passphrase,
        String defaultRegistry
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
        this.defaultRegistry = normalizeRegistry(defaultRegistry);
        this.ephemeralRegistry = this.defaultRegistry;
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
        WalletFile wallet = walletManager.loadWallet();
        if (wallet == null) {
            return newWallet(null, false);
        }
        return wallet;
    }

    public boolean saveWallet(WalletFile wallet, boolean overwrite) {
        return walletManager.saveWallet(wallet, overwrite);
    }

    public boolean saveWallet(WalletEncFile wallet, boolean overwrite) {
        if (wallet == null) {
            throw new IllegalArgumentException("wallet is required");
        }
        if (wallet.salt != null || wallet.iv != null || wallet.data != null) {
            throw new IllegalStateException("Keymaster: Unsupported wallet version.");
        }
        if (wallet.version != 1 || wallet.seed == null || wallet.seed.mnemonicEnc == null || wallet.enc == null) {
            throw new IllegalStateException("Keymaster: Unsupported wallet version.");
        }

        try {
            walletManager.decryptStoredWallet(wallet);
        } catch (IllegalStateException e) {
            throw new IllegalStateException("Keymaster: Incorrect passphrase.");
        }

        try {
            return walletManager.saveStoredWallet(wallet, overwrite);
        } catch (IllegalStateException e) {
            throw new IllegalStateException("Keymaster: Incorrect passphrase.");
        }
    }

    public boolean mutateWallet(Consumer<WalletFile> mutator) {
        loadWallet();
        return walletManager.mutateWallet(mutator);
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
            String validNew = validateNameInternal(newName, null);
            if (wallet.ids == null || !wallet.ids.containsKey(currentName)) {
                throw new IllegalArgumentException("unknown id");
            }
            if (wallet.ids.containsKey(validNew)) {
                throw new IllegalArgumentException("name already used");
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

        JwkPair keypair = hdKeyPair();
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
        IDInfo idInfo = fetchIdInfo(name, wallet);
        JwkPair keypair = hdKeyPair();

        java.util.Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("name", name);
        data.put("id", idInfo);
        String msg;
        try {
            msg = WalletJsonMapper.mapper().writeValueAsString(data);
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
        String vaultDid = createAsset(payload, registry, name, null);

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

            mutateWallet(wallet -> {
                if (wallet.ids == null) {
                    wallet.ids = new java.util.LinkedHashMap<>();
                }
                if (wallet.ids.containsKey(name)) {
                    throw new IllegalStateException(name + " already exists in wallet");
                }
                wallet.ids.put(name, idInfo);
                wallet.current = name;
                wallet.counter = wallet.counter + 1;
            });

            return name;
        } catch (Exception e) {
            if (e instanceof IllegalStateException) {
                throw (IllegalStateException) e;
            }
            throw new IllegalArgumentException("did");
        }
    }

    public boolean updateSeedBank(MdipDocument doc) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (doc == null || doc.didDocument == null || doc.didDocument.id == null || doc.didDocument.id.isBlank()) {
            throw new IllegalArgumentException("Invalid parameter: seed bank missing DID");
        }

        JwkPair keypair = hdKeyPair();
        String did = doc.didDocument.id;
        MdipDocument current = gatekeeper.resolveDID(did, null);
        String previd = current != null && current.didDocumentMetadata != null ? current.didDocumentMetadata.versionId : null;

        Operation operation = new Operation();
        operation.type = "update";
        operation.did = did;
        operation.previd = previd;
        operation.doc = doc;

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

        JwkPair keypair = hdKeyPair();
        MdipDocument seedBank = resolveSeedBank();
        String msg;
        try {
            msg = WalletJsonMapper.mapper().writeValueAsString(wallet);
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
            updateSeedBank(seedBank);
        }

        return backupDid;
    }

    public WalletFile recoverWallet() {
        return recoverWallet(null);
    }

    public WalletFile recoverWallet(String did) {
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

            WalletFile upgraded = walletManager.upgradeWallet(recovered);
            if (upgraded.version != null && upgraded.version == 1 && upgraded.seed != null && upgraded.seed.mnemonicEnc != null) {
                String mnemonic = decryptMnemonic();
                upgraded.seed.mnemonicEnc = MnemonicEncryption.encrypt(mnemonic, passphrase);
            }

            mutateWallet(current -> replaceWallet(current, upgraded));
            return loadWallet();
        } catch (Exception e) {
            return loadWallet();
        }
    }

    public String createId(String name, String registry) {
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        String targetRegistry = registry == null || registry.isBlank() ? defaultRegistry : registry;

        final String[] createdDid = new String[1];
        mutateWallet(wallet -> {
            String validName = validateNameInternal(name, wallet);

            int account = wallet.counter;
            int index = 0;
            JwkPair keypair = getCurrentKeypairFromPath(wallet, account, index);

            BlockInfo block = gatekeeper.getBlock(targetRegistry);
            String blockid = block != null ? block.hash : null;

            Operation signed = operationFactory.createSignedCreateIdOperation(
                targetRegistry,
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

            wallet.ids.put(validName, idInfo);
            wallet.counter = account + 1;
            wallet.current = validName;
        });

        return createdDid[0];
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
            blockid
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
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("registry is required");
        }
        validateValidUntil(validUntil);

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
            mutateWallet(updated -> {
                IDInfo current = getCurrentIdInfo(updated);
                if (current.owned == null) {
                    current.owned = new ArrayList<>();
                }
                List<String> owned = current.owned;
                if (!owned.contains(did)) {
                    owned.add(did);
                }
            });
        }
        return did;
    }

    public String createAsset(Object data, CreateAssetOptions options) {
        if (options == null) {
            return createAsset(data, defaultRegistry, null, null);
        }
        String registry = options.registry != null ? options.registry : defaultRegistry;
        String validUntil = options.validUntil;
        String controller = options.controller;
        String did = createAsset(data, registry, controller, validUntil);
        if (options.name != null && !options.name.isBlank()) {
            addName(options.name, did);
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
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public java.util.Map<String, Object> createTemplate(String schemaId) {
        if (!testSchema(schemaId)) {
            throw new IllegalArgumentException("Invalid parameter: schemaId");
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

    public java.util.List<String> listSchemas() {
        return listSchemas(null);
    }

    public String cloneAsset(String id) {
        return cloneAsset(id, null, null);
    }

    public String cloneAsset(String id, String registry, String controller) {
        MdipDocument assetDoc = resolveDID(id);
        if (assetDoc == null || assetDoc.mdip == null || !"asset".equals(assetDoc.mdip.type)) {
            throw new IllegalArgumentException("id");
        }

        java.util.Map<String, Object> assetData = new java.util.LinkedHashMap<>();
        if (assetDoc.didDocumentData instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> data = (java.util.Map<String, Object>) assetDoc.didDocumentData;
            assetData.putAll(data);
        }
        assetData.put("cloned", assetDoc.didDocument != null ? assetDoc.didDocument.id : null);

        String targetRegistry = registry;
        if (targetRegistry == null || targetRegistry.isBlank()) {
            targetRegistry = assetDoc.mdip.registry ;
        }

        return createAsset(assetData, targetRegistry, controller, null);
    }

    public String createResponse(String challengeDid) {
        return createResponse(challengeDid, null);
    }

    public String createResponse(String challengeDid, CreateResponseOptions options) {
        CreateResponseOptions effective = options != null ? options : new CreateResponseOptions();
        int retries = effective.retries != null ? effective.retries : 0;
        int delay = effective.delay != null ? effective.delay : 1000;

        if (effective.registry == null || effective.registry.isBlank()) {
            effective.registry = ephemeralRegistry;
        }
        if (effective.validUntil == null) {
            effective.validUntil = ISO_MILLIS.format(Instant.now().plusSeconds(3600));
        }
        boolean encryptForSender = effective.encryptForSender == null || effective.encryptForSender;

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
                String match = findMatchingCredential(spec);
                if (match != null) {
                    matches.add(match);
                }
            }
        }

        java.util.List<java.util.Map<String, Object>> pairs = new java.util.ArrayList<>();
        for (String vcDid : matches) {
            String plaintext = decryptMessage(vcDid);
            String vpDid = encryptMessage(
                plaintext,
                requestor,
                true,
                effective.registry,
                effective.validUntil,
                encryptForSender
            );
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

        java.util.Map<String, Object> wrapper = new java.util.LinkedHashMap<>();
        wrapper.put("response", response);
        return encryptJsonInternal(
            wrapper,
            requestor,
            false,
            effective.registry,
            effective.validUntil,
            encryptForSender
        );
    }

    public java.util.Map<String, Object> verifyResponse(String responseDid) {
        return verifyResponse(responseDid, null);
    }

    public java.util.Map<String, Object> verifyResponse(String responseDid, CreateResponseOptions options) {
        CreateResponseOptions effective = options != null ? options : new CreateResponseOptions();
        int retries = effective.retries != null ? effective.retries : 0;
        int delay = effective.delay != null ? effective.delay : 1000;

        MdipDocument responseDoc = resolveWithRetries(responseDid, retries, delay);
        if (responseDoc == null) {
            throw new IllegalArgumentException("responseDID does not resolve");
        }

        Object wrapperObj = decryptJSON(responseDid);
        if (!(wrapperObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("responseDID not a valid challenge response");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> wrapper = (java.util.Map<String, Object>) wrapperObj;
        Object responseObj = wrapper.get("response");
        if (!(responseObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("responseDID not a valid challenge response");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> response = (java.util.Map<String, Object>) responseObj;

        Object challengeDidObj = response.get("challenge");
        if (!(challengeDidObj instanceof String)) {
            throw new IllegalArgumentException("challenge not found");
        }
        Object result = resolveAsset((String) challengeDidObj);
        if (!(result instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("challenge not found");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> resultMap = (java.util.Map<String, Object>) result;
        Object challengeObj = resultMap.get("challenge");
        if (!(challengeObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("Invalid parameter: challengeDID");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> challenge = (java.util.Map<String, Object>) challengeObj;

        java.util.List<java.util.Map<String, Object>> vps = new java.util.ArrayList<>();
        Object credentialsObj = response.get("credentials");
        if (credentialsObj instanceof java.util.List<?>) {
            for (Object entry : (java.util.List<?>) credentialsObj) {
                if (!(entry instanceof java.util.Map<?, ?>)) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> pair = (java.util.Map<String, Object>) entry;
                Object vcObj = pair.get("vc");
                Object vpObj = pair.get("vp");
                if (!(vcObj instanceof String) || !(vpObj instanceof String)) {
                    continue;
                }

                Object vcData = resolveAsset((String) vcObj);
                Object vpData = resolveAsset((String) vpObj);
                if (!(vcData instanceof java.util.Map<?, ?>) || !(vpData instanceof java.util.Map<?, ?>)) {
                    continue;
                }

                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> vcDataMap = (java.util.Map<String, Object>) vcData;
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> vpDataMap = (java.util.Map<String, Object>) vpData;
                Object vcEncryptedObj = vcDataMap.get("encrypted");
                Object vpEncryptedObj = vpDataMap.get("encrypted");
                if (!(vcEncryptedObj instanceof java.util.Map<?, ?>) || !(vpEncryptedObj instanceof java.util.Map<?, ?>)) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> vcEncrypted = (java.util.Map<String, Object>) vcEncryptedObj;
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> vpEncrypted = (java.util.Map<String, Object>) vpEncryptedObj;
                Object vcHash = vcEncrypted.get("cipher_hash");
                Object vpHash = vpEncrypted.get("cipher_hash");
                if (vcHash == null || !vcHash.equals(vpHash)) {
                    continue;
                }

                Object vpPlain = decryptJSON((String) vpObj);
                if (!(vpPlain instanceof java.util.Map<?, ?>)) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> vp = (java.util.Map<String, Object>) vpPlain;
                if (!verifySignature(vp)) {
                    continue;
                }

                Object typesObj = vp.get("type");
                if (!(typesObj instanceof java.util.List<?>)) {
                    continue;
                }

                if (((java.util.List<?>) typesObj).size() >= 2) {
                    Object schemaObj = ((java.util.List<?>) typesObj).get(1);
                    if (schemaObj instanceof String) {
                        String schema = (String) schemaObj;
                        Object challengeCredentialsObj = challenge.get("credentials");
                        if (challengeCredentialsObj instanceof java.util.List<?>) {
                            java.util.Map<String, Object> matchSpec = null;
                            for (Object specObj : (java.util.List<?>) challengeCredentialsObj) {
                                if (specObj instanceof java.util.Map<?, ?>) {
                                    @SuppressWarnings("unchecked")
                                    java.util.Map<String, Object> spec = (java.util.Map<String, Object>) specObj;
                                    if (schema.equals(spec.get("schema"))) {
                                        matchSpec = spec;
                                        break;
                                    }
                                }
                            }
                            if (matchSpec != null) {
                                Object issuersObj = matchSpec.get("issuers");
                                if (issuersObj instanceof java.util.List<?>) {
                                    Object issuerObj = vp.get("issuer");
                                    if (issuerObj instanceof String) {
                                        if (!((java.util.List<?>) issuersObj).contains(issuerObj)) {
                                            continue;
                                        }
                                    }
                                }
                            } else {
                                continue;
                            }
                        }
                    }
                }

                vps.add(vp);
            }
        }

        response.put("vps", vps);
        Object challengeCredentialsObj = challenge.get("credentials");
        int requested = challengeCredentialsObj instanceof java.util.List<?> ? ((java.util.List<?>) challengeCredentialsObj).size() : 0;
        response.put("match", vps.size() == requested);
        response.put("responder", responseDoc.didDocument != null ? responseDoc.didDocument.controller : null);

        return response;
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
        Object asset = resolveAsset(id);
        if (!(asset instanceof java.util.Map<?, ?>)) {
            return null;
        }

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> map = (java.util.Map<String, Object>) asset;
        if (map.isEmpty()) {
            return null;
        }

        if (map.containsKey("members")) {
            return WalletJsonMapper.mapper().convertValue(map, Group.class);
        }

        Object groupObj = map.get("group");
        if (groupObj == null) {
            return null;
        }

        return WalletJsonMapper.mapper().convertValue(groupObj, Group.class);
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

        Group group = getGroup(groupId);
        if (group == null || group.members == null) {
            throw new IllegalArgumentException("Invalid parameter: groupId");
        }

        if (group.members.contains(memberDid)) {
            return true;
        }

        boolean isMember = testGroup(memberId, groupId);
        if (isMember) {
            throw new IllegalArgumentException("Invalid parameter: can't create mutual membership");
        }

        java.util.Set<String> members = new java.util.LinkedHashSet<>(group.members);
        members.add(memberDid);
        group.members = new java.util.ArrayList<>(members);

        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("group", WalletJsonMapper.mapper().convertValue(group, java.util.Map.class));
        return updateAsset(groupDid, payload);
    }

    public boolean removeGroupMember(String groupId, String memberId) {
        String groupDid = lookupDID(groupId);
        String memberDid = lookupDID(memberId);
        Group group = getGroup(groupDid);

        if (group == null || group.members == null) {
            throw new IllegalArgumentException("Invalid parameter: groupId");
        }

        try {
            resolveDID(memberDid);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid parameter: memberId");
        }

        if (!group.members.contains(memberDid)) {
            return true;
        }

        java.util.Set<String> members = new java.util.LinkedHashSet<>(group.members);
        members.remove(memberDid);
        group.members = new java.util.ArrayList<>(members);

        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("group", WalletJsonMapper.mapper().convertValue(group, java.util.Map.class));
        return updateAsset(groupDid, payload);
    }

    public boolean testGroup(String groupId) {
        return testGroup(groupId, null);
    }

    public boolean testGroup(String groupId, String memberId) {
        try {
            Group group = getGroup(groupId);
            if (group == null) {
                return false;
            }

            if (memberId == null || memberId.isBlank()) {
                return true;
            }

            String didMember = lookupDID(memberId);
            boolean isMember = group.members != null && group.members.contains(didMember);

            if (!isMember && group.members != null) {
                for (String did : group.members) {
                    isMember = testGroup(did, didMember);
                    if (isMember) {
                        break;
                    }
                }
            }

            return isMember;
        } catch (Exception e) {
            return false;
        }
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

        java.util.Map<String, Object> signed = addSignatureInternal(bound, null);
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

        String targetRegistry = options != null ? options.registry : null;
        String targetValidUntil = options != null ? options.validUntil : null;
        boolean encryptForSender = options == null || options.encryptForSender == null || options.encryptForSender;
        return encryptJsonInternal(signed, (String) subjectId, true, targetRegistry, targetValidUntil, encryptForSender);
    }

    public java.util.Map<String, Object> getCredential(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id is required");
        }
        String did = lookupDID(id);
        Object vc = decryptJSON(did);
        if (!isVerifiableCredential(vc)) {
            return null;
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> map = (java.util.Map<String, Object>) vc;
        return map;
    }

    public boolean removeCredential(String id) {
        String did = lookupDID(id);
        return removeFromHeld(did);
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
            Object vc = decryptJSON(did);
            if (isVerifiableCredential(vc)) {
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> map = (java.util.Map<String, Object>) vc;
                Object subjectObj = map.get("credentialSubject");
                if (subjectObj instanceof java.util.Map<?, ?>) {
                    @SuppressWarnings("unchecked")
                    java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
                    Object subjectId = subject.get("id");
                    if (subjectId instanceof String && !current.did.equals(subjectId)) {
                        return false;
                    }
                }
            }
            return addToHeld(did);
        } catch (Exception e) {
            return false;
        }
    }

    public java.util.List<String> listIssued(String issuer) {
        IDInfo id = fetchIdInfo(issuer);
        java.util.List<String> issued = new java.util.ArrayList<>();

        if (id.owned != null) {
            for (String did : id.owned) {
                try {
                    Object credential = decryptJSON(did);
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
        String credentialDid = lookupDID(did);
        Object original = decryptJSON(credentialDid);
        if (!isVerifiableCredential(original)) {
            throw new IllegalArgumentException("did is not a credential");
        }
        if (credential == null ||
            credential.get("credential") == null ||
            credential.get("credentialSubject") == null) {
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

        java.util.Map<String, Object> unsigned = new java.util.LinkedHashMap<>(credential);
        unsigned.remove("signature");
        java.util.Map<String, Object> signed = addSignatureInternal(unsigned, null);

        String msg;
        try {
            msg = WalletJsonMapper.mapper().writeValueAsString(signed);
        } catch (Exception e) {
            throw new IllegalArgumentException("credential");
        }

        IDInfo sender = fetchIdInfo(null);
        JwkPair senderKeypair = fetchKeyPair(null);
        if (senderKeypair == null) {
            throw new IllegalArgumentException("no valid sender keypair");
        }

        ResolveDIDOptions options = new ResolveDIDOptions();
        options.confirm = true;
        MdipDocument holderDoc = gatekeeper.resolveDID((String) subjectId, options);
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
        encrypted.put("sender", sender.did);
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
        Object vcObj = decryptJSON(credentialDid);
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
                    updateDID(doc);
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
        MdipDocument doc = gatekeeper.resolveDID(actualDid, options);
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
            int nextIndex = id.index + 1;

            DeterministicKey master = walletManager.getHdKeyFromCacheOrMnemonic(wallet);
            DeterministicKey derived = HdKeyUtil.derivePath(master, id.account, nextIndex);
            JwkPair keypair = crypto.generateJwk(HdKeyUtil.privateKeyBytes(derived));

            MdipDocument doc = resolveDID(id.did);
            if (doc.didDocumentMetadata == null || !Boolean.TRUE.equals(doc.didDocumentMetadata.confirmed)) {
                throw new IllegalStateException("Keymaster: Cannot rotate keys");
            }
            if (doc.didDocument == null || doc.didDocument.verificationMethod == null) {
                throw new IllegalStateException("DID Document missing verificationMethod");
            }

            MdipDocument.VerificationMethod method = doc.didDocument.verificationMethod.get(0);
            method.id = "#key-" + (nextIndex + 1);
            method.publicKeyJwk = JwkConverter.toEcdsaJwkPublic(keypair.publicJwk);
            doc.didDocument.authentication = java.util.List.of(method.id);

            ok[0] = updateDID(doc);
            if (!ok[0]) {
                throw new IllegalStateException("Cannot rotate keys");
            }

            id.index = nextIndex;
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

    private String findMatchingCredential(java.util.Map<String, Object> credential) {
        IDInfo id = fetchIdInfo(null);
        if (id.held == null) {
            return null;
        }

        for (String did : id.held) {
            try {
                Object docObj = decryptJSON(did);
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
                if (issuersObj instanceof java.util.List<?>) {
                    Object issuerObj = doc.get("issuer");
                    if (issuerObj instanceof String && !((java.util.List<?>) issuersObj).contains(issuerObj)) {
                        continue;
                    }
                }

                Object schemaObj = credential.get("schema");
                Object typeObj = doc.get("type");
                if (schemaObj instanceof String && typeObj instanceof java.util.List<?>) {
                    if (!((java.util.List<?>) typeObj).contains(schemaObj)) {
                        continue;
                    }
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
        try {
            MdipDocument doc = resolveDID(did);
            if (doc == null || doc.mdip == null || !"asset".equals(doc.mdip.type)) {
                return new java.util.LinkedHashMap<String, Object>();
            }
            if (doc.didDocumentMetadata != null && Boolean.TRUE.equals(doc.didDocumentMetadata.deactivated)) {
                return new java.util.LinkedHashMap<String, Object>();
            }
            if (doc.didDocument == null || doc.didDocument.controller == null || doc.didDocument.controller.isBlank()) {
                return new java.util.LinkedHashMap<String, Object>();
            }
            return Objects.requireNonNullElseGet(doc.didDocumentData, LinkedHashMap::new);
        } catch (IllegalArgumentException e) {
            String msg = e.getMessage();
            if ("unknown id".equals(msg) || "bad format".equals(msg) || "unknown".equals(msg)) {
                throw e;
            }
            return new java.util.LinkedHashMap<String, Object>();
        } catch (Exception e) {
            return new java.util.LinkedHashMap<String, Object>();
        }
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
        for (java.util.Map.Entry<String, Object> entry : data.entrySet()) {
            if (entry.getValue() == null) {
                merged.remove(entry.getKey());
            } else {
                merged.put(entry.getKey(), entry.getValue());
            }
        }
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

    public String validateName(String name) {
        return validateNameInternal(name, null);
    }

    private static String validateNameInternal(String name, WalletFile wallet) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Invalid parameter: name must be a non-empty string");
        }
        String trimmed = name.trim();
        if (trimmed.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("Invalid parameter: name too long");
        }
        for (int i = 0; i < trimmed.length(); i += 1) {
            if (Character.isISOControl(trimmed.charAt(i))) {
                throw new IllegalArgumentException("Invalid parameter: name contains unprintable characters");
            }
        }
        if (wallet != null) {
            if (wallet.names != null && wallet.names.containsKey(trimmed)) {
                throw new IllegalArgumentException("Invalid parameter: name already used");
            }
            if (wallet.ids != null && wallet.ids.containsKey(trimmed)) {
                throw new IllegalArgumentException("Invalid parameter: name already used");
            }
        }
        return trimmed;
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
        try {
            MdipDocument doc = resolveDID(did);
            if (doc == null) {
                return true;
            }
            return doc.didDocumentMetadata != null && Boolean.TRUE.equals(doc.didDocumentMetadata.deactivated);
        } catch (Exception e) {
            return true;
        }
    }

    private String encryptJsonInternal(Object json, String receiverDid, boolean includeHash) {
        return encryptJsonInternal(json, receiverDid, includeHash, null, null, true);
    }

    private String encryptJsonInternal(
        Object json,
        String receiverDid,
        boolean includeHash,
        String registry,
        String validUntil
    ) {
        return encryptJsonInternal(json, receiverDid, includeHash, registry, validUntil, true);
    }

    private String encryptJsonInternal(
        Object json,
        String receiverDid,
        boolean includeHash,
        String registry,
        String validUntil,
        boolean encryptForSender
    ) {
        String plaintext;
        try {
            plaintext = WalletJsonMapper.mapper().writeValueAsString(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("json");
        }
        return encryptMessage(plaintext, receiverDid, includeHash, registry, validUntil, encryptForSender);
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
        EncryptOptions effective = options != null ? options : new EncryptOptions();
        boolean includeHash = effective.includeHash != null && effective.includeHash;
        boolean encryptForSender = effective.encryptForSender == null || effective.encryptForSender;
        return encryptMessage(
            msg,
            receiverDid,
            includeHash,
            effective.registry,
            effective.validUntil,
            encryptForSender
        );
    }

    private String encryptMessage(
        String msg,
        String receiverDid,
        boolean includeHash,
        String registry,
        String validUntil,
        boolean encryptForSender
    ) {
        if (receiverDid == null || receiverDid.isBlank()) {
            throw new IllegalArgumentException("receiver did is required");
        }
        String resolvedReceiver = lookupDID(receiverDid);
        IDInfo sender = fetchIdInfo(null);
        JwkPair senderKeypair = fetchKeyPair(null);
        if (senderKeypair == null) {
            throw new IllegalArgumentException("no valid sender keypair");
        }

        ResolveDIDOptions options = new ResolveDIDOptions();
        options.confirm = true;
        MdipDocument doc = gatekeeper.resolveDID(resolvedReceiver, options);
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
        String targetRegistry = registry == null || registry.isBlank() ? defaultRegistry : registry;
        return createAsset(payload, targetRegistry, null, validUntil);
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
        EncryptOptions effective = options != null ? options : new EncryptOptions();
        boolean includeHash = effective.includeHash != null && effective.includeHash;
        boolean encryptForSender = effective.encryptForSender == null || effective.encryptForSender;
        return encryptJsonInternal(
            json,
            receiverDid,
            includeHash,
            effective.registry,
            effective.validUntil,
            encryptForSender
        );
    }

    public Object decryptJSON(String did) {
        String plaintext = decryptMessage(did);
        try {
            return WalletJsonMapper.mapper().readValue(plaintext, Object.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid parameter: did not encrypted JSON");
        }
    }

    public String decryptMessage(String did) {
        WalletFile wallet = loadWallet();
        IDInfo id = fetchIdInfo(null, wallet);
        Object assetObj = resolveAsset(did);
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

        ResolveDIDOptions options = new ResolveDIDOptions();
        options.confirm = true;
        options.versionTime = created;
        MdipDocument senderDoc = gatekeeper.resolveDID(senderDid, options);
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
        if (!(obj instanceof java.util.Map<?, ?>)) {
            return false;
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> map = (java.util.Map<String, Object>) obj;
        Object context = map.get("@context");
        Object type = map.get("type");
        Object issuer = map.get("issuer");
        Object subject = map.get("credentialSubject");
        return context instanceof java.util.List<?> &&
            type instanceof java.util.List<?> &&
            issuer != null &&
            subject != null;
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
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        mutateWallet(wallet -> {
            IDInfo idInfo = getCurrentIdInfo(wallet);
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
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        final boolean[] changed = {false};
        mutateWallet(wallet -> {
            IDInfo idInfo = getCurrentIdInfo(wallet);
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

        if (current != null) {
            MdipDocument currentCopy = WalletJsonMapper.mapper().convertValue(current, MdipDocument.class);
            MdipDocument docCopy = WalletJsonMapper.mapper().convertValue(doc, MdipDocument.class);
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
            ? (current.didDocument.controller != null ? current.didDocument.controller : current.didDocument.id)
            : did;

        JwkPair keypair = fetchKeyPair(signerDid);
        if (keypair == null) {
            throw new IllegalStateException("addSignature: no keypair");
        }
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
        String[] parts = did.split(":");
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
