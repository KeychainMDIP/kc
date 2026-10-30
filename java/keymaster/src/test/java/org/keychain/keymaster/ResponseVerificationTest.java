package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.crypto.KeymasterCryptoImpl;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestFixtures;
import org.keychain.keymaster.testutil.TestGatekeeper;

@SuppressWarnings("unchecked")
class ResponseVerificationTest {
    private final ObjectMapper mapper = WalletJsonMapper.mapper();
    private final KeymasterCryptoImpl crypto = new KeymasterCryptoImpl();
    private final TestGatekeeper node = new TestGatekeeper();
    private final Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), node.client, "passphrase", "local");
    private String issuer;
    private String other;
    private String holder;
    private String requester;
    private String schema;
    private String challenge;
    private String vc;

    @BeforeEach
    void initialize() {
        keymaster.newWallet("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", false);
        issuer = keymaster.createId("Issuer");
        other = keymaster.createId("Other");
        holder = keymaster.createId("Holder");
        requester = keymaster.createId("Requester");
        keymaster.setCurrentId("Issuer");
        schema = keymaster.createSchema(TestFixtures.mockSchema());
        vc = issue("Issuer");
        keymaster.setCurrentId("Holder");
        assertTrue(keymaster.acceptCredential(vc));
        challenge = challenge(List.of(Map.of("schema", schema, "issuers", List.of(issuer))));
    }

    @Test
    void newResponsesHaveDistinctMultibaseNoncesAndPublishPrivateClaimFreeReceiptsByDefault() {
        String response = automatic();
        keymaster.setCurrentId("Holder");
        String second = keymaster.createResponse(challenge);
        keymaster.setCurrentId("Requester");
        String nonce = (String) payload(response).get("responseNonce");
        String secondNonce = (String) payload(second).get("responseNonce");
        assertNotEquals(nonce, secondNonce);
        assertEquals(43, nonce.substring(1).length());
        assertTrue(nonce.startsWith("u"));
        assertEquals(32, java.util.Base64.getUrlDecoder().decode(nonce.substring(1)).length);
        int before = node.created.size();
        Map<String, Object> verified = keymaster.verifyResponse(response, null);
        assertEquals(true, verified.get("match"));
        assertEquals(holder, verified.get("responder"));
        assertEquals(1, ((List<?>) verified.get("vps")).size());
        assertEquals(before + 1, node.created.size());
        assertEquals(List.of(expectedReceipt(response, nonce)), receipts());
        assertEquals(requester, node.created.get(before).controller);
        assertEquals("local", node.created.get(before).mdip.registry);
        assertNull(node.created.get(before).mdip.validUntil);
    }

    @Test
    void publishFalseHasNoPublicationSideEffectsAndCreationIgnoresIt() {
        keymaster.setCurrentId("Holder");
        CreateResponseOptions options = noPublish();
        String response = keymaster.createResponse(challenge, options);
        keymaster.setCurrentId("Requester");
        int before = node.created.size();
        assertEquals(true, keymaster.verifyResponse(response, options).get("match"));
        assertEquals(before, node.created.size());
        assertTrue(receipts().isEmpty());
        assertEquals(false, options.publish);
    }

    @ParameterizedTest
    @ValueSource(strings = {"revoked", "data", "unencrypted", "controller", "empty-controller", "sender"})
    void invalidOuterEnvelopeCannotVerifyOrPublish(String defect) {
        String response = automatic();
        var doc = node.doc(response);
        switch (defect) {
            case "revoked": doc.didDocumentMetadata.deactivated = true; break;
            case "data": doc.didDocumentData = null; break;
            case "unencrypted": doc.didDocumentData = Map.of("response", Map.of()); break;
            case "controller": doc.didDocument.controller = null; break;
            case "empty-controller": doc.didDocument.controller = ""; break;
            case "sender": encrypted(response).put("sender", other); break;
            default: fail(defect);
        }
        int before = node.created.size();
        assertThrows(IllegalArgumentException.class, () -> keymaster.verifyResponse(response));
        assertEquals(before, node.created.size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-json", "null", "[]", "\"text\"", "{}", "{\"response\":null}", "{\"response\":{}}"})
    void malformedPlaintextFailsClosed(String plaintext) {
        keymaster.setCurrentId("Holder");
        String response = keymaster.encryptMessage(plaintext, requester);
        keymaster.setCurrentId("Requester");
        assertThrows(IllegalArgumentException.class, () -> keymaster.verifyResponse(response));
        assertTrue(receipts().isEmpty());
    }

    @Test
    void checkedResponseVersionIsNotResolvedAgainDuringDecryption() {
        String response = automatic();
        AtomicInteger reads = new AtomicInteger();
        node.beforeResolve = did -> {
            if (did.equals(response) && reads.incrementAndGet() > 1) throw new AssertionError("Response re-resolved");
        };
        assertEquals(true, keymaster.verifyResponse(response, noPublish()).get("match"));
        assertEquals(1, reads.get());
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void selfResponsesDecryptWithEitherCiphertextChoice(boolean encryptForSender) {
        keymaster.setCurrentId("Requester");
        challenge = challenge(List.of());
        EncryptOptions options = new EncryptOptions();
        options.encryptForSender = encryptForSender;
        String response = keymaster.encryptJSON(Map.of("response", response(List.of())), requester, options);
        assertEquals(true, keymaster.verifyResponse(response, noPublish()).get("match"));
    }

    @Test
    void legacyFlatResponseEnvelopeRemainsSupported() {
        String response = automatic();
        Object wrapper = keymaster.decryptJSON(response);
        keymaster.setCurrentId("Holder");
        EncryptOptions options = new EncryptOptions();
        options.includeHash = true;
        String encrypted = keymaster.encryptJSON(wrapper, requester, options);
        String flat = keymaster.createAsset(encrypted(encrypted));
        keymaster.setCurrentId("Requester");
        assertEquals(true, keymaster.verifyResponse(flat, noPublish()).get("match"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"deactivated", "other-controller", "no-challenge"})
    void challengeMustBeLiveAndBelongToTheCapturedRequester(String defect) {
        String response = automatic();
        if (defect.equals("deactivated")) node.doc(challenge).didDocumentMetadata.deactivated = true;
        if (defect.equals("other-controller")) node.doc(challenge).didDocument.controller = other;
        if (defect.equals("no-challenge")) node.doc(challenge).didDocumentData = Map.of();
        assertThrows(IllegalArgumentException.class, () -> keymaster.verifyResponse(response));
        assertTrue(receipts().isEmpty());
    }

    @Test
    void anotherIdentityInTheSameWalletCannotVerifyJustBecauseItCanDecrypt() {
        String response = automatic();
        keymaster.setCurrentId("Holder");
        assertNotNull(keymaster.decryptJSON(response));
        assertThrows(IllegalArgumentException.class, () -> keymaster.verifyResponse(response, noPublish()));
        assertTrue(receipts().isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"vc-revoked", "vp-revoked", "vc-unencrypted", "vp-unencrypted", "missing-hash", "different-hash", "forged-hash", "wrong-subject", "missing-schema", "wrong-schema"})
    void invalidPresentationsCannotAuthorizeOrPublish(String defect) {
        keymaster.setCurrentId("Holder");
        Map<String, Object> pair = pair(vc);
        String vp = (String) pair.get("vp");
        switch (defect) {
            case "vc-revoked": node.doc(vc).didDocumentMetadata.deactivated = true; break;
            case "vp-revoked": node.doc(vp).didDocumentMetadata.deactivated = true; break;
            case "vc-unencrypted": node.doc(vc).didDocumentData = Map.of(); break;
            case "vp-unencrypted": node.doc(vp).didDocumentData = Map.of(); break;
            case "missing-hash": encrypted(vc).remove("cipher_hash"); encrypted(vp).remove("cipher_hash"); break;
            case "different-hash": encrypted(vp).put("cipher_hash", "different"); break;
            case "forged-hash": encrypted(vc).put("cipher_hash", "forged"); encrypted(vp).put("cipher_hash", "forged"); break;
            default:
                keymaster.setCurrentId("Issuer");
                Map<String, Object> credential = keymaster.bindCredential(schema, defect.equals("wrong-subject") ? other : holder);
                if (defect.equals("missing-schema")) credential.put("type", List.of("VerifiableCredential"));
                if (defect.equals("wrong-schema")) credential.put("type", List.of("VerifiableCredential", issuer));
                String invalid = keymaster.encryptJSON(keymaster.addSignature(credential, issuer), holder, hashed());
                keymaster.setCurrentId("Holder");
                pair = pair(invalid);
        }
        String response = manual(List.of(pair));
        keymaster.setCurrentId("Requester");
        int before = node.created.size();
        Map<String, Object> result = keymaster.verifyResponse(response);
        assertEquals(false, result.get("match"));
        assertEquals(List.of(), result.get("vps"));
        assertEquals(before, node.created.size());
    }

    @Test
    void forwardedValidCredentialsMustBelongToTheOuterResponder() {
        String response = automatic();
        Object wrapper = keymaster.decryptJSON(response);
        keymaster.setCurrentId("Other");
        String forwarded = keymaster.encryptJSON(wrapper, requester);
        keymaster.setCurrentId("Requester");
        Map<String, Object> result = keymaster.verifyResponse(forwarded);
        assertEquals(false, result.get("match"));
        assertEquals(other, result.get("responder"));
        assertTrue(receipts().isEmpty());
    }

    @Test
    void duplicatePresentationsCannotSatisfyRepeatedRequirements() {
        challenge = challenge(List.of(Map.of("schema", schema), Map.of("schema", schema)));
        keymaster.setCurrentId("Holder");
        Map<String, Object> pair = pair(vc);
        String response = manual(List.of(pair, pair));
        keymaster.setCurrentId("Requester");
        Map<String, Object> result = keymaster.verifyResponse(response);
        assertEquals(false, result.get("match"));
        assertEquals(1, ((List<?>) result.get("vps")).size());
        assertTrue(receipts().isEmpty());
    }

    @Test
    void distinctPresentationsOfTheSameCredentialCanSatisfyRepeatedRequirements() {
        challenge = challenge(List.of(Map.of("schema", schema), Map.of("schema", schema)));
        keymaster.setCurrentId("Holder");
        String response = manual(List.of(pair(vc), pair(vc)));
        keymaster.setCurrentId("Requester");
        assertEquals(true, keymaster.verifyResponse(response, noPublish()).get("match"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void assignmentReservesRestrictedRequirementsRegardlessOfPresentationOrder(boolean reverse) {
        String vcOther = issue("Other");
        challenge = challenge(List.of(Map.of("schema", schema), Map.of("schema", schema, "issuers", List.of(issuer))));
        keymaster.setCurrentId("Holder");
        Map<String, Object> first = pair(vc);
        Map<String, Object> second = pair(vcOther);
        String response = manual(reverse ? List.of(second, first) : List.of(first, second));
        keymaster.setCurrentId("Requester");
        Map<String, Object> result = keymaster.verifyResponse(response);
        assertEquals(true, result.get("match"));
        assertEquals(2, ((List<?>) result.get("vps")).size());
        assertEquals(2, receipts().size());
    }

    @Test
    void excessCandidatesAreNotCountedOrPublishedAndClientCountersDoNotAuthorize() {
        keymaster.setCurrentId("Holder");
        Map<String, Object> body = response(List.of(pair(vc), pair(vc)));
        body.put("requested", 500);
        body.put("fulfilled", 0);
        body.put("match", false);
        String response = keymaster.encryptJSON(Map.of("response", body), requester);
        keymaster.setCurrentId("Requester");
        Map<String, Object> result = keymaster.verifyResponse(response);
        assertEquals(true, result.get("match"));
        assertEquals(1, ((List<?>) result.get("vps")).size());
        assertEquals(1, receipts().size());
    }

    @Test
    void wrongRequirementsCannotBeReplacedByTheSameSchemaCount() {
        challenge = challenge(List.of(Map.of("schema", schema), Map.of("schema", issuer)));
        keymaster.setCurrentId("Holder");
        String response = manual(List.of(pair(vc), pair(vc)));
        keymaster.setCurrentId("Requester");
        assertEquals(false, keymaster.verifyResponse(response).get("match"));
        assertTrue(receipts().isEmpty());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void missingNonceCanVerifyWithoutPublicationButCannotPublishEvenForEmptyChallenges(boolean empty) {
        if (empty) challenge = challenge(List.of());
        keymaster.setCurrentId("Holder");
        Map<String, Object> body = response(empty ? List.of() : List.of(pair(vc)));
        body.remove("responseNonce");
        String response = keymaster.encryptJSON(Map.of("response", body), requester);
        keymaster.setCurrentId("Requester");
        assertEquals(true, keymaster.verifyResponse(response, noPublish()).get("match"));
        assertThrows(IllegalArgumentException.class, () -> keymaster.verifyResponse(response));
        assertThrows(IllegalArgumentException.class, () -> keymaster.publishChallengeReceipts(response));
        assertTrue(receipts().isEmpty());
    }

    @Test
    void emptyChallengesVerifyAndPublishNoReceipts() {
        challenge = challenge(List.of());
        String response = automatic();
        int before = node.created.size();
        assertEquals(true, keymaster.verifyResponse(response).get("match"));
        assertEquals(List.of(), keymaster.publishChallengeReceipts(response));
        assertEquals(before, node.created.size());
    }

    @Test
    void explicitReceiptOptionsAreForwardedAndVerifiedResultsCanBeReused() {
        String response = automatic();
        Map<String, Object> verified = keymaster.verifyResponse(response, noPublish());
        PublishChallengeReceiptOptions options = new PublishChallengeReceiptOptions();
        options.verification = verified;
        options.registry = "hyperswarm";
        options.validUntil = "2099-01-01T00:00:00Z";
        options.name = "receipt";
        String before = mapper.valueToTree(verified).toString();
        List<String> dids = keymaster.publishChallengeReceipts(response, options);
        assertEquals(1, dids.size());
        assertEquals(dids.get(0), keymaster.lookupDID("receipt"));
        var doc = node.doc(dids.get(0));
        assertEquals(requester, doc.didDocument.controller);
        assertEquals("hyperswarm", doc.mdip.registry);
        assertEquals(options.validUntil, doc.mdip.validUntil);
        assertEquals(before, mapper.valueToTree(verified).toString());
        assertEquals(expectedReceipt(response, (String) verified.get("responseNonce")),
            ((Map<?, ?>) doc.didDocumentData).get("challengeReceipt"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"match", "nonce", "vps", "invalid-vp", "no-schema", "requester", "name"})
    void invalidReceiptRequestsFailBeforePublishing(String defect) {
        String response = automatic();
        Map<String, Object> verified = keymaster.verifyResponse(response, noPublish());
        PublishChallengeReceiptOptions options = new PublishChallengeReceiptOptions();
        options.verification = verified;
        switch (defect) {
            case "match": verified.put("match", false); break;
            case "nonce": verified.remove("responseNonce"); break;
            case "vps": verified.remove("vps"); break;
            case "invalid-vp": verified.put("vps", List.of(Map.of())); break;
            case "no-schema": ((Map<String, Object>) ((List<?>) verified.get("vps")).get(0)).put("type", List.of("VerifiableCredential")); break;
            case "requester": keymaster.setCurrentId("Other"); break;
            case "name": verified.put("vps", List.of(((List<?>) verified.get("vps")).get(0), ((List<?>) verified.get("vps")).get(0))); options.name = "receipt"; break;
            default: fail(defect);
        }
        int before = node.created.size();
        assertThrows(IllegalArgumentException.class, () -> keymaster.publishChallengeReceipts(response, options));
        assertEquals(before, node.created.size());
    }

    @Test
    void aSecondReceiptFailurePropagatesWithoutRollingBackTheFirst() {
        challenge = challenge(List.of(Map.of("schema", schema), Map.of("schema", schema)));
        String response = automatic();
        int before = node.created.size();
        AtomicInteger publications = new AtomicInteger();
        node.beforeCreate = operation -> {
            if (publications.incrementAndGet() == 2) throw new IllegalStateException("receipt storage failed");
        };
        assertThrows(IllegalStateException.class, () -> keymaster.verifyResponse(response));
        assertEquals(before + 1, node.created.size());
        assertEquals(1, receipts().size());
    }

    @Test
    void receiptPublicationRetainsTheRequesterAcrossAnIdentitySwitch() {
        String response = automatic();
        AtomicInteger switches = new AtomicInteger();
        node.beforeResolve = did -> {
            if (did.equals(response) && switches.incrementAndGet() == 1) keymaster.setCurrentId("Other");
        };
        List<String> dids = keymaster.publishChallengeReceipts(response);
        assertEquals("Other", keymaster.getCurrentId());
        assertEquals(1, dids.size());
        assertEquals(requester, node.doc(dids.get(0)).didDocument.controller);
        assertTrue(keymaster.listAssets("Requester").contains(dids.get(0)));
        assertFalse(keymaster.listAssets("Other").contains(dids.get(0)));
    }

    @Test
    void retriesAreAppliedToResponseResolutionWithoutChangingOptions() {
        String response = automatic();
        AtomicInteger reads = new AtomicInteger();
        node.beforeResolve = did -> {
            if (did.equals(response) && reads.incrementAndGet() == 1) throw new IllegalStateException("temporarily unavailable");
        };
        CreateResponseOptions options = noPublish();
        options.retries = 1;
        options.delay = 0;
        assertEquals(true, keymaster.verifyResponse(response, options).get("match"));
        assertEquals(2, reads.get());
        assertEquals(1, options.retries);
        assertEquals(0, options.delay);
    }

    @Test
    void presentationJsonParseFailurePropagatesWithoutPublication() {
        keymaster.setCurrentId("Holder");
        String invalid = keymaster.encryptMessage("not JSON", requester, hashed());
        String response = manual(List.of(Map.of("vc", invalid, "vp", invalid)));
        keymaster.setCurrentId("Requester");
        assertThrows(IllegalArgumentException.class, () -> keymaster.verifyResponse(response));
        assertTrue(receipts().isEmpty());
    }

    @Test
    void plaintextHashUsesExactBytesRatherThanReserializedJson() throws Exception {
        keymaster.setCurrentId("Holder");
        String plaintext = keymaster.decryptMessage(vc);
        String pretty = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(mapper.readValue(plaintext, Object.class));
        assertNotEquals(plaintext, pretty);
        String formatted = keymaster.encryptMessage(pretty, requester, hashed());
        String response = manual(List.of(Map.of("vc", formatted, "vp", formatted)));
        keymaster.setCurrentId("Requester");
        assertEquals(true, keymaster.verifyResponse(response, noPublish()).get("match"));
        encrypted(formatted).put("cipher_hash", crypto.hashMessage(plaintext));
        assertEquals(false, keymaster.verifyResponse(response).get("match"));
        assertTrue(receipts().isEmpty());
    }

    @Test
    void receiptPublicationRetriesInitialResolutionWhenVerificationIsNotSupplied() {
        String response = automatic();
        AtomicInteger reads = new AtomicInteger();
        node.beforeResolve = did -> {
            if (did.equals(response) && reads.incrementAndGet() == 1) throw new IllegalStateException("temporarily unavailable");
        };
        PublishChallengeReceiptOptions options = new PublishChallengeReceiptOptions();
        options.retries = 1;
        options.delay = 0;
        assertEquals(1, keymaster.publishChallengeReceipts(response, options).size());
        assertEquals(2, reads.get());
    }

    private String issue(String signer) {
        keymaster.setCurrentId(signer);
        return keymaster.issueCredential(keymaster.bindCredential(schema, holder));
    }

    private String challenge(List<Map<String, Object>> requirements) {
        keymaster.setCurrentId("Requester");
        return keymaster.createChallenge(Map.of("credentials", requirements));
    }

    private String automatic() {
        keymaster.setCurrentId("Holder");
        String response = keymaster.createResponse(challenge);
        keymaster.setCurrentId("Requester");
        return response;
    }

    private Map<String, Object> pair(String credential) {
        return Map.of("vc", credential, "vp", keymaster.encryptMessage(keymaster.decryptMessage(credential), requester, hashed()));
    }

    private String manual(List<Map<String, Object>> pairs) {
        return keymaster.encryptJSON(Map.of("response", response(pairs)), requester);
    }

    private Map<String, Object> response(List<Map<String, Object>> pairs) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("challenge", challenge);
        response.put("credentials", pairs);
        response.put("requested", pairs.size());
        response.put("fulfilled", pairs.size());
        response.put("match", true);
        response.put("responseNonce", "test-nonce");
        return response;
    }

    private Map<String, Object> payload(String did) {
        return (Map<String, Object>) ((Map<?, ?>) keymaster.decryptJSON(did)).get("response");
    }

    private Map<String, Object> encrypted(String did) {
        return (Map<String, Object>) ((Map<?, ?>) node.doc(did).didDocumentData).get("encrypted");
    }

    private Map<String, Object> expectedReceipt(String response, String nonce) {
        return Map.of("version", 1, "attesterDid", issuer, "schemaDid", schema, "requesterDid", requester,
            "responseCommitment", crypto.hashJson(Map.of("responseDid", response, "responseNonce", nonce)));
    }

    private List<Object> receipts() {
        List<Object> receipts = new ArrayList<>();
        for (var doc : node.docs.values()) {
            Object data = doc.didDocumentData;
            if (data instanceof Map<?, ?> && ((Map<?, ?>) data).containsKey("challengeReceipt")) {
                receipts.add(((Map<?, ?>) data).get("challengeReceipt"));
            }
        }
        return receipts;
    }

    private static EncryptOptions hashed() {
        EncryptOptions options = new EncryptOptions();
        options.includeHash = true;
        return options;
    }

    private static CreateResponseOptions noPublish() {
        CreateResponseOptions options = new CreateResponseOptions();
        options.publish = false;
        return options;
    }
}
