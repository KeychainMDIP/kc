package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.util.HashMap;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMapper;

class WalletCryptoTest {
    @Test
    void encryptDecryptRoundTrip() {
        String mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        String passphrase = "passphrase";

        WalletFile wallet = new WalletFile();
        wallet.version = 1;
        wallet.counter = 1;
        wallet.ids = new HashMap<>();
        wallet.names = new HashMap<>();
        wallet.current = "Alice";

        IDInfo id = new IDInfo();
        id.did = "did:test:alice";
        id.account = 0;
        id.index = 0;
        wallet.ids.put("Alice", id);

        Seed seed = new Seed();
        seed.mnemonicEnc = MnemonicEncryption.encrypt(mnemonic, passphrase);
        wallet.seed = seed;

        WalletCrypto crypto = new WalletCrypto(passphrase);
        WalletEncFile stored = crypto.encryptForStorage(wallet);
        WalletFile decrypted = crypto.decryptFromStorage(stored);

        assertEquals(wallet.counter, decrypted.counter);
        assertEquals(wallet.current, decrypted.current);
        assertEquals(wallet.ids.get("Alice").did, decrypted.ids.get("Alice").did);
    }

    @Test
    void decryptsWalletVector() throws Exception {
        ObjectMapper mapper = WalletJsonMapper.mapper();
        JsonNode node;
        try (InputStream input = getClass().getResourceAsStream("/vectors/wallet-v1.json")) {
            assertNotNull(input, "wallet-v1.json should be present in test resources");
            node = mapper.readTree(input);
        }

        String passphrase = node.get("passphrase").asText();
        WalletEncFile stored = mapper.treeToValue(node, WalletEncFile.class);

        WalletCrypto crypto = new WalletCrypto(passphrase);
        WalletFile decrypted = crypto.decryptFromStorage(stored);

        JsonNode walletNode = node.get("wallet");
        assertEquals(walletNode.get("counter").asInt(), decrypted.counter);
        assertEquals(walletNode.get("current").asText(), decrypted.current);
        assertEquals(
            walletNode.get("ids").get("Alice").get("did").asText(),
            decrypted.ids.get("Alice").did
        );
        assertEquals(
            walletNode.get("names").get("alias").asText(),
            decrypted.names.get("alias")
        );
    }
}
