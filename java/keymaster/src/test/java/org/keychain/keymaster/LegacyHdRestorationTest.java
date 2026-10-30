package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.HdKey;
import org.keychain.crypto.HdKeyJson;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestFixtures;

class LegacyHdRestorationTest {
    private static final String MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    @Test
    void legacyUpgradeUsesTheCryptoImportAndPreservesDerivedIdentityKeys() throws Exception {
        var store = legacyStore(false);
        AtomicInteger imports = new AtomicInteger();
        var crypto = new KeymasterCryptoImpl() {
            @Override public HdKey generateHdKeyJson(HdKeyJson json) {
                imports.incrementAndGet();
                assertNotNull(json.xpriv);
                return super.generateHdKeyJson(json);
            }
        };
        Keymaster keymaster = keymaster(store, crypto);
        assertEquals(1, keymaster.loadWallet().version);
        assertEquals(1, imports.get());
        assertEquals(MNEMONIC, keymaster.decryptMnemonic());
        var expected = crypto.generateJwk(HdKeyUtil.privateKeyBytes(HdKeyUtil.derivePath(HdKeyUtil.masterFromMnemonic(MNEMONIC), 0, 0)));
        assertEquals(expected.publicJwk.x, keymaster.getCurrentKeypair(keymaster.loadWallet()).publicJwk.x);
        assertEquals(expected.publicJwk.y, keymaster.getCurrentKeypair(keymaster.loadWallet()).publicJwk.y);
        assertEquals(1, store.loadWallet().version);
        assertNull(store.loadWallet().seed.hdkey);
        Keymaster restarted = keymaster(store, crypto);
        assertEquals(expected.publicJwk.x, restarted.getCurrentKeypair(restarted.loadWallet()).publicJwk.x);
        assertEquals(1, imports.get());
    }

    @Test
    void failedImportLeavesTheExistingLegacyStoreUntouched() throws Exception {
        var store = legacyStore(false);
        var original = WalletJsonMapper.mapper().valueToTree(store.loadWallet());
        var failure = new IllegalArgumentException("invalid HD JSON");
        var crypto = new KeymasterCryptoImpl() {
            @Override public HdKey generateHdKeyJson(HdKeyJson json) { throw failure; }
        };
        assertSame(failure, assertThrows(IllegalArgumentException.class, () -> keymaster(store, crypto).loadWallet()));
        assertEquals(original, WalletJsonMapper.mapper().valueToTree(store.loadWallet()));
        assertEquals(MNEMONIC, keymaster(store, new KeymasterCryptoImpl()).decryptMnemonic());
    }

    @Test
    void aPublicOnlyExtendedKeyCannotUpgradeAnEncryptedLegacySeed() throws Exception {
        var store = legacyStore(true);
        var original = WalletJsonMapper.mapper().valueToTree(store.loadWallet());
        assertThrows(IllegalArgumentException.class, () -> keymaster(store, new KeymasterCryptoImpl()).loadWallet());
        assertEquals(original, WalletJsonMapper.mapper().valueToTree(store.loadWallet()));
    }

    @Test
    void oldJavaMalformedPasswordRequiresItsQuestionMarkEncodingWithoutChangingTheStore() {
        var store = new WalletJsonMemory<>(WalletEncFile.class);
        Keymaster oldJava = new Keymaster(store, TestFixtures.offlineGatekeeper(), "a?b", "local");
        oldJava.newWallet(MNEMONIC, false);
        var original = WalletJsonMapper.mapper().valueToTree(store.loadWallet());
        Keymaster referencePassword = new Keymaster(store, TestFixtures.offlineGatekeeper(), "a\ud800b", "local");
        assertThrows(IllegalStateException.class, referencePassword::loadWallet);
        assertEquals(original, WalletJsonMapper.mapper().valueToTree(store.loadWallet()));
        Keymaster restored = new Keymaster(store, TestFixtures.offlineGatekeeper(), "a?b", "local");
        assertEquals(MNEMONIC, restored.decryptMnemonic());
    }

    private WalletJsonMemory<WalletEncFile> legacyStore(boolean publicOnly) throws Exception {
        var mapper = WalletJsonMapper.mapper();
        ObjectNode wallet = ((ObjectNode) TestFixtures.readVector("wallet-v1.json").get("wallet")).deepCopy();
        var crypto = new KeymasterCryptoImpl();
        var master = HdKeyUtil.masterFromMnemonic(MNEMONIC);
        var hd = HdKeyUtil.toHdKey(master);
        var pair = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));
        ObjectNode seed = wallet.putObject("seed");
        seed.putObject("hdkey").put("xpriv", publicOnly ? hd.xpub : hd.xpriv).put("xpub", hd.xpub);
        seed.put("mnemonic", crypto.encryptMessage(pair.publicJwk, pair.privateJwk, MNEMONIC));
        wallet.put("version", 0);
        var store = new WalletJsonMemory<>(WalletEncFile.class);
        assertTrue(store.saveWallet(mapper.treeToValue(wallet, WalletEncFile.class), false));
        return store;
    }

    private Keymaster keymaster(WalletJsonMemory<WalletEncFile> store, KeymasterCryptoImpl crypto) {
        return new Keymaster(store, TestFixtures.offlineGatekeeper(), crypto, new OperationFactory(crypto), "passphrase", "local");
    }
}
