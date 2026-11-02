package org.keychain.keymaster.testutil;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.extension.AfterEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.keychain.keymaster.CreateAssetOptions;
import org.keychain.keymaster.CreateResponseOptions;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.keymaster.Keymaster;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJson;

public final class LiveTestSupport implements AfterEachCallback {
    private static final List<GatekeeperClient> clients = new ArrayList<>();
    public static final String ENV_GATEKEEPER_URL = "KC_GATEKEEPER_URL";
    public static final String DEFAULT_REGISTRY = "local";
    public static final String DEFAULT_PASSPHRASE = "passphrase";
    public static final String DEFAULT_WALLET_FILE = "wallet.json";

    @Override
    public void afterEach(ExtensionContext context) {
        clients.forEach(GatekeeperClient::close);
        clients.clear();
    }

    public static CreateAssetOptions localAssets() {
        CreateAssetOptions options = new CreateAssetOptions();
        options.registry = DEFAULT_REGISTRY;
        return options;
    }

    public static CreateResponseOptions localResponse() {
        CreateResponseOptions options = new CreateResponseOptions();
        options.registry = DEFAULT_REGISTRY;
        return options;
    }

    public static GatekeeperInterface gatekeeperClient() {
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        String override = System.getenv(ENV_GATEKEEPER_URL);
        if (override == null || override.isBlank()) {
            throw new IllegalStateException("KC_GATEKEEPER_URL must explicitly select an isolated test node");
        }
        options.baseUrl = override;
        GatekeeperClient client = new GatekeeperClient(options);
        try {
            if (!client.listRegistries().equals(List.of(DEFAULT_REGISTRY))) {
                throw new IllegalStateException("Live tests require an isolated node with only the local registry");
            }
        } catch (RuntimeException error) {
            client.close();
            throw error;
        }
        clients.add(client);
        return client;
    }

    public static WalletJson<WalletEncFile> walletStore(Path tempDir) {
        return new WalletJson<>(WalletEncFile.class, tempDir, DEFAULT_WALLET_FILE);
    }

    public static Keymaster keymaster(Path tempDir) {
        return new Keymaster(walletStore(tempDir), gatekeeperClient(), DEFAULT_PASSPHRASE, DEFAULT_REGISTRY);
    }

    public static Keymaster keymaster(Path tempDir, String registry) {
        return new Keymaster(walletStore(tempDir), gatekeeperClient(), DEFAULT_PASSPHRASE, registry);
    }
}
