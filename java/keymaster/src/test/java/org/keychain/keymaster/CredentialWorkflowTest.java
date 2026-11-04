package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.store.WalletJsonMemory;
import org.keychain.keymaster.testutil.TestFixtures;
import org.keychain.keymaster.testutil.TestGatekeeper;

class CredentialWorkflowTest {
    private static final String MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    private static final Instant NOW = Instant.parse("2030-06-15T12:00:00Z");
    private static final Field CLOCK = clockField();
    private final ObjectMapper mapper = WalletJsonMapper.mapper();
    private final TestGatekeeper node = new TestGatekeeper();
    private final Keymaster keymaster = new Keymaster(new WalletJsonMemory<>(WalletEncFile.class), node.client, "passphrase", "local");
    private Object oldClock;
    private String issuer;
    private String holder;
    private String verifier;
    private String schema;
    private String challenge;

    @BeforeEach
    void initialize() throws Exception {
        oldClock = CLOCK.get(null);
        CLOCK.set(null, (Supplier<Instant>) () -> NOW);
        keymaster.newWallet(MNEMONIC, false);
        issuer = keymaster.createId("Issuer");
        holder = keymaster.createId("Holder");
        verifier = keymaster.createId("Verifier");
        keymaster.setCurrentId("Issuer");
        schema = keymaster.createSchema(TestFixtures.mockSchema());
        keymaster.setCurrentId("Verifier");
        challenge = challenge(List.of(Map.of("schema", schema, "issuers", List.of(issuer))));
        keymaster.setCurrentId("Issuer");
    }

    @AfterEach
    void restoreClock() throws Exception {
        CLOCK.set(null, oldClock);
    }

