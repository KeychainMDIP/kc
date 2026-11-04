package org.keychain.demo.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "keymaster")
public class KeymasterConfig {
    private String gatekeeperUrl;
    private String registry;
    private String didPrefix;
    private Duration gatekeeperCallTimeout = Duration.ofSeconds(60);
    private String walletDir;
    private String walletFile;

    public String getGatekeeperUrl() {
        return gatekeeperUrl;
    }

    public void setGatekeeperUrl(String gatekeeperUrl) {
        this.gatekeeperUrl = gatekeeperUrl;
    }

    public String getDidPrefix() {
        return didPrefix;
    }

    public void setDidPrefix(String didPrefix) {
        this.didPrefix = didPrefix;
    }

    public Duration getGatekeeperCallTimeout() {
        return gatekeeperCallTimeout;
    }

    public void setGatekeeperCallTimeout(Duration gatekeeperCallTimeout) {
        this.gatekeeperCallTimeout = gatekeeperCallTimeout;
    }

    public String getRegistry() {
        return registry;
    }

    public void setRegistry(String registry) {
        this.registry = registry;
    }

    public String getWalletDir() {
        return walletDir;
    }

    public void setWalletDir(String walletDir) {
        this.walletDir = walletDir;
    }

    public String getWalletFile() {
        return walletFile;
    }

    public void setWalletFile(String walletFile) {
        this.walletFile = walletFile;
    }
}
