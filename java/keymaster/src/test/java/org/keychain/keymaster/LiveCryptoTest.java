package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.model.MdipDocument;
import org.keychain.keymaster.testutil.LiveTestSupport;

@Tag("live")
class LiveCryptoTest {
    @TempDir
    Path tempDir;
    private static final Map<String, Object> MOCK_JSON = Map.of(
        "key", "value",
        "list", java.util.List.of(1, 2, 3),
        "obj", Map.of("name", "some object")
    );

    private Keymaster newKeymaster() {
        return LiveTestSupport.keymaster(tempDir);
    }

    private String randomString() {
        int length = 1024;
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder result = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            int index = (int) (Math.random() * chars.length());
            result.append(chars.charAt(index));
        }
        return result.toString();
    }

    private String extractCipherHash(MdipDocument doc) {
        Object data = doc.didDocumentData;
        if (!(data instanceof Map<?, ?>)) {
            fail("missing encrypted payload");
            return null;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) data;
        Object encrypted = payload.get("encrypted");
        if (!(encrypted instanceof Map<?, ?>)) {
            fail("missing encrypted payload");
            return null;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> encryptedMap = (Map<String, Object>) encrypted;
        Object cipherHash = encryptedMap.get("cipher_hash");
        return cipherHash != null ? cipherHash.toString() : null;
    }

    @Test
    void encryptMessageShort() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");

        String msg = "Hi Bob!";
        EncryptOptions options = new EncryptOptions();
        options.includeHash = true;
        String encryptDid = keymaster.encryptMessage(msg, did, options);
        MdipDocument doc = keymaster.resolveDID(encryptDid);
        String msgHash = new KeymasterCryptoImpl().hashMessage(msg);

        assertEquals(msgHash, extractCipherHash(doc));
    }

    @Test
    void encryptMessageLong() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");

        String msg = randomString();
        EncryptOptions options = new EncryptOptions();
        options.includeHash = true;
        String encryptDid = keymaster.encryptMessage(msg, did, options);
        MdipDocument doc = keymaster.resolveDID(encryptDid);
        String msgHash = new KeymasterCryptoImpl().hashMessage(msg);

        assertEquals(msgHash, extractCipherHash(doc));
    }

    @Test
    void decryptMessageShortSameId() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");

        String msg = "Hi Bob!";
        String encryptDid = keymaster.encryptMessage(msg, did);
        String decipher = keymaster.decryptMessage(encryptDid);

        assertEquals(msg, decipher);
    }

    @Test
    void decryptMessageShortAfterRotateKeysConfirmed() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");
        String msg = "Hi Bob!";

        keymaster.rotateKeys();
        String encryptDid = keymaster.encryptMessage(msg, did);
        keymaster.rotateKeys();
        String decipher = keymaster.decryptMessage(encryptDid);

        assertEquals(msg, decipher);
    }

    @Test
    void decryptMessageShortAfterRotateKeysUnconfirmed() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");
        String msg = "Hi Bob!";

        keymaster.rotateKeys();
        String encryptDid = keymaster.encryptMessage(msg, did);
        String decipher = keymaster.decryptMessage(encryptDid);

        assertEquals(msg, decipher);
    }

    @Test
    void decryptMessageShortByAnotherId() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");

        keymaster.setCurrentId("Alice");
        String msg = "Hi Bob!";
        String encryptDid = keymaster.encryptMessage(msg, bob);

        keymaster.setCurrentId("Bob");
        String decipher = keymaster.decryptMessage(encryptDid);

        assertEquals(msg, decipher);
    }

    @Test
    void decryptMessageLongByAnotherId() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Alice");
        String bob = keymaster.createId("Bob");

        keymaster.setCurrentId("Alice");
        String msg = randomString();
        String encryptDid = keymaster.encryptMessage(msg, bob);

        keymaster.setCurrentId("Bob");
        String decipher = keymaster.decryptMessage(encryptDid);

        assertEquals(msg, decipher);
    }

    @Test
    void decryptMessageInvalidDid() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Alice");

        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> keymaster.decryptMessage(did)
        );
        assertTrue(error.getMessage().contains("did not encrypted"));
    }

    @Test
    void encryptJsonValid() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        keymaster.resolveDID(bob);

        String did = keymaster.encryptJSON(MOCK_JSON, bob);
        Object data = keymaster.resolveAsset(did);
        if (!(data instanceof Map<?, ?>)) {
            fail("missing encrypted payload");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> dataMap = (Map<String, Object>) data;
        Object encrypted = dataMap.get("encrypted");
        if (!(encrypted instanceof Map<?, ?>)) {
            fail("missing encrypted payload");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> encryptedMap = (Map<String, Object>) encrypted;
        assertEquals(bob, encryptedMap.get("sender"));
    }

    @Test
    void decryptJsonValid() {
        Keymaster keymaster = newKeymaster();
        String bob = keymaster.createId("Bob");
        String did = keymaster.encryptJSON(MOCK_JSON, bob);

        Object decipher = keymaster.decryptJSON(did);
        assertEquals(MOCK_JSON, decipher);
    }

    @Test
    void addSignatureAddsSignature() {
        Keymaster keymaster = newKeymaster();
        String did = keymaster.createId("Bob");

        Map<String, Object> signed = keymaster.addSignature(MOCK_JSON);
        Object signatureObj = signed.get("signature");
        if (!(signatureObj instanceof Map<?, ?>)) {
            fail("missing signature");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> signature = (Map<String, Object>) signatureObj;
        String msgHash = new KeymasterCryptoImpl().hashJson(MOCK_JSON);

        assertEquals(did, signature.get("signer"));
        assertEquals(msgHash, signature.get("hash"));
        assertInstanceOf(String.class, signature.get("value"));
    }

    @Test
    void addSignatureNoCurrentId() {
        Keymaster keymaster = newKeymaster();
        IllegalStateException error = assertThrows(
            IllegalStateException.class,
            () -> keymaster.addSignature(MOCK_JSON)
        );
        assertEquals("Keymaster: No current ID", error.getMessage());
    }

    @Test
    void verifySignatureValid() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        Map<String, Object> signed = keymaster.addSignature(MOCK_JSON);
        assertTrue(keymaster.verifySignature(signed));
    }

    @Test
    void verifySignatureMissingSignature() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        assertFalse(keymaster.verifySignature(MOCK_JSON));
    }

    @Test
    void verifySignatureInvalidSignature() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        Map<String, Object> signed = keymaster.addSignature(MOCK_JSON);
        @SuppressWarnings("unchecked")
        Map<String, Object> signature = (Map<String, Object>) signed.get("signature");
        String value = (String) signature.get("value");
        signature.put("value", value.substring(1));
        assertFalse(keymaster.verifySignature(signed));
    }

    @Test
    void verifySignatureMissingSigner() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        Map<String, Object> signed = keymaster.addSignature(MOCK_JSON);
        @SuppressWarnings("unchecked")
        Map<String, Object> signature = (Map<String, Object>) signed.get("signature");
        signature.remove("signer");
        assertFalse(keymaster.verifySignature(signed));
    }

    @Test
    void verifySignatureInvalidHash() {
        Keymaster keymaster = newKeymaster();
        keymaster.createId("Bob");

        Map<String, Object> signed = keymaster.addSignature(MOCK_JSON);
        @SuppressWarnings("unchecked")
        Map<String, Object> signature = (Map<String, Object>) signed.get("signature");
        signature.put("hash", "1");
        assertFalse(keymaster.verifySignature(signed));
    }
}