    @ParameterizedTest
    @ValueSource(strings = {"context", "type", "date", "subject", "period"})
    void issuanceRejectsMalformedCredentialsBeforePublishing(String invalid) {
        Map<String, Object> credential = bound();
        corrupt(credential, invalid);
        int created = node.created.size();
        var before = new ArrayList<>(keymaster.listAssets("Issuer"));
        assertThrows(IllegalArgumentException.class, () -> keymaster.issueCredential(credential));
        assertEquals(created, node.created.size());
        assertEquals(before, keymaster.listAssets("Issuer"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"shape", "bad-signature", "wrong-signer", "wrong-subject"})
    void acceptanceRejectsInvalidCredentialsWithoutChangingHeld(String invalid) {
        Map<String, Object> credential = signed();
        if ("shape".equals(invalid)) credential = Map.of("message", "not a credential");
        if ("bad-signature".equals(invalid)) ((Map<String, Object>) credential.get("signature")).put("value", "00");
        if ("wrong-signer".equals(invalid)) {
            credential = keymaster.addSignature(bound(), verifier);
            assertTrue(keymaster.verifySignature(credential));
        }
        if ("wrong-subject".equals(invalid)) {
            Map<String, Object> wrong = bound();
            wrong.put("credentialSubject", Map.of("id", issuer));
            credential = keymaster.addSignature(wrong, issuer);
        }
        String did = encrypt(credential);
        keymaster.setCurrentId("Holder");
        assertFalse(keymaster.acceptCredential(did));
        assertTrue(keymaster.listCredentials().isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"shape", "bad-signature", "wrong-signer"})
    void manualPresentationsCannotBypassCredentialValidation(String invalid) {
        Map<String, Object> credential = bound();
        if ("shape".equals(invalid)) credential.put("@context", List.of());
        credential = keymaster.addSignature(credential, "wrong-signer".equals(invalid) ? verifier : issuer);
        if ("bad-signature".equals(invalid)) ((Map<String, Object>) credential.get("signature")).put("value", "00");
        String did = encrypt(credential);
        keymaster.setCurrentId("Holder");
        String response = manualResponse(List.of(did));
        keymaster.setCurrentId("Verifier");
        Map<String, Object> result = keymaster.verifyResponse(response);
        assertEquals(false, result.get("match"));
        assertTrue(((List<?>) result.get("vps")).isEmpty());
    }

    @Test
    void anEmptyBindingStartUsesTheCurrentTime() {
        BindCredentialOptions options = new BindCredentialOptions();
        options.validFrom = "";
        Map<String, Object> credential = keymaster.bindCredential(schema, holder, options);
        assertEquals(NOW, Instant.parse((String) credential.get("validFrom")));
        assertNotNull(keymaster.issueCredential(credential));
    }

    @ParameterizedTest
    @ValueSource(strings = {"issuer", "context", "type", "date", "subject", "period", "null-claims", "false-claims", "zero-claims", "empty-claims"})
    void invalidUpdatesCannotChangeTheStoredCredential(String invalid) {
        String did = keymaster.issueCredential(bound());
        Map<String, Object> replacement = bound();
        corrupt(replacement, invalid);
        JsonNode before = mapper.valueToTree(node.doc(did));
        assertThrows(IllegalArgumentException.class, () -> keymaster.updateCredential(did, replacement));
        assertEquals(before, mapper.valueToTree(node.doc(did)));
        assertTrue(node.submitted.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void updatesReplaceTheOldSignatureWithoutChangingTheCaller(boolean emptyClaims) {
        String did = keymaster.issueCredential(bound());
        Map<String, Object> replacement = signed();
        ((Map<String, Object>) replacement.get("signature")).put("value", "old signature");
        Map<String, Object> claims = emptyClaims ? Map.of() : Map.of("email", "new@example.test");
        replacement.put("credential", claims);
        JsonNode before = mapper.valueToTree(replacement);
        assertTrue(keymaster.updateCredential(did, replacement));
        assertEquals(before, mapper.valueToTree(replacement));
        keymaster.setCurrentId("Holder");
        Map<String, Object> updated = keymaster.getCredential(did);
        assertTrue(keymaster.verifySignature(updated));
        assertEquals(claims, updated.get("credential"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"get", "list", "publish"})
    void credentialReadersAndPublishRejectMalformedSignedData(String action) {
        Map<String, Object> credential = bound();
        credential.put("@context", List.of());
        String did = encrypt(keymaster.addSignature(credential, issuer));
        keymaster.setCurrentId("Holder");
        if ("get".equals(action)) assertNull(keymaster.getCredential(did));
        if ("list".equals(action)) assertTrue(keymaster.listIssued("Issuer").isEmpty());
        if ("publish".equals(action)) assertThrows(IllegalArgumentException.class, () -> keymaster.publishCredential(did));
        assertTrue(node.submitted.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"absent-hash", "expired", "not-yet-valid"})
    void acceptanceKeepsTheReferenceLegacyAndValidityPolicies(String valid) {
        Map<String, Object> credential = bound();
        if ("expired".equals(valid)) credential.put("validUntil", "2020-01-01T00:00:00Z");
        if ("expired".equals(valid)) credential.put("validFrom", "2019-01-01T00:00:00Z");
        if ("not-yet-valid".equals(valid)) credential.put("validFrom", "2040-01-01T00:00:00Z");
        credential = keymaster.addSignature(credential, issuer);
        if ("absent-hash".equals(valid)) ((Map<?, ?>) credential.get("signature")).remove("hash");
        String did = encrypt(credential);
        keymaster.setCurrentId("Holder");
        assertTrue(keymaster.acceptCredential(did));
        assertEquals(List.of(did), keymaster.listCredentials());
        assertNotNull(keymaster.getCredential(did));
    }

    @ParameterizedTest
    @ValueSource(strings = {"absent", "empty", "issuer", "different"})
    void issuerListsHaveTheSameMeaningInSelectionAndVerification(String restriction) {
        Map<String, Object> spec = new LinkedHashMap<>();
        spec.put("schema", schema);
        if (!"absent".equals(restriction)) spec.put("issuers", "empty".equals(restriction) ? List.of() : List.of("issuer".equals(restriction) ? issuer : verifier));
        keymaster.setCurrentId("Verifier");
        challenge = challenge(List.of(spec));
        keymaster.setCurrentId("Issuer");
        String did = encrypt(signed());
        hold(did);
        assertMatchesSelectionAndVerification(did, !"different".equals(restriction));
    }

    @Test
    void invalidCandidatesAreSkippedAndTheValidAlternativeIsRetained() {
        List<String> dids = new ArrayList<>();
        Map<String, Object> badSignature = signed();
        ((Map<String, Object>) badSignature.get("signature")).put("value", "00");
        dids.add(encrypt(badSignature));
        Map<String, Object> misplacedSchema = bound();
        misplacedSchema.put("type", List.of("VerifiableCredential", "different", schema));
        dids.add(encrypt(keymaster.addSignature(misplacedSchema, issuer)));
        Map<String, Object> expired = bound();
        expired.put("validUntil", NOW.minusSeconds(1).toString());
        dids.add(encrypt(keymaster.addSignature(expired, issuer)));
        dids.add(encrypt(keymaster.addSignature(bound(), verifier)));
        String valid = encrypt(signed());
        dids.add(valid);
        for (String did : dids) hold(did);
        keymaster.setCurrentId("Holder");
        String response = keymaster.createResponse(challenge);
        Map<?, ?> result = response(response);
        assertEquals(true, result.get("match"));
        assertEquals(valid, ((Map<?, ?>) ((List<?>) result.get("credentials")).get(0)).get("vc"));
        assertEquals(dids, keymaster.listCredentials());
    }

    static Stream<Arguments> validityCases() throws Exception {
        Set<String> names = Set.of("at validFrom", "at validUntil", "expired", "not yet valid", "null bounds",
            "offset validFrom", "offset validUntil", "impossible validFrom", "end of day", "fractional end of day",
            "submillisecond future start", "submillisecond future expiry", "submillisecond past start", "submillisecond past expiry",
            "very small fractional expiry", "reversed submillisecond window");
        return StreamSupport.stream(TestFixtures.readVector("credential-validation.json").get("cases").spliterator(), false)
            .filter(row -> names.contains(row.get("name").asText()))
            .map(row -> Arguments.of(row.get("name").asText(), row));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("validityCases")
    void selectionAndManualPresentationUseTheSameSignedDates(String name, JsonNode row) {
        Map<String, Object> credential = bound();
        credential.putAll(mapper.convertValue(row.get("changes"), Map.class));
        for (JsonNode field : row.path("remove")) credential.remove(field.asText());
        String did = encrypt(keymaster.addSignature(credential, issuer));
        hold(did);
        assertMatchesSelectionAndVerification(did, row.get("current").asBoolean());
    }

    @ParameterizedTest
    @ValueSource(strings = {"select", "verify"})
    void responseWorkflowsCaptureOneClockTick(String action) throws Exception {
        keymaster.setCurrentId("Verifier");
        challenge = challenge(List.of(Map.of("schema", schema), Map.of("schema", schema)));
        keymaster.setCurrentId("Issuer");
        Map<String, Object> credential = bound();
        credential.put("validUntil", "2030-06-15T12:00:00.0009Z");
        String did = encrypt(keymaster.addSignature(credential, issuer));
        hold(did);
        keymaster.setCurrentId("Holder");
        String manual = manualResponse(List.of(did, did));
        AtomicInteger ticks = new AtomicInteger();
        CLOCK.set(null, (Supplier<Instant>) () -> ticks.getAndIncrement() == 0 ? NOW : NOW.plusMillis(1));
        if ("select".equals(action)) {
            assertEquals(true, response(keymaster.createResponse(challenge)).get("match"));
        } else {
            keymaster.setCurrentId("Verifier");
            assertEquals(true, keymaster.verifyResponse(manual).get("match"));
        }
    }

    private void assertMatchesSelectionAndVerification(String did, boolean expected) {
        keymaster.setCurrentId("Holder");
        Map<?, ?> selected = response(keymaster.createResponse(challenge));
        assertEquals(expected, selected.get("match"));
        assertEquals(expected ? 1 : 0, ((List<?>) selected.get("credentials")).size());
        String manual = manualResponse(List.of(did));
        keymaster.setCurrentId("Verifier");
        Map<String, Object> verified = keymaster.verifyResponse(manual);
        assertEquals(expected, verified.get("match"));
        assertEquals(expected ? 1 : 0, ((List<?>) verified.get("vps")).size());
        assertEquals(List.of(did), keymaster.listCredentials("Holder"));
    }

    private Map<String, Object> bound() {
        Map<String, Object> credential = keymaster.bindCredential(schema, holder, null, null, Map.of("email", "holder@example.test"));
        credential.put("validFrom", "2030-06-15T11:59:00Z");
        return credential;
    }

    private Map<String, Object> signed() { return keymaster.addSignature(bound(), issuer); }

    private String encrypt(Map<String, Object> credential) {
        keymaster.setCurrentId("Issuer");
        EncryptOptions options = new EncryptOptions();
        options.registry = "local";
        options.includeHash = true;
        return keymaster.encryptJSON(credential, holder, options);
    }

    private void hold(String did) {
        keymaster.mutateWallet(wallet -> {
            var id = wallet.ids.get("Holder");
            if (id.held == null) id.held = new ArrayList<>();
            id.held.add(did);
        });
    }

    private String challenge(List<Map<String, Object>> credentials) {
        CreateAssetOptions options = new CreateAssetOptions();
        options.registry = "local";
        options.validUntil = "2099-01-01T00:00:00Z";
        return keymaster.createChallenge(Map.of("credentials", credentials), options);
    }

    private String manualResponse(List<String> dids) {
        List<Map<String, Object>> pairs = new ArrayList<>();
        EncryptOptions options = new EncryptOptions();
        options.registry = "local";
        options.includeHash = true;
        for (String did : dids) {
            String vp = keymaster.encryptMessage(keymaster.decryptMessage(did), verifier, options);
            pairs.add(Map.of("vc", did, "vp", vp));
        }
        Map<String, Object> response = Map.of("challenge", challenge, "credentials", pairs,
            "requested", dids.size(), "fulfilled", dids.size(), "match", true, "responseNonce", "test-nonce");
        return keymaster.encryptJSON(Map.of("response", response), verifier, options);
    }

    private Map<?, ?> response(String did) {
        return (Map<?, ?>) ((Map<?, ?>) keymaster.decryptJSON(did)).get("response");
    }

    private void corrupt(Map<String, Object> credential, String invalid) {
        switch (invalid) {
            case "context": credential.put("@context", List.of()); break;
            case "type": credential.put("type", List.of(schema)); break;
            case "date": credential.put("validFrom", "2030-02-30T00:00:00Z"); break;
            case "subject": credential.put("credentialSubject", Map.of()); break;
            case "period": credential.put("validFrom", "2030-06-15T11:59:00.0009Z"); credential.put("validUntil", "2030-06-15T11:59:00.0001Z"); break;
            case "issuer": credential.put("issuer", verifier); break;
            case "null-claims": credential.put("credential", null); break;
            case "false-claims": credential.put("credential", false); break;
            case "zero-claims": credential.put("credential", 0); break;
            case "empty-claims": credential.put("credential", ""); break;
            default: throw new AssertionError(invalid);
        }
    }

    private static Field clockField() {
        try {
            Field field = Keymaster.class.getDeclaredField("NOW_SUPPLIER");
            field.setAccessible(true);
            return field;
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
    }
}
