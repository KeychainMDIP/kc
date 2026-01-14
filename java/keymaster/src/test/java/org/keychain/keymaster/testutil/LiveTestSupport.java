package org.keychain.keymaster.testutil;

import java.nio.file.Path;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.keymaster.Keymaster;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJson;

public final class LiveTestSupport {
    public static final String DEFAULT_GATEKEEPER_URL = "http://localhost:4224";
    public static final String ENV_GATEKEEPER_URL = "KC_GATEKEEPER_URL";
    public static final String DEFAULT_REGISTRY = "local";
    public static final String DEFAULT_PASSPHRASE = "passphrase";
    public static final String DEFAULT_WALLET_FILE = "wallet.json";

    private LiveTestSupport() {
    }

    public static GatekeeperInterface gatekeeperClient() {
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        String override = System.getenv(ENV_GATEKEEPER_URL);
        if (override != null && !override.isBlank()) {
            options.baseUrl = override;
        } else {
            options.baseUrl = DEFAULT_GATEKEEPER_URL;
        }
        return new GatekeeperClient(options);
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
