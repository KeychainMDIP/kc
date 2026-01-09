package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.gatekeeper.model.DocumentMetadata;
import org.keychain.gatekeeper.model.Mdip;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.gatekeeper.model.Operation;
import org.keychain.gatekeeper.model.ResolveDIDOptions;
import org.keychain.keymaster.model.CheckWalletResult;
import org.keychain.keymaster.model.FixWalletResult;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMemory;

class WalletCheckFixTest {
    private static final String PASSPHRASE = "passphrase";
    private static final String MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    private static final String DID_SEED =
        "did:test:QmYwAPJzv5CZsnAzt8auV2V4ZZFZ5JYh5rS4Qh1zS4x2o7";
    private static final String DID_ACTIVE =
        "did:test:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    private static final String DID_REVOKED =
        "did:test:bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

    @Test
    void checkWalletEmpty() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(0, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletSingleId() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        addId(keymaster, "Alice", DID_ACTIVE);
        gatekeeper.addDoc(DID_ACTIVE, false);

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(1, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletDetectsRevokedId() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        addId(keymaster, "Alice", DID_ACTIVE);
        gatekeeper.addDoc(DID_ACTIVE, false);
        keymaster.revokeDID(DID_ACTIVE);

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(1, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(1, result.deleted);
    }

    @Test
    void checkWalletDetectsRemovedDids() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        addId(keymaster, "Alice", DID_ACTIVE);
        addOwned(keymaster, "Alice", List.of(DID_REVOKED));
        keymaster.addName("schema", DID_REVOKED);

        gatekeeper.addDoc(DID_ACTIVE, false);
        gatekeeper.addDoc(DID_REVOKED, false);
        gatekeeper.removeDIDs(List.of(DID_ACTIVE, DID_REVOKED));

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(3, result.checked);
        assertEquals(3, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletDetectsInvalidDids() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        addId(keymaster, "Alice", DID_ACTIVE);
        addOwned(keymaster, "Alice", List.of("did:test:mock1"));
        addHeld(keymaster, "Alice", List.of("did:test:mock2"));
        gatekeeper.addDoc(DID_ACTIVE, false);

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(3, result.checked);
        assertEquals(2, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletDetectsRevokedCredentials() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        addId(keymaster, "Alice", DID_ACTIVE);
        addId(keymaster, "Bob", DID_ACTIVE);
        addId(keymaster, "Carol", DID_ACTIVE);
        addId(keymaster, "Victor", DID_ACTIVE);

        addOwned(keymaster, "Alice", List.of(DID_ACTIVE, DID_ACTIVE, DID_ACTIVE));
        addOwned(keymaster, "Bob", List.of(DID_ACTIVE, DID_ACTIVE, DID_ACTIVE));
        addHeld(keymaster, "Carol", List.of(DID_REVOKED, DID_SEED, DID_ACTIVE, DID_ACTIVE));
        keymaster.addName("credential-0", DID_REVOKED);
        keymaster.addName("credential-2", DID_SEED);

        gatekeeper.addDoc(DID_ACTIVE, false);
        gatekeeper.addDoc(DID_REVOKED, true);
        gatekeeper.addDoc(DID_SEED, true);

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(16, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(4, result.deleted);
    }

    @Test
    void fixWalletEmpty() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletSingleId() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);
        addId(keymaster, "Alice", DID_ACTIVE);
        gatekeeper.addDoc(DID_ACTIVE, false);

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesRevokedId() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);
        addId(keymaster, "Alice", DID_ACTIVE);
        gatekeeper.addDoc(DID_ACTIVE, true);

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(1, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesDeletedDids() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);
        addId(keymaster, "Alice", DID_ACTIVE);
        keymaster.addName("schema", DID_REVOKED);
        gatekeeper.addDoc(DID_ACTIVE, false);
        gatekeeper.addDoc(DID_REVOKED, false);
        gatekeeper.removeDIDs(List.of(DID_ACTIVE, DID_REVOKED));

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(1, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(0, result.heldRemoved);
        assertEquals(1, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesInvalidDids() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);
        addId(keymaster, "Alice", DID_ACTIVE);
        addOwned(keymaster, "Alice", List.of("did:test:mock1"));
        addHeld(keymaster, "Alice", List.of("did:test:mock2"));
        gatekeeper.addDoc(DID_ACTIVE, false);

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(1, result.ownedRemoved);
        assertEquals(1, result.heldRemoved);
        assertEquals(0, result.namesRemoved);
    }

    @Test
    void fixWalletRemovesRevokedCredentials() {
        WalletGatekeeper gatekeeper = new WalletGatekeeper();
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);
        addId(keymaster, "Carol", DID_ACTIVE);
        addHeld(keymaster, "Carol", List.of(DID_REVOKED, DID_SEED));
        keymaster.addName("credential-0", DID_REVOKED);
        keymaster.addName("credential-2", DID_SEED);
        gatekeeper.addDoc(DID_ACTIVE, false);
        gatekeeper.addDoc(DID_REVOKED, true);
        gatekeeper.addDoc(DID_SEED, true);

        FixWalletResult result = keymaster.fixWallet();
        assertEquals(0, result.idsRemoved);
        assertEquals(0, result.ownedRemoved);
        assertEquals(2, result.heldRemoved);
        assertEquals(2, result.namesRemoved);
    }

    private static void addId(Keymaster keymaster, String name, String did) {
        keymaster.mutateWallet(wallet -> {
            if (wallet.ids == null) {
                wallet.ids = new HashMap<>();
            }
            IDInfo idInfo = new IDInfo();
            idInfo.did = did;
            idInfo.account = 0;
            idInfo.index = 0;
            wallet.ids.put(name, idInfo);
            wallet.current = name;
            wallet.counter = wallet.ids.size();
        });
    }

    private static void addOwned(Keymaster keymaster, String name, List<String> dids) {
        keymaster.mutateWallet(wallet -> {
            IDInfo id = wallet.ids.get(name);
            if (id != null) {
                id.owned = new java.util.ArrayList<>(dids);
            }
        });
    }

    private static void addHeld(Keymaster keymaster, String name, List<String> dids) {
        keymaster.mutateWallet(wallet -> {
            IDInfo id = wallet.ids.get(name);
            if (id != null) {
                id.held = new java.util.ArrayList<>(dids);
            }
        });
    }

    private static class WalletGatekeeper implements GatekeeperClient {
        final Map<String, MdipDocument> docs = new HashMap<>();

        void addDoc(String did, boolean deactivated) {
            MdipDocument doc = new MdipDocument();
            doc.didDocument = new MdipDocument.DidDocument();
            doc.didDocument.id = did;
            Mdip mdip = new Mdip();
            mdip.version = 1;
            mdip.type = "agent";
            mdip.registry = "hyperswarm";
            doc.mdip = mdip;
            doc.didDocumentMetadata = new DocumentMetadata();
            doc.didDocumentMetadata.deactivated = deactivated;
            docs.put(did, doc);
        }

        void removeDIDs(List<String> dids) {
            for (String did : dids) {
                docs.remove(did);
            }
        }

        @Override
        public String createDID(Operation operation) {
            String did = DID_SEED;
            if (operation != null && operation.mdip != null && "agent".equals(operation.mdip.type)
                && "1970-01-01T00:00:00.000Z".equals(operation.created)) {
                did = DID_SEED;
            }
            if (docs.containsKey(did)) {
                return did;
            }
            addDoc(did, false);
            return did;
        }

        @Override
        public MdipDocument resolveDID(String did, ResolveDIDOptions options) {
            return docs.get(did);
        }

        @Override
        public boolean updateDID(Operation operation) {
            if (operation != null && operation.doc != null) {
                docs.put(operation.did, operation.doc);
            }
            return true;
        }

        @Override
        public boolean deleteDID(Operation operation) {
            if (operation != null && docs.containsKey(operation.did)) {
                MdipDocument doc = docs.get(operation.did);
                if (doc.didDocumentMetadata == null) {
                    doc.didDocumentMetadata = new DocumentMetadata();
                }
                doc.didDocumentMetadata.deactivated = true;
                docs.put(operation.did, doc);
            }
            return true;
        }

        @Override
        public BlockInfo getBlock(String registry) {
            return null;
        }
    }
}
