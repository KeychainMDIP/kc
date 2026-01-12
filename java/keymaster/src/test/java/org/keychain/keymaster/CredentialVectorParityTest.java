package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keychain.crypto.XChaCha20TestUtil;
import org.keychain.crypto.util.Base64Url;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.gatekeeper.model.BlockInfo;
import org.keychain.keymaster.testutil.CredentialsVectorLoader;
import org.keychain.keymaster.testutil.AssertUtils;
import org.keychain.keymaster.testutil.GatekeeperStateful;
import org.keychain.keymaster.testutil.KeymasterTestSupport;

class CredentialVectorParityTest {
    private static final String CASE_NAME = "issue-credential";

    @Test
    void issueCredentialMatchesVectors() {
        Map<String, Object> vector = CredentialsVectorLoader.findCase(CASE_NAME);
        @SuppressWarnings("unchecked")
        Map<String, Object> inputs = (Map<String, Object>) vector.get("inputs");
        @SuppressWarnings("unchecked")
        Map<String, Object> expected = (Map<String, Object>) vector.get("expected");

        String mnemonic = (String) inputs.get("mnemonic");
        String registry = (String) inputs.get("registry");

        @SuppressWarnings("unchecked")
        Map<String, Object> schema = (Map<String, Object>) inputs.get("schema");
        @SuppressWarnings("unchecked")
        Map<String, Object> credentialOverride = (Map<String, Object>) inputs.get("credentialOverride");

        String validFrom = (String) inputs.get("validFrom");
        String validUntil = (String) inputs.get("validUntil");

        Instant fixed = Instant.parse(validFrom);
        Keymaster.setNowSupplier(() -> fixed);
        try {
            GatekeeperStateful gatekeeper = new GatekeeperStateful();
            gatekeeper.blockResponse = block("blockhash");
            Keymaster keymaster = KeymasterTestSupport.keymaster(gatekeeper);

            keymaster.newWallet(mnemonic, true);

            gatekeeper.createResponse = (String) expected.get("issuerDid");
            String issuerDid = keymaster.createId((String) inputs.get("issuerName"), registry);
            assertEquals(expected.get("issuerDid"), issuerDid);

            gatekeeper.createResponse = (String) expected.get("subjectDid");
            String subjectDid = keymaster.createId((String) inputs.get("subjectName"), registry);
            assertEquals(expected.get("subjectDid"), subjectDid);

            gatekeeper.createResponse = (String) expected.get("schemaDid");
            String schemaDid = keymaster.createSchema(schema, registry);
            assertEquals(expected.get("schemaDid"), schemaDid);

            @SuppressWarnings("unchecked")
            Map<String, Object> template = (Map<String, Object>) expected.get("template");
            assertEquals(template, keymaster.createTemplate(schemaDid));

            keymaster.mutateWallet(wallet -> wallet.current = (String) inputs.get("issuerName"));

            Map<String, Object> bound = keymaster.bindCredential(schemaDid, subjectDid, validFrom, validUntil, credentialOverride);

            @SuppressWarnings("unchecked")
            Map<String, Object> expectedBound = (Map<String, Object>) expected.get("boundCredential");
            assertEquals(expectedBound, bound);

            @SuppressWarnings("unchecked")
            Map<String, Object> expectedCipher = (Map<String, Object>) expected.get("ciphertext");
            @SuppressWarnings("unchecked")
            Map<String, Object> expectedEncrypted = (Map<String, Object>) expectedCipher.get("encrypted");

            Deque<byte[]> nonces = new ArrayDeque<>();
            nonces.add(extractNonce((String) expectedEncrypted.get("cipher_sender")));
            nonces.add(extractNonce((String) expectedEncrypted.get("cipher_receiver")));
            nonces.add(new byte[24]);
            XChaCha20TestUtil.setNonceSupplier(() -> nonces.pollFirst());

            gatekeeper.createResponse = (String) expectedCipher.get("credentialDid");
            String credentialDid = keymaster.issueCredential(bound);
            assertEquals(expectedCipher.get("credentialDid"), credentialDid);

            @SuppressWarnings("unchecked")
            Map<String, Object> signed = (Map<String, Object>) keymaster.getCredential(credentialDid);
            @SuppressWarnings("unchecked")
            Map<String, Object> expectedSigned = (Map<String, Object>) expected.get("signedCredential");
            assertEquals(expectedSigned, signed);

            @SuppressWarnings("unchecked")
            Map<String, Object> encrypted = (Map<String, Object>) gatekeeper.docs.get(credentialDid).didDocumentData;
            @SuppressWarnings("unchecked")
            Map<String, Object> encryptedPayload = (Map<String, Object>) encrypted.get("encrypted");
            assertEquals(expectedEncrypted, encryptedPayload);

            KeymasterCrypto crypto = new KeymasterCryptoImpl();
            @SuppressWarnings("unchecked")
            Map<String, Object> hashes = (Map<String, Object>) expected.get("hashes");
            assertEquals(hashes.get("boundCredential"), crypto.hashJson(bound));
            assertEquals(hashes.get("signedCredential"), crypto.hashJson(signed));

            @SuppressWarnings("unchecked")
            Map<String, Object> signatures = (Map<String, Object>) expected.get("signatures");
            @SuppressWarnings("unchecked")
            Map<String, Object> signature = (Map<String, Object>) signed.get("signature");
            assertNotNull(signature);
            assertEquals(signatures.get("signedCredential"), signature.get("value"));
            AssertUtils.assertCompactSignature(signature.get("value").toString());
        } finally {
            XChaCha20TestUtil.resetNonceSupplier();
            Keymaster.resetNowSupplier();
        }
    }

    private static BlockInfo block(String hash) {
        BlockInfo info = new BlockInfo();
        info.hash = hash;
        return info;
    }

    private static byte[] extractNonce(String ciphertextB64Url) {
        byte[] data = Base64Url.decode(ciphertextB64Url);
        byte[] nonce = new byte[24];
        System.arraycopy(data, 0, nonce, 0, nonce.length);
        return nonce;
    }
}
