package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.HdKeyUtil;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.DocumentMetadata;
import org.keychain.gatekeeper.model.Mdip;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.keymaster.model.HdKey;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.Seed;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.model.WalletFile;
import org.keychain.keymaster.store.WalletJsonMemory;

class SeedBankTest {
    private static final String PASSPHRASE = "passphrase";
    private static final String MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    private static final String SEED_BANK_DID =
        "did:test:QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2o7";
    private static final String ASSET_DID =
        "did:test:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

    @Test
    void resolveSeedBankIsDeterministic() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        MdipDocument bank1 = keymaster.resolveSeedBank();
        MdipDocument bank2 = keymaster.resolveSeedBank();

        assertNotNull(bank1);
        assertNotNull(bank2);
        assertEquals(bank1.didDocument.id, bank2.didDocument.id);
    }

    @Test
    void updateSeedBankThrowsOnMissingDid() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        try {
            keymaster.updateSeedBank(new MdipDocument());
            throw new IllegalStateException("expected exception");
        } catch (IllegalArgumentException e) {
            assertEquals("Invalid parameter: seed bank missing DID", e.getMessage());
        }
    }

    @Test
    void backupWalletStoresDidInSeedBank() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        WalletFile wallet = createWalletWithId(keymaster, "Bob", ASSET_DID);
        String did = keymaster.backupWallet("hyperswarm", wallet);

        MdipDocument seedBank = keymaster.resolveSeedBank();
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) seedBank.didDocumentData;

        assertEquals(did, data.get("wallet"));
    }

    @Test
    void recoverWalletFromSeedBank() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        WalletFile wallet = createWalletWithId(keymaster, "Bob", ASSET_DID);
        keymaster.backupWallet("hyperswarm", wallet);
        String mnemonic = keymaster.decryptMnemonic();

        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet();

        assertEquals(wallet.counter, recovered.counter);
        assertEquals(wallet.current, recovered.current);
        assertEquals(wallet.ids.keySet(), recovered.ids.keySet());
    }

    @Test
    void recoverOverExistingWallet() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        WalletFile wallet = createWalletWithId(keymaster, "Bob", ASSET_DID);
        keymaster.backupWallet("hyperswarm", wallet);

        keymaster.mutateWallet(current -> {
            IDInfo alice = new IDInfo();
            alice.did = "did:test:bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
            alice.account = 1;
            alice.index = 0;
            current.ids.put("Alice", alice);
            current.current = "Alice";
            current.counter = 2;
        });

        WalletFile recovered = keymaster.recoverWallet();
        assertEquals("Bob", recovered.current);
        assertEquals(1, recovered.ids.size());
    }

    @Test
    void recoverAugmentedWallet() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        WalletFile wallet = createWalletWithId(keymaster, "Bob", ASSET_DID);
        wallet.extras = new HashMap<>();
        wallet.extras.put("foo", "bar");
        keymaster.saveWallet(wallet, true);
        keymaster.backupWallet("hyperswarm", wallet);

        String mnemonic = keymaster.decryptMnemonic();
        keymaster.newWallet(mnemonic, true);
        WalletFile recovered = keymaster.recoverWallet();

        assertNotNull(recovered.extras);
        assertEquals("bar", recovered.extras.get("foo"));
    }

    @Test
    void recoverV0WalletFromSeedBank() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        WalletFile legacy = buildLegacyV0Wallet();
        keymaster.backupWallet("hyperswarm", legacy);

        keymaster.newWallet(MNEMONIC, true);
        WalletFile recovered = keymaster.recoverWallet();
        assertEquals(legacy.ids.keySet(), recovered.ids.keySet());
    }

    @Test
    void recoverWalletFromBackupDid() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        WalletFile wallet = createWalletWithId(keymaster, "Bob", ASSET_DID);
        String backupDid = keymaster.backupWallet("hyperswarm", wallet);

        keymaster.newWallet(MNEMONIC, true);
        WalletFile recovered = keymaster.recoverWallet(backupDid);

        assertEquals(wallet.ids.keySet(), recovered.ids.keySet());
    }

    @Test
    void recoverDoesNothingWhenNoBackup() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        keymaster.newWallet(MNEMONIC, true);
        WalletFile recovered = keymaster.recoverWallet();

        assertTrue(recovered.ids.isEmpty());
    }

    @Test
    void recoverDoesNothingWhenBackupDidInvalid() {
        WalletJsonMemory<WalletEncFile> store = new WalletJsonMemory<>(WalletEncFile.class);
        SeedBankGatekeeper gatekeeper = new SeedBankGatekeeper();
        Keymaster keymaster = new Keymaster(store, gatekeeper, PASSPHRASE);

        MdipDocument agent = buildAgentDoc("did:test:bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
        gatekeeper.docs.put(agent.didDocument.id, agent);

        keymaster.newWallet(MNEMONIC, true);
        WalletFile recovered = keymaster.recoverWallet(agent.didDocument.id);
        assertTrue(recovered.ids.isEmpty());
    }

    private static WalletFile createWalletWithId(Keymaster keymaster, String name, String did) {
        WalletFile wallet = keymaster.newWallet(MNEMONIC, true);
        IDInfo info = new IDInfo();
        info.did = did;
        info.account = 0;
        info.index = 0;
        wallet.ids.put(name, info);
        wallet.current = name;
        wallet.counter = 1;
        keymaster.saveWallet(wallet, true);
        return wallet;
    }

    private static WalletFile buildLegacyV0Wallet() {
        WalletFile wallet = new WalletFile();
        wallet.version = 0;
        wallet.counter = 1;
        wallet.ids = new HashMap<>();

        IDInfo info = new IDInfo();
        info.did = ASSET_DID;
        info.account = 0;
        info.index = 0;
        wallet.ids.put("id_1", info);
        wallet.current = "id_1";

        var master = HdKeyUtil.masterFromMnemonic(MNEMONIC);
        HdKey hdkey = toModelHdKey(master);
        KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
        JwkPair keypair = crypto.generateJwk(HdKeyUtil.privateKeyBytes(master));

        Seed seed = new Seed();
        seed.hdkey = hdkey;
        seed.mnemonic = crypto.encryptMessage(keypair.publicJwk, keypair.privateJwk, MNEMONIC);
        wallet.seed = seed;
        return wallet;
    }

    private static HdKey toModelHdKey(org.bitcoinj.crypto.DeterministicKey master) {
        org.keychain.crypto.HdKey cryptoHdKey = HdKeyUtil.toHdKey(master);
        HdKey hdkey = new HdKey();
        hdkey.xpriv = cryptoHdKey.xpriv;
        hdkey.xpub = cryptoHdKey.xpub;
        return hdkey;
    }

    private static MdipDocument buildAgentDoc(String did) {
        MdipDocument doc = new MdipDocument();
        doc.didDocument = new MdipDocument.DidDocument();
        doc.didDocument.id = did;

        Mdip mdip = new Mdip();
        mdip.version = 1;
        mdip.type = "agent";
        mdip.registry = "hyperswarm";
        doc.mdip = mdip;
        return doc;
    }

    private static class SeedBankGatekeeper implements GatekeeperClient {
        final Map<String, MdipDocument> docs = new HashMap<>();
        int assetCounter = 0;

        @Override
        public String createDID(Operation operation) {
            String did = SEED_BANK_DID;
            if (operation == null || operation.mdip == null || !"agent".equals(operation.mdip.type) ||
                !"1970-01-01T00:00:00.000Z".equals(operation.created)) {
                did = ASSET_DID + "-" + assetCounter;
                assetCounter += 1;
            }

            if (docs.containsKey(did)) {
                return did;
            }

            MdipDocument doc = new MdipDocument();
            doc.didDocument = new MdipDocument.DidDocument();
            doc.didDocument.id = did;
            doc.didDocument.controller = operation != null ? operation.controller : null;
            doc.didDocumentData = operation != null && operation.data != null
                ? operation.data
                : new HashMap<>();
            doc.mdip = operation != null ? operation.mdip : null;
            doc.didDocumentMetadata = new DocumentMetadata();
            doc.didDocumentMetadata.versionId = "v1";
            docs.put(did, doc);
            return did;
        }

        @Override
        public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
            return docs.get(did);
        }

        @Override
        public boolean updateDID(Operation operation) {
            if (operation != null && operation.doc != null) {
                if (operation.doc.didDocumentMetadata == null) {
                    operation.doc.didDocumentMetadata = new DocumentMetadata();
                }
                operation.doc.didDocumentMetadata.versionId = "v2";
                docs.put(operation.did, operation.doc);
            }
            return true;
        }

        @Override
        public boolean deleteDID(Operation operation) {
            if (operation != null) {
                docs.remove(operation.did);
            }
            return true;
        }

        @Override
        public BlockInfo getBlock(String registry) {
            return null;
        }
    }
}
