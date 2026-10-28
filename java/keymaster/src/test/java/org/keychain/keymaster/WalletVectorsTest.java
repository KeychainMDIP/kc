package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.crypto.MnemonicEncryption;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.store.WalletJson;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.testutil.TestFixtures;

class WalletVectorsTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @TempDir
    Path tempDir;

    @Test
    void loadsReferenceWalletAndRestoresItsEncryptedExport() throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        WalletJsonMemory<WalletEncFile> store = vectorStore(vector);
        String passphrase = vector.get("passphrase").asText();
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), passphrase);
        WalletFile expected = mapper.treeToValue(vector.get("wallet"), WalletFile.class);
        expected.version = vector.get("version").asInt();
        expected.seed = mapper.treeToValue(vector.get("seed"), Seed.class);

        WalletFile wallet = keymaster.loadWallet();

        assertEquals(mapper.valueToTree(expected), mapper.valueToTree(wallet));
        assertEquals(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            keymaster.decryptMnemonic()
        );
        WalletEncFile exported = keymaster.exportEncryptedWallet();
        assertEquals(1, exported.version);
        assertNotNull(exported.enc);
        assertTrue(exported.extra.isEmpty());
        assertEquals(vector.get("seed").get("mnemonicEnc"), mapper.valueToTree(exported.seed.mnemonicEnc));

        WalletJsonMemory<WalletEncFile> restoredStore = new WalletJsonMemory<>(WalletEncFile.class);
        assertTrue(restoredStore.saveWallet(exported, false));
        Keymaster restored = new Keymaster(restoredStore, TestFixtures.offlineGatekeeper(), passphrase);
        assertEquals(mapper.valueToTree(expected), mapper.valueToTree(restored.loadWallet()));

        keymaster.mutateWallet(candidate -> candidate.counter++);
        Keymaster reloaded = new Keymaster(store, TestFixtures.offlineGatekeeper(), passphrase);
        expected.counter++;
        assertEquals(mapper.valueToTree(expected), mapper.valueToTree(reloaded.loadWallet()));
        assertEquals(vector.get("wallet").get("application"), mapper.valueToTree(wallet.additionalProperties().get("application")));
        assertFalse(mapper.valueToTree(exported).has("salt"));
    }

    @Test
    void wrongPassphraseDoesNotReplaceReferenceWallet() throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        WalletJsonMemory<WalletEncFile> store = vectorStore(vector);
        JsonNode before = mapper.valueToTree(store.loadWallet());
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), "wrong passphrase");

        assertThrows(IllegalStateException.class, keymaster::loadWallet);

        assertEquals(before, mapper.valueToTree(store.loadWallet()));
    }

    @Test
    void encryptedReplacementUsesItsOwnSeedOnlyAfterSuccessfulPersistence() throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        String passphrase = vector.get("passphrase").asText();
        WalletJsonMemory<WalletEncFile> store = vectorStore(vector);
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), passphrase);
        String oldPublicKey = keymaster.hdKeyPair().publicJwk.x;
        Keymaster replacement = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class),
            TestFixtures.offlineGatekeeper(), passphrase);
        replacement.newWallet("legal winner thank year wave sausage worth useful legal winner thank yellow", false);
        WalletEncFile encrypted = replacement.exportEncryptedWallet();

        assertFalse(keymaster.saveWallet(encrypted, false));
        assertEquals(oldPublicKey, keymaster.hdKeyPair().publicJwk.x);
        assertEquals(mnemonic(), keymaster.decryptMnemonic());
        assertTrue(keymaster.saveWallet(encrypted, true));
        assertEquals(replacement.hdKeyPair().publicJwk.x, keymaster.hdKeyPair().publicJwk.x);

        WalletJsonMemory<WalletEncFile> exportedStore = new WalletJsonMemory<>(WalletEncFile.class);
        exportedStore.saveWallet(keymaster.exportEncryptedWallet(), false);
        Keymaster exported = new Keymaster(exportedStore, TestFixtures.offlineGatekeeper(), passphrase);
        assertEquals(replacement.hdKeyPair().publicJwk.x, exported.hdKeyPair().publicJwk.x);
    }

    @Test
    void warmDerivedKeyCacheCannotBypassReplacementPassphraseVerification() throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        WalletJsonMemory<WalletEncFile> store = vectorStore(vector);
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), vector.get("passphrase").asText());
        String oldPublicKey = keymaster.hdKeyPair().publicJwk.x;
        JsonNode before = mapper.valueToTree(store.loadWallet());
        WalletEncFile candidate = store.loadWallet();
        candidate.seed.mnemonicEnc = MnemonicEncryption.encrypt(mnemonic(), "different passphrase");

        assertThrows(IllegalStateException.class, () -> keymaster.saveWallet(candidate, true));

        assertEquals(before, mapper.valueToTree(store.loadWallet()));
        assertEquals(oldPublicKey, keymaster.hdKeyPair().publicJwk.x);
    }

    @ParameterizedTest
    @MethodSource("invalidPayloads")
    void malformedEncryptedPayloadCannotReplaceWallet(String json) throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        WalletJsonMemory<WalletEncFile> store = vectorStore(vector);
        JsonNode before = mapper.valueToTree(store.loadWallet());
        String passphrase = vector.get("passphrase").asText();
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), passphrase);
        WalletEncFile candidate = encryptedPayload(vector, json);

        assertThrows(RuntimeException.class, () -> keymaster.saveWallet(candidate, true));

        assertEquals(before, mapper.valueToTree(store.loadWallet()));
        assertEquals(vector.get("wallet").get("counter").asInt(), keymaster.loadWallet().counter);
        WalletJsonMemory<WalletEncFile> malformedStore = new WalletJsonMemory<>(WalletEncFile.class);
        malformedStore.saveWallet(candidate, false);
        Keymaster malformed = new Keymaster(malformedStore, TestFixtures.offlineGatekeeper(), passphrase);
        assertThrows(RuntimeException.class, malformed::loadWallet);
        assertEquals(mapper.valueToTree(candidate), mapper.valueToTree(malformedStore.loadWallet()));
    }

    private static Stream<String> invalidPayloads() {
        return Stream.of("null", "[]", "{}", "{\"counter\":0}", "{\"ids\":{}}",
            "{\"counter\":null,\"ids\":{}}", "{\"counter\":\"0\",\"ids\":{}}",
            "{\"counter\":-1,\"ids\":{}}", "{\"counter\":0.5,\"ids\":{}}",
            "{\"counter\":2147483648,\"ids\":{}}", "{\"counter\":0,\"ids\":[]}",
            "{\"counter\":0,\"ids\":{\"Alice\":null}}", "{\"counter\":0,\"ids\":{\"Alice\":{}}}",
            "{\"counter\":0,\"ids\":{},\"version\":1}", "{\"counter\":0,\"ids\":{},\"seed\":null}",
            "{\"counter\":0,\"ids\":{},\"enc\":null}", "{\"counter\":0,\"ids\":{}} true");
    }

    @ParameterizedTest
    @ValueSource(strings = {"account", "index"})
    void identityBackupNumbersAreValidatedBeforeCoercion(String field) throws Exception {
        for (String value : new String[] {"null", "\"0\"", "true", "-1", "0.5", "2147483648", "9007199254740992"}) {
            ObjectNode id = (ObjectNode) TestFixtures.readVector("wallet-v1.json").path("wallet").path("ids").path("Alice");
            id.set(field, mapper.readTree(value));
            assertThrows(IllegalArgumentException.class, () -> mapper.convertValue(id, IDInfo.class));
        }
        ObjectNode missing = (ObjectNode) TestFixtures.readVector("wallet-v1.json").path("wallet").path("ids").path("Alice");
        missing.remove(field);
        assertThrows(IllegalArgumentException.class, () -> mapper.convertValue(missing, IDInfo.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "\"\"", "42", "[]", "{}"})
    void identityBackupRequiresANonemptyStringDid(String value) throws Exception {
        ObjectNode id = (ObjectNode) TestFixtures.readVector("wallet-v1.json").path("wallet").path("ids").path("Alice");
        id.set("did", mapper.readTree(value));
        assertThrows(IllegalArgumentException.class, () -> mapper.convertValue(id, IDInfo.class));
    }

    @Test
    void supportsIntegralDecimalsAndJavaDerivationBoundary() throws Exception {
        WalletFile wallet = mapper.readValue("{\"counter\":1.0,\"ids\":{\"Alice\":{\"did\":\"did:test:alice\","
            + "\"account\":2147483647,\"index\":0.0}}}", WalletFile.class);
        assertEquals(1, wallet.counter);
        assertEquals(Integer.MAX_VALUE, wallet.ids.get("Alice").account);
        assertEquals(0, wallet.ids.get("Alice").index);
    }

    @ParameterizedTest
    @ValueSource(strings = {"\"1\"", "true", "-1", "1.5", "2147483648"})
    void storedVersionIsNotCoerced(String version) {
        assertThrows(Exception.class, () -> mapper.readValue("{\"version\":" + version + "}", WalletEncFile.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "null", "0", "1"})
    void plaintextWalletReadPreservesExtensions(String version) throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        ObjectNode legacy = ((ObjectNode) vector.get("wallet")).deepCopy();
        legacy.putObject("salt").put("custom", true);
        legacy.putArray("iv").add(1).add(2);
        legacy.putNull("data");
        JsonNode expected = legacy.deepCopy();
        var crypto = new KeymasterCryptoImpl();
        var master = HdKeyUtil.masterFromMnemonic(mnemonic());
        var keys = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        var hd = HdKeyUtil.toHdKey(master);
        if (!"missing".equals(version)) {
            legacy.set("version", mapper.readTree(version));
        }
        if ("1".equals(version)) {
            legacy.set("seed", vector.get("seed"));
        } else {
            ObjectNode seed = legacy.putObject("seed");
            seed.putObject("hdkey").put("xpriv", hd.xpriv).put("xpub", hd.xpub);
            seed.put("mnemonic", crypto.encryptMessage(keys.publicJwk, keys.privateJwk, mnemonic()));
        }
        WalletJson<WalletEncFile> store = new WalletJson<>(WalletEncFile.class, tempDir, "wallet.json");
        Files.writeString(tempDir.resolve("wallet.json"), mapper.writeValueAsString(legacy));
        String passphrase = vector.get("passphrase").asText();
        Keymaster keymaster = new Keymaster(store, TestFixtures.offlineGatekeeper(), passphrase);

        WalletFile upgraded = keymaster.loadWallet();

        assertEquals(1, upgraded.version);
        assertEquals(mnemonic(), keymaster.decryptMnemonic());
        JsonNode exported = mapper.valueToTree(WalletJsonMapper.walletPayload(upgraded));
        assertEquals(expected, exported);
        Keymaster reloaded = new Keymaster(store, TestFixtures.offlineGatekeeper(), passphrase);
        assertEquals(exported, mapper.valueToTree(WalletJsonMapper.walletPayload(reloaded.loadWallet())));
    }

    @Test
    void legacyUpgradeRejectsReservedCiphertextWithoutChangingFile() throws Exception {
        JsonNode vector = TestFixtures.readVector("wallet-v1.json");
        ObjectNode legacy = ((ObjectNode) vector.get("wallet")).deepCopy();
        var crypto = new KeymasterCryptoImpl();
        String replacementMnemonic = "legal winner thank year wave sausage worth useful legal winner thank yellow";
        var master = HdKeyUtil.masterFromMnemonic(replacementMnemonic);
        var keys = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        var hd = HdKeyUtil.toHdKey(master);
        ObjectNode seed = legacy.putObject("seed");
        seed.putObject("hdkey").put("xpriv", hd.xpriv).put("xpub", hd.xpub);
        seed.put("mnemonic", crypto.encryptMessage(keys.publicJwk, keys.privateJwk, replacementMnemonic));
        legacy.put("enc", "not-a-wallet-ciphertext");
        Path file = tempDir.resolve("wallet.json");
        String original = mapper.writeValueAsString(legacy);
        Files.writeString(file, original);
        Keymaster keymaster = new Keymaster(new WalletJson<>(WalletEncFile.class, tempDir, "wallet.json"),
            TestFixtures.offlineGatekeeper(), vector.get("passphrase").asText());

        assertThrows(IllegalArgumentException.class, keymaster::loadWallet);

        assertEquals(original, Files.readString(file));

        WalletJsonMemory<WalletEncFile> existingStore = vectorStore(vector);
        Keymaster existing = new Keymaster(existingStore, TestFixtures.offlineGatekeeper(), vector.get("passphrase").asText());
        String oldPublicKey = existing.hdKeyPair().publicJwk.x;
        JsonNode before = mapper.valueToTree(existingStore.loadWallet());
        WalletFile candidate = mapper.treeToValue(legacy, WalletFile.class);

        assertThrows(IllegalArgumentException.class, () -> existing.saveWallet(candidate, true));

        assertEquals(before, mapper.valueToTree(existingStore.loadWallet()));
        assertEquals(oldPublicKey, existing.hdKeyPair().publicJwk.x);
    }

    @Test
    void unsupportedWholeWalletWrapperLeavesFileUntouched() throws Exception {
        String wrapper = "{\"salt\":\"old-salt\",\"iv\":\"old-iv\",\"data\":\"old-ciphertext\"}";
        Path file = tempDir.resolve("wallet.json");
        Files.writeString(file, wrapper);
        Keymaster keymaster = new Keymaster(new WalletJson<>(WalletEncFile.class, tempDir, "wallet.json"),
            TestFixtures.offlineGatekeeper(), "passphrase");

        assertThrows(IllegalStateException.class, keymaster::loadWallet);

        assertEquals(wrapper, Files.readString(file));
    }

    private WalletEncFile encryptedPayload(JsonNode vector, String payload) throws Exception {
        WalletEncFile candidate = new WalletEncFile();
        candidate.version = 1;
        candidate.seed = mapper.treeToValue(vector.get("seed"), Seed.class);
        var crypto = new KeymasterCryptoImpl();
        var keys = crypto.generateJwk(HdKeyUtil.privateKeyBytes(HdKeyUtil.masterFromMnemonic(mnemonic())));
        candidate.enc = crypto.encryptMessage(keys.publicJwk, keys.privateJwk, payload);
        return candidate;
    }

    private static String mnemonic() {
        return "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    }

    private WalletJsonMemory<WalletEncFile> vectorStore(JsonNode vector) throws Exception {
        WalletEncFile stored = new WalletEncFile();
        stored.version = vector.get("version").asInt();
        stored.seed = mapper.treeToValue(vector.get("seed"), Seed.class);
        stored.enc = vector.get("enc").asText();
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        assertTrue(store.saveWallet(stored, false));
        return store;
    }
}
