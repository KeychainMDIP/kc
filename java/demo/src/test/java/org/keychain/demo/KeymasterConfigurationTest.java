package org.keychain.demo;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.keychain.demo.config.KeymasterConfig;
import org.keychain.demo.config.KeymasterConfiguration;
import org.keychain.demo.service.KeymasterService;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.store.WalletStore;

class KeymasterConfigurationTest {
    @Test
    void usesConfiguredPrefixAndRegistryAfterEveryWalletInitialization() {
        GatekeeperInterface gatekeeper = mock(GatekeeperInterface.class);
        when(gatekeeper.createDID(any())).thenAnswer(call -> {
            org.keychain.gatekeeper.model.Operation operation = call.getArgument(0);
            assertEquals("did:custom", operation.mdip.prefix);
            assertEquals("local", operation.mdip.registry);
            return "did:custom:z3v8AuafbhTJJ8qqV5kEtfyd3c4NJm6jyUCpEkQrJU4YgdR6UFk";
        });
        KeymasterConfig config = new KeymasterConfig();
        config.setDidPrefix("did:custom");
        config.setRegistry("local");
        KeymasterService service = new KeymasterService(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, config);
        service.initWithPassphrase("passphrase", true);
        service.createId("Alice");
        WalletEncFile exported = service.exportEncryptedWallet();
        service.resetWallet("passphrase");
        service.createId("Bob");
        service.initWithUploadedWallet("passphrase", exported);
        service.createId("Carol");
        verify(gatekeeper, times(3)).createDID(any());
    }

    @Test
    void refusesToUnlockAnUploadedWalletWhenPersistenceIsRefused() {
        WalletStore<WalletEncFile> store = mock(WalletStore.class);
        when(store.saveWallet(any(), eq(true))).thenReturn(false);
        KeymasterConfig config = new KeymasterConfig();
        KeymasterService source = new KeymasterService(new WalletJsonMemory<>(WalletEncFile.class), null, config);
        source.initWithPassphrase("passphrase", true);
        KeymasterService target = new KeymasterService(store, null, config);
        assertThrows(IllegalStateException.class, () -> target.initWithUploadedWallet("passphrase", source.exportEncryptedWallet()));
        assertFalse(target.isReady());
        assertThrows(IllegalArgumentException.class, () -> target.parseWalletEncFile("{} {}"));
    }

    @Test
    void configuresFiniteClientDeadlineAndClosesTheClient() {
        KeymasterConfig config = new KeymasterConfig();
        config.setGatekeeperUrl("http://127.0.0.1:1");
        KeymasterConfiguration beans = new KeymasterConfiguration();
        config.setGatekeeperCallTimeout(Duration.ZERO);
        assertThrows(IllegalArgumentException.class, () -> beans.gatekeeperClient(config));
        config.setGatekeeperCallTimeout(Duration.ofSeconds(2));
        GatekeeperClient client = beans.gatekeeperClient(config);
        client.close();
        assertThrows(java.util.concurrent.CancellationException.class, client::isReady);
    }
}
