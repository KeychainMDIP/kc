package org.keychain.keymaster;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import org.bitcoinj.crypto.DeterministicKey;
import org.keychain.cid.Cid;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import java.util.ArrayList;
import java.util.List;
import org.keychain.gatekeeper.GatekeeperClient;
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
    private final GatekeeperClient gatekeeper;
    private final OperationFactory operationFactory;
    private final String defaultRegistry;

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperClient gatekeeper,
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
        this.walletManager = new KeymasterWalletManager(store, crypto, passphrase);
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperClient gatekeeper,
        KeymasterCrypto crypto,
        OperationFactory operationFactory,
        String passphrase
    ) {
        this(store, gatekeeper, crypto, operationFactory, passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperClient gatekeeper,
        KeymasterCrypto crypto,
        String passphrase
    ) {
        this(store, gatekeeper, crypto, new OperationFactory(crypto), passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(
        WalletStore<WalletEncFile> store,
        GatekeeperClient gatekeeper,
        KeymasterCrypto crypto,
        String passphrase,
        String defaultRegistry
    ) {
        this(store, gatekeeper, crypto, new OperationFactory(crypto), passphrase, defaultRegistry);
    }

    public Keymaster(WalletStore<WalletEncFile> store, KeymasterCrypto crypto, String passphrase) {
        this(store, null, crypto, passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(WalletStore<WalletEncFile> store, GatekeeperClient gatekeeper, String passphrase) {
        this(store, gatekeeper, new KeymasterCryptoImpl(), passphrase, DEFAULT_REGISTRY);
    }

    public Keymaster(WalletStore<WalletEncFile> store, GatekeeperClient gatekeeper, String passphrase, String defaultRegistry) {
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

    public WalletEncFile exportEncryptedWallet() {
        WalletFile wallet = loadWallet();
        WalletCrypto walletCrypto = new WalletCrypto(crypto, passphrase);
        return walletCrypto.encryptForStorage(wallet);
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
            throw new IllegalStateException("no current id");
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

        if (doc.didDocumentData == null || !(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
            doc.didDocumentData = new java.util.LinkedHashMap<String, Object>();
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
            if (doc == null || doc.didDocumentData == null || !(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
                throw new IllegalArgumentException("didDocumentData missing vault");
            }

            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> docData = (java.util.Map<String, Object>) doc.didDocumentData;
            Object vaultObj = docData.get("vault");
            if (!(vaultObj instanceof String)) {
                throw new IllegalArgumentException("didDocumentData missing vault");
            }

            MdipDocument vault = resolveAsset((String) vaultObj);
            if (vault == null || vault.didDocumentData == null || !(vault.didDocumentData instanceof java.util.Map<?, ?>)) {
                throw new IllegalArgumentException("backup not found in vault");
            }
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> vaultData = (java.util.Map<String, Object>) vault.didDocumentData;
            Object backupObj = vaultData.get("backup");
            if (!(backupObj instanceof String)) {
                throw new IllegalArgumentException("backup not found in vault");
            }

            String decrypted = crypto.decryptMessage(keypair.publicJwk, keypair.privateJwk, (String) backupObj);
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
                if (wallet.ids != null && wallet.ids.containsKey(name)) {
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
            MdipDocument asset = resolveAsset(did);
            if (asset == null || asset.didDocumentData == null) {
                throw new IllegalArgumentException("No asset data found");
            }

            java.util.Map<String, Object> data;
            if (asset.didDocumentData instanceof java.util.Map<?, ?>) {
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> map = (java.util.Map<String, Object>) asset.didDocumentData;
                data = map;
            } else {
                throw new IllegalArgumentException("No asset data found");
            }

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
        if (registry == null || registry.isBlank()) {
            throw new IllegalArgumentException("registry is required");
        }

        final String[] createdDid = new String[1];
        mutateWallet(wallet -> {
            String validName = validateNameInternal(name, wallet);

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

            wallet.ids.put(validName, idInfo);
            wallet.counter = account + 1;
            wallet.current = validName;
        });

        return createdDid[0];
    }

    public String createId(String name) {
        return createId(name, defaultRegistry);
    }

    public Operation createIdOperation(String name) {
        return createIdOperation(name, 0, null);
    }

    public Operation createIdOperation(String name, int account) {
        return createIdOperation(name, account, null);
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
        String validName = validateNameInternal(name, wallet);
        JwkPair keypair = getCurrentKeypairFromPath(wallet, account, 0);

        BlockInfo block = gatekeeper.getBlock(targetRegistry);
        String blockid = block != null ? block.hash : null;

        Operation signed = operationFactory.createSignedCreateIdOperation(
            targetRegistry,
            JwkConverter.toEcdsaJwkPublic(keypair.publicJwk),
            keypair.privateJwk,
            blockid
        );

        return signed;
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
            mutateWallet(updated -> {
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

    public String createSchema(Object schema) {
        return createSchema(schema, defaultRegistry);
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

        return encryptJsonInternal(signed, (String) subjectId, true);
    }

    public String sendCredential(String did) {
        java.util.Map<String, Object> vc = getCredential(did);
        if (vc == null) {
            return null;
        }

        Object subjectObj = vc.get("credentialSubject");
        if (!(subjectObj instanceof java.util.Map<?, ?>)) {
            throw new IllegalArgumentException("credential.credentialSubject.id");
        }
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> subject = (java.util.Map<String, Object>) subjectObj;
        Object subjectId = subject.get("id");
        if (!(subjectId instanceof String) || ((String) subjectId).isBlank()) {
            throw new IllegalArgumentException("credential.credentialSubject.id");
        }

        String validUntil = ISO_MILLIS.format(Instant.now().plusSeconds(7 * 24 * 60 * 60));
        java.util.Map<String, Object> notice = new java.util.LinkedHashMap<>();
        notice.put("to", java.util.List.of(subjectId));
        notice.put("dids", java.util.List.of(did));
        return createNotice(notice, defaultRegistry, validUntil);
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

    public java.util.List<String> verifyRecipientList(java.util.List<?> list) {
        if (list == null) {
            throw new IllegalArgumentException("list");
        }

        java.util.List<String> newList = new java.util.ArrayList<>();
        for (Object obj : list) {
            if (!(obj instanceof String)) {
                String type = obj == null ? "null" : obj.getClass().getSimpleName();
                throw new IllegalArgumentException("Invalid recipient type: " + type);
            }

            String id = (String) obj;
            String did = id;

            if (!isValidDID(id)) {
                try {
                    did = lookupDID(id);
                } catch (IllegalArgumentException e) {
                    throw new IllegalArgumentException("Invalid recipient: " + id);
                }
            }

            if (!isValidDID(did)) {
                throw new IllegalArgumentException("Invalid recipient: " + id);
            }

            if (gatekeeper != null) {
                MdipDocument doc = resolveDID(did);
                if (doc == null || doc.mdip == null || !"agent".equals(doc.mdip.type)) {
                    throw new IllegalArgumentException("Invalid recipient: " + id);
                }
            }

            newList.add(did);
        }

        return newList;
    }

    public java.util.List<String> verifyDIDList(java.util.List<?> didList) {
        if (didList == null) {
            throw new IllegalArgumentException("didList");
        }

        java.util.List<String> verified = new java.util.ArrayList<>();
        for (Object obj : didList) {
            if (!(obj instanceof String)) {
                throw new IllegalArgumentException("Invalid DID: " + obj);
            }

            String did = (String) obj;
            if (!isValidDID(did)) {
                throw new IllegalArgumentException("Invalid DID: " + did);
            }
            verified.add(did);
        }

        return verified;
    }

    public java.util.Map<String, Object> verifyNotice(java.util.Map<String, Object> notice) {
        if (notice == null) {
            throw new IllegalArgumentException("notice");
        }

        Object toObj = notice.get("to");
        Object didsObj = notice.get("dids");
        java.util.List<String> to = verifyRecipientList(toObj instanceof java.util.List<?> ? (java.util.List<?>) toObj : null);
        java.util.List<String> dids = verifyDIDList(didsObj instanceof java.util.List<?> ? (java.util.List<?>) didsObj : null);

        if (to.isEmpty()) {
            throw new IllegalArgumentException("notice.to");
        }
        if (dids.isEmpty()) {
            throw new IllegalArgumentException("notice.dids");
        }

        java.util.Map<String, Object> verified = new java.util.LinkedHashMap<>();
        verified.put("to", to);
        verified.put("dids", dids);
        return verified;
    }

    public String createNotice(java.util.Map<String, Object> message) {
        return createNotice(message, defaultRegistry, null);
    }

    public String createNotice(java.util.Map<String, Object> message, String registry, String validUntil) {
        java.util.Map<String, Object> notice = verifyNotice(message);
        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("notice", notice);
        String targetRegistry = registry == null || registry.isBlank() ? defaultRegistry : registry;
        return createAsset(payload, targetRegistry, null, validUntil);
    }

    public boolean updateNotice(String id, java.util.Map<String, Object> message) {
        java.util.Map<String, Object> notice = verifyNotice(message);
        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("notice", notice);
        return updateAsset(id, payload);
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
        java.util.Map<String, Object> signed = addSignature(unsigned, null);

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
        if (doc.didDocumentData == null || !(doc.didDocumentData instanceof java.util.Map<?, ?>)) {
            doc.didDocumentData = new java.util.LinkedHashMap<String, Object>();
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
        if (gatekeeper == null) {
            throw new IllegalStateException("gatekeeper not configured");
        }
        if (did == null || did.isBlank()) {
            throw new IllegalArgumentException("did is required");
        }
        String actualDid = lookupDID(did);
        MdipDocument doc = gatekeeper.resolveDID(actualDid, null);
        if (doc != null) {
            String controller = null;
            if (doc.didDocument != null) {
                controller = doc.didDocument.controller != null ? doc.didDocument.controller : doc.didDocument.id;
            }
            DocumentMetadata metadata = doc.didDocumentMetadata != null ? doc.didDocumentMetadata : new DocumentMetadata();
            metadata.isOwned = controller != null ? idInWallet(controller) : false;
            doc.didDocumentMetadata = metadata;
        }
        return doc;
    }

    public boolean testAgent(String id) {
        MdipDocument doc = resolveDID(id);
        return doc != null && doc.mdip != null && "agent".equals(doc.mdip.type);
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
        return ISO_MILLIS.format(NOW_SUPPLIER.get());
    }

    static void setNowSupplier(Supplier<Instant> supplier) {
        NOW_SUPPLIER = supplier != null ? supplier : Instant::now;
    }

    static void resetNowSupplier() {
        NOW_SUPPLIER = Instant::now;
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

    public String validateName(String name) {
        return validateNameInternal(name, null);
    }

    private static String validateNameInternal(String name, WalletFile wallet) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("name must be a non-empty string");
        }
        String trimmed = name.trim();
        if (trimmed.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("name too long");
        }
        for (int i = 0; i < trimmed.length(); i += 1) {
            if (Character.isISOControl(trimmed.charAt(i))) {
                throw new IllegalArgumentException("name contains unprintable characters");
            }
        }
        if (wallet != null) {
            if (wallet.names != null && wallet.names.containsKey(trimmed)) {
                throw new IllegalArgumentException("name already used");
            }
            if (wallet.ids != null && wallet.ids.containsKey(trimmed)) {
                throw new IllegalArgumentException("name already used");
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
        if (did == null || !isValidDID(did)) {
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
        if (did == null || !isValidDID(did)) {
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
        String plaintext;
        try {
            plaintext = WalletJsonMapper.mapper().writeValueAsString(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("json");
        }
        return encryptMessage(plaintext, receiverDid, includeHash);
    }

    public String encryptMessage(String msg, String receiverDid) {
        return encryptMessage(msg, receiverDid, false);
    }

    public String encryptMessage(String msg, String receiverDid, boolean includeHash) {
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
        return createAsset(payload, defaultRegistry);
    }

    public String encryptJSON(Object json, String receiverDid) {
        return encryptJsonInternal(json, receiverDid, false);
    }

    public String encryptJSON(Object json, String receiverDid, boolean includeHash) {
        return encryptJsonInternal(json, receiverDid, includeHash);
    }

    public Object decryptJSON(String did) {
        String plaintext = decryptMessage(did);
        try {
            return WalletJsonMapper.mapper().readValue(plaintext, Object.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("did not encrypted JSON");
        }
    }

    public String decryptMessage(String did) {
        WalletFile wallet = loadWallet();
        IDInfo id = fetchIdInfo(null, wallet);
        MdipDocument asset = resolveAsset(did);

        if (asset == null || asset.didDocumentData == null) {
            throw new IllegalArgumentException("did not encrypted");
        }

        java.util.Map<String, Object> encrypted;
        if (asset.didDocumentData instanceof java.util.Map<?, ?>) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> data = (java.util.Map<String, Object>) asset.didDocumentData;
            Object nested = data.get("encrypted");
            if (nested instanceof java.util.Map<?, ?>) {
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> nestedMap = (java.util.Map<String, Object>) nested;
                encrypted = nestedMap;
            } else {
                encrypted = data;
            }
        } else {
            throw new IllegalArgumentException("did not encrypted");
        }

        Object senderObj = encrypted.get("sender");
        Object createdObj = encrypted.get("created");
        Object senderCipherObj = encrypted.get("cipher_sender");
        Object receiverCipherObj = encrypted.get("cipher_receiver");
        if (!(senderObj instanceof String) || !(createdObj instanceof String)) {
            throw new IllegalArgumentException("did not encrypted");
        }
        String senderDid = (String) senderObj;
        String created = (String) createdObj;
        String cipherSender = senderCipherObj instanceof String ? (String) senderCipherObj : null;
        String cipherReceiver = receiverCipherObj instanceof String ? (String) receiverCipherObj : null;
        if (cipherSender == null && cipherReceiver == null) {
            throw new IllegalArgumentException("did not encrypted");
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
            throw new IllegalArgumentException("did not encrypted");
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
            if (idInfo.held.removeIf(item -> did.equals(item))) {
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

    public boolean idInWallet(String did) {
        try {
            fetchIdInfo(did);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public String hashJson(Object obj) {
        return crypto.hashJson(obj);
    }

    public boolean verifySig(String msgHashHex, String sigCompactHex, org.keychain.crypto.JwkPublic publicJwk) {
        return crypto.verifySig(msgHashHex, sigCompactHex, publicJwk);
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

    private JwkPair hdKeyPair() {
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
