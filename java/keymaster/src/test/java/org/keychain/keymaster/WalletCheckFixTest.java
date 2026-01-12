package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.keychain.keymaster.model.CheckWalletResult;
import org.keychain.keymaster.model.FixWalletResult;
import org.keychain.keymaster.model.IDInfo;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.GatekeeperStub;

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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
        Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), gatekeeper, PASSPHRASE);
        keymaster.newWallet(MNEMONIC, true);

        CheckWalletResult result = keymaster.checkWallet();
        assertEquals(0, result.checked);
        assertEquals(0, result.invalid);
        assertEquals(0, result.deleted);
    }

    @Test
    void checkWalletSingleId() {
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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
        GatekeeperStub gatekeeper = new GatekeeperStub(DID_SEED);
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

}
