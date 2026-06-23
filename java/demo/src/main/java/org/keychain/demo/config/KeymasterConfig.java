package org.keychain.demo.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "keymaster")
public class KeymasterConfig {
    private String gatekeeperUrl;
    private String registry;
    private String walletDir;
    private String walletFile;

    public String getGatekeeperUrl() {
        return gatekeeperUrl;
    }

    public void setGatekeeperUrl(String gatekeeperUrl) {
        this.gatekeeperUrl = gatekeeperUrl;
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
