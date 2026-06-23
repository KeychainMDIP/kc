package org.keychain.demo.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.model.CheckWalletResult;
import org.keychain.keymaster.model.FixWalletResult;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.store.WalletStore;
import org.keychain.demo.config.KeymasterConfig;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.keymaster.Keymaster;
import org.keychain.keymaster.CreateAssetOptions;
import org.springframework.stereotype.Service;

@Service
public class KeymasterService {
    private final ObjectMapper mapper;
    private final WalletStore<WalletEncFile> walletStore;
    private final GatekeeperInterface gatekeeper;
    private final String registry;
    private Keymaster keymaster;

    public KeymasterService(
        WalletStore<WalletEncFile> walletStore,
        GatekeeperInterface gatekeeper,
        KeymasterConfig config
    ) {
        this.walletStore = walletStore;
        this.gatekeeper = gatekeeper;
        this.registry = config.getRegistry();
        this.mapper = new ObjectMapper();
        this.mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
    }

    public Keymaster getKeymaster() {
        return requireKeymaster();
    }

    public boolean isReady() {
        return keymaster != null;
    }

    public boolean hasWallet() {
        return walletStore.loadWallet() != null;
    }

    public void initWithPassphrase(String passphrase, boolean createIfMissing) {
        if (passphrase == null || passphrase.isBlank()) {
            throw new IllegalArgumentException("Passphrase is required");
        }
        Keymaster instance = new Keymaster(walletStore, gatekeeper, passphrase, registry);
        if (createIfMissing && walletStore.loadWallet() == null) {
            instance.newWallet(null, true);
        } else {
            instance.loadWallet();
        }
        this.keymaster = instance;
    }

    public void resetWallet(String passphrase) {
        if (passphrase == null || passphrase.isBlank()) {
            throw new IllegalArgumentException("Passphrase is required");
        }
        Keymaster instance = new Keymaster(walletStore, gatekeeper, passphrase, registry);
        instance.newWallet(null, true);
        this.keymaster = instance;
    }

    public void initWithUploadedWallet(String passphrase, WalletEncFile wallet) {
        if (passphrase == null || passphrase.isBlank()) {
            throw new IllegalArgumentException("Passphrase is required");
        }
        if (wallet == null || wallet.version != 1 || wallet.seed == null || wallet.seed.mnemonicEnc == null) {
            throw new IllegalArgumentException("Unsupported wallet file");
        }

        WalletJsonMemory<WalletEncFile> memory = new WalletJsonMemory<>(WalletEncFile.class);
        memory.saveWallet(wallet, true);
        Keymaster temp = new Keymaster(memory, gatekeeper, passphrase, registry);
        temp.loadWallet();

        walletStore.saveWallet(wallet, true);
        Keymaster instance = new Keymaster(walletStore, gatekeeper, passphrase, registry);
        instance.loadWallet();
        this.keymaster = instance;
    }

