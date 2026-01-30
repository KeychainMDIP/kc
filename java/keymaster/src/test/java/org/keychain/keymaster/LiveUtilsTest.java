package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.testutil.LiveTestSupport;

@Tag("live")
class LiveUtilsTest {
    @TempDir
    Path tempDir;

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    @Test
    void resolveDidResolvesNewId() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(did);

        assertEquals(did, doc.didDocument.id);
    }

    @Test
    void resolveDidResolvesIdName() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID("Bob");

        assertEquals(did, doc.didDocument.id);
    }

    @Test
    void resolveDidResolvesAssetName() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);
        keymaster.addName("mock", dataDid);

        MdipDocument docByDid = keymaster.resolveDID(dataDid);
        MdipDocument docByName = keymaster.resolveDID("mock");

        assertEquals(docByDid.didDocument.id, docByName.didDocument.id);
        assertEquals(docByDid.didDocumentData, docByName.didDocumentData);
    }

    @Test
    void resolveDidInvalidNameThrows() {
        Keymaster keymaster = newKeymaster();

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.resolveDID("mock")
        );
        assertEquals("unknown id", error.getMessage());
    }

    @Test
    void updateDidMissingIdThrows() {
        Keymaster keymaster = newKeymaster();
        MdipDocument doc = new MdipDocument();

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.updateDID(doc)
        );
        assertTrue(error.getMessage().contains("doc.didDocument.id"));
    }

    @Test
    void updateDidUpdatesAsset() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        Map<String, Object> dataUpdated = Map.of("name", "updated");
        doc.didDocumentData = dataUpdated;

        boolean ok = keymaster.updateDID(doc);
        MdipDocument doc2 = keymaster.resolveDID(dataDid);

        assertTrue(ok);
        assertEquals(dataUpdated, doc2.didDocumentData);
        assertEquals("2", doc2.didDocumentMetadata.version);
    }

    @Test
    void updateDidNoChangesKeepsVersion() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor", "val", 1234);
        String dataDid = keymaster.createAsset(mockAnchor);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        doc.didDocumentData = Map.of("val", 1234, "name", "mockAnchor");
        boolean ok = keymaster.updateDID(doc);
        MdipDocument doc2 = keymaster.resolveDID(dataDid);

        assertTrue(ok);
        assertEquals(mockAnchor, doc2.didDocumentData);
        assertEquals("1", doc2.didDocumentMetadata.version);
    }

    @Test
    void updateDidOwnerInWallet() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        keymaster.createId("Alice");

        keymaster.setCurrentId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        Map<String, Object> dataUpdated = Map.of("name", "updated");
        doc.didDocumentData = dataUpdated;

        keymaster.setCurrentId("Alice");

        boolean ok = keymaster.updateDID(doc);
        MdipDocument doc2 = keymaster.resolveDID(dataDid);

        assertTrue(ok);
        assertEquals(bob, doc2.didDocument.controller);
        assertEquals(dataUpdated, doc2.didDocumentData);
        assertEquals("2", doc2.didDocumentMetadata.version);
    }

    @Test
    void updateDidOwnerNotInWalletThrows() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        keymaster.createId("Alice");
        keymaster.setCurrentId("Bob");

        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        doc.didDocumentData = Map.of("name", "updated");

        keymaster.setCurrentId("Alice");
        keymaster.removeId("Bob");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.updateDID(doc)
        );
        assertEquals("unknown id", error.getMessage());
    }

    @Test
    void revokeDidRevokesAsset() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        boolean ok = keymaster.revokeDID(dataDid);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertTrue(ok);
        assertEquals(dataDid, doc.didDocument.id);
        assertEquals(Map.of(), doc.didDocumentData);
        assertEquals(true, doc.didDocumentMetadata.deactivated);
    }

    @Test
    void revokeDidWhenCurrentNotOwner() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        keymaster.createId("Alice");

        keymaster.setCurrentId("Bob");
        Map<String, Object> mockAnchor = Map.of("name", "mockAnchor");
        String dataDid = keymaster.createAsset(mockAnchor);

        keymaster.setCurrentId("Alice");
        boolean ok = keymaster.revokeDID(dataDid);
        MdipDocument doc = keymaster.resolveDID(dataDid);

        assertTrue(ok);
        assertEquals(dataDid, doc.didDocument.id);
        assertEquals(Map.of(), doc.didDocumentData);
        assertEquals(true, doc.didDocumentMetadata.deactivated);
    }

    @Test
    void removeFromOwnedReturnsFalseWhenNothingOwned() {
        Keymaster keymaster = newKeymaster();
        String owner = keymaster.createId("Alice");

        boolean ok = keymaster.removeFromOwned("did:mock", owner);
        assertFalse(ok);
    }

    @Test
    void rotateKeysUpdatesDidDoc() {
        Keymaster keymaster = newKeymaster();
        String alice = keymaster.createId("Alice");
        MdipDocument doc = keymaster.resolveDID(alice);
        MdipDocument.VerificationMethod vm = doc.didDocument.verificationMethod.get(0);
        org.keychain.gatekeeper.model.EcdsaJwkPublic pubkey = vm.publicKeyJwk;

        for (int i = 0; i < 3; i += 1) {
            keymaster.rotateKeys();

            doc = keymaster.resolveDID(alice);
            vm = doc.didDocument.verificationMethod.get(0);

            assertNotEquals(pubkey.x, vm.publicKeyJwk.x);
            assertNotEquals(pubkey.y, vm.publicKeyJwk.y);

            pubkey = vm.publicKeyJwk;
        }
    }

    @Test
    void rotateKeysDecryptsMessages() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");
        java.util.List<String> secrets = new java.util.ArrayList<>();
        String msg = "Hi Bob!";

        for (int i = 0; i < 3; i += 1) {
            keymaster.setCurrentId("Alice");
            String did = keymaster.encryptMessage(msg, bob);
            secrets.add(did);

            keymaster.rotateKeys();

            keymaster.setCurrentId("Bob");
            keymaster.rotateKeys();
        }

        for (String secret : secrets) {
            keymaster.setCurrentId("Alice");
            String decipher1 = keymaster.decryptMessage(secret);
            assertEquals(msg, decipher1);

            keymaster.setCurrentId("Bob");
            String decipher2 = keymaster.decryptMessage(secret);
            assertEquals(msg, decipher2);
        }
    }

    @Test
    void getPublicKeyJwkReturnsFirstKey() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(bob);
        org.keychain.gatekeeper.model.EcdsaJwkPublic publicKeyJwk = keymaster.getPublicKeyJwk(doc);

        assertEquals(doc.didDocument.verificationMethod.get(0).publicKeyJwk, publicKeyJwk);
    }

    @Test
    void getPublicKeyJwkThrowsWhenNotAgentDoc() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createAsset(Map.of("name", "mockAnchor"));
        MdipDocument doc = keymaster.resolveDID(did);

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.getPublicKeyJwk(doc)
        );
        assertEquals("Missing didDocument.", error.getMessage());
    }

    @Test
    void getPublicKeyJwkThrowsWhenDidDocumentMissing() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(bob);
        doc.didDocument = null;

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.getPublicKeyJwk(doc)
        );
        assertEquals("Missing didDocument.", error.getMessage());
    }

    @Test
    void getPublicKeyJwkThrowsWhenKeyMissing() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(bob);
        doc.didDocument.verificationMethod.get(0).publicKeyJwk = null;

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.getPublicKeyJwk(doc)
        );
        assertEquals("The publicKeyJwk is missing in the first verification method.", error.getMessage());
    }

    @Test
    void getAgentDidReturnsDid() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(bob);

        String did = keymaster.getAgentDID(doc);
        assertEquals(bob, did);
    }

    @Test
    void getAgentDidThrowsWhenNotAgent() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");
        String did = keymaster.createAsset(Map.of("name", "mockAnchor"));
        MdipDocument doc = keymaster.resolveDID(did);

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.getAgentDID(doc)
        );
        assertEquals("Document is not an agent", error.getMessage());
    }

    @Test
    void getAgentDidThrowsWhenDidMissing() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        MdipDocument doc = keymaster.resolveDID(bob);
        doc.didDocument = null;

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.getAgentDID(doc)
        );
        assertEquals("Agent document does not have a DID", error.getMessage());
    }

    @Test
    void listRegistriesReturnsLocalAndHyperswarm() {
        Keymaster keymaster = newKeymaster();
        java.util.List<String> registries = keymaster.listRegistries();

        assertTrue(registries.contains("local"));
        assertTrue(registries.contains("hyperswarm"));
    }
}
