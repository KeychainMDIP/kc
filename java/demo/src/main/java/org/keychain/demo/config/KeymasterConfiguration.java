package org.keychain.demo.config;

import java.nio.file.Path;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJson;
import org.keychain.keymaster.store.WalletStore;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(KeymasterConfig.class)
public class KeymasterConfiguration {
    @Bean
    public GatekeeperInterface gatekeeperClient(KeymasterConfig config) {
        GatekeeperClientOptions options = new GatekeeperClientOptions();
        options.baseUrl = config.getGatekeeperUrl();
        return new GatekeeperClient(options);
    }

    @Bean
    public WalletStore<WalletEncFile> walletStore(KeymasterConfig config) {
        Path walletDir = Path.of(config.getWalletDir());
        return new WalletJson<>(WalletEncFile.class, walletDir, config.getWalletFile());
    }

}