    public WalletEncFile parseWalletEncFile(String json) {
        try {
            return mapper.readValue(json, WalletEncFile.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid wallet file", e);
        }
    }

    private Keymaster requireKeymaster() {
        if (keymaster == null) {
            throw new IllegalStateException("Passphrase not set");
        }
        return keymaster;
    }

    public String currentId() {
        return requireKeymaster().getCurrentId();
    }

    public List<String> listIds() {
        return requireKeymaster().listIds();
    }

    public String createId(String name) {
        return requireKeymaster().createId(name);
    }

    public String createId(String name, String registry) {
        return requireKeymaster().createId(name, registry);
    }

    public boolean renameId(String currentName, String newName) {
        return requireKeymaster().renameId(currentName, newName);
    }

    public boolean removeId(String name) {
        return requireKeymaster().removeId(name);
    }

    public boolean backupId(String id) {
        return requireKeymaster().backupId(id);
    }

    public String recoverId(String did) {
        return requireKeymaster().recoverId(did);
    }

    public boolean rotateKeys() {
        return requireKeymaster().rotateKeys();
    }

    public String validateName(String name) {
        return requireKeymaster().validateName(name);
    }

    public void setCurrentId(String name) {
        requireKeymaster().setCurrentId(name);
    }

    public MdipDocument resolveDID(String nameOrDid) {
        return requireKeymaster().resolveDID(nameOrDid);
    }

    public Object resolveAsset(String id) {
        return requireKeymaster().resolveAsset(id);
    }

    public java.util.Map<String, String> listNames(boolean includeIds) {
        return requireKeymaster().listNames(includeIds);
    }

    public java.util.List<String> listGroups() {
        return requireKeymaster().listGroups();
    }

    public String createChallenge(java.util.Map<String, Object> challenge, String registry) {
        if (challenge == null) {
            challenge = new java.util.LinkedHashMap<>();
        }
        CreateAssetOptions options = null;
        if (registry != null && !registry.isBlank()) {
            options = new CreateAssetOptions();
            options.registry = registry;
        }
        return requireKeymaster().createChallenge(challenge, options);
    }

    public String createResponse(String challengeDid) {
        return requireKeymaster().createResponse(challengeDid);
    }

    public java.util.Map<String, Object> verifyResponse(String responseDid) {
        return requireKeymaster().verifyResponse(responseDid);
    }

    public String issueCredential(java.util.Map<String, Object> credential, String registry) {
        org.keychain.keymaster.IssueCredentialOptions options = new org.keychain.keymaster.IssueCredentialOptions();
        if (registry != null && !registry.isBlank()) {
            options.registry = registry;
        }
        return requireKeymaster().issueCredential(credential, options);
    }

    public String createGroup(String name, String registry) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Name is required");
        }
        CreateAssetOptions options = new CreateAssetOptions();
        if (registry != null && !registry.isBlank()) {
            options.registry = registry;
        }
        options.name = name;
        return requireKeymaster().createGroup(name, options);
    }

    public boolean addGroupMember(String groupId, String memberId) {
        return requireKeymaster().addGroupMember(groupId, memberId);
    }

    public boolean removeGroupMember(String groupId, String memberId) {
        return requireKeymaster().removeGroupMember(groupId, memberId);
    }

    public boolean testGroup(String groupId, String memberId) {
        return requireKeymaster().testGroup(groupId, memberId);
    }

    public boolean addName(String name, String did) {
        return requireKeymaster().addName(name, did);
    }

    public boolean removeName(String name) {
        return requireKeymaster().removeName(name);
    }

    public java.util.List<String> listCredentials() {
        return requireKeymaster().listCredentials(null);
    }

    public java.util.List<String> listIssued() {
        return requireKeymaster().listIssued(null);
    }

    public boolean acceptCredential(String did) {
        return requireKeymaster().acceptCredential(did);
    }

    public boolean removeCredential(String did) {
        return requireKeymaster().removeCredential(did);
    }

    public boolean updateCredential(String did, java.util.Map<String, Object> credential) {
        return requireKeymaster().updateCredential(did, credential);
    }

    public boolean revokeCredential(String did) {
        return requireKeymaster().revokeCredential(did);
    }

    public Object decryptJSON(String did) {
        return requireKeymaster().decryptJSON(did);
    }

    public java.util.Map<String, Object> bindCredential(String schemaId, String subjectId) {
        return requireKeymaster().bindCredential(schemaId, subjectId);
    }

    public String issueCredential(java.util.Map<String, Object> credential) {
        return requireKeymaster().issueCredential(credential);
    }

    public java.util.Map<String, Object> publishCredential(String did, boolean reveal) {
        return requireKeymaster().publishCredential(did, reveal);
    }

    public String unpublishCredential(String did) {
        return requireKeymaster().unpublishCredential(did);
    }

    public List<String> listSchemas() {
        return requireKeymaster().listSchemas();
    }

    public Object getSchema(String did) {
        return requireKeymaster().getSchema(did);
    }

    public boolean setSchema(String did, Object schema) {
        return requireKeymaster().setSchema(did, schema);
    }

    public boolean testSchema(String did) {
        return requireKeymaster().testSchema(did);
    }

    public String createSchema(Object schema, String registry, String name) {
        String did = registry == null || registry.isBlank()
            ? requireKeymaster().createSchema(schema)
            : requireKeymaster().createSchema(schema, registry);
        if (name != null && !name.isBlank()) {
            requireKeymaster().addName(name, did);
        }
        return did;
    }

    public Object parseJson(String json) {
        try {
            return mapper.readValue(json, Object.class);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid JSON", e);
        }
    }

    public void sendResponse(String callbackUrl, String responseDid) {
        if (callbackUrl == null || callbackUrl.isBlank()) {
            throw new IllegalArgumentException("Callback URL is required");
        }
        if (responseDid == null || responseDid.isBlank()) {
            throw new IllegalArgumentException("Response DID is required");
        }
        try {
            HttpClient client = HttpClient.newHttpClient();
            String body = "{\"response\":\"" + responseDid + "\"}";
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(callbackUrl))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            client.send(request, HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to send response", e);
        }
    }

    public String prettyJson(Object value) {
        try {
            return mapper.writerWithDefaultPrettyPrinter().writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    public WalletFile loadWallet() {
        return requireKeymaster().loadWallet();
    }

    public WalletFile newWallet(String mnemonic, boolean overwrite) {
        return requireKeymaster().newWallet(mnemonic, overwrite);
    }

    public String decryptMnemonic() {
        return requireKeymaster().decryptMnemonic();
    }

    public String backupWallet() {
        return requireKeymaster().backupWallet();
    }

    public WalletFile recoverWallet() {
        return requireKeymaster().recoverWallet();
    }

    public CheckWalletResult checkWallet() {
        return requireKeymaster().checkWallet();
    }

    public FixWalletResult fixWallet() {
        return requireKeymaster().fixWallet();
    }

    public WalletEncFile exportEncryptedWallet() {
        return requireKeymaster().exportEncryptedWallet();
    }
}
