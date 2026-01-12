package org.keychain.keymaster.testutil;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.keychain.cid.Cid;
import org.keychain.crypto.KeymasterCrypto;

public final class AssertUtils {
    private AssertUtils() {
    }

    public static void assertCanonicalHash(KeymasterCrypto crypto, Object json, String expectedHex) {
        String hash = crypto.hashJson(json);
        assertEquals(expectedHex, hash);
    }

    public static void assertCompactSignature(String sigHex) {
        assertTrue(sigHex != null && sigHex.matches("^[0-9a-fA-F]{128}$"), "expected 64-byte compact hex");
    }

    public static void assertDidSuffixIsCid(String did) {
        String suffix = did.substring(did.lastIndexOf(':') + 1);
        assertTrue(Cid.isValid(suffix), "expected CID suffix");
    }

    public static void assertCredentialShape(Map<String, Object> vc) {
        assertTrue(vc.containsKey("@context"), "missing @context");
        assertTrue(vc.containsKey("type"), "missing type");
        assertTrue(vc.containsKey("issuer"), "missing issuer");
        assertTrue(vc.containsKey("credentialSubject"), "missing credentialSubject");
    }
}
