package org.keychain.keymaster;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.keychain.gatekeeper.GatekeeperInterface;
import org.keychain.gatekeeper.model.IndexExportRequest;
import org.keychain.gatekeeper.model.IndexExportResponse;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJsonMapper;
import org.keychain.keymaster.testutil.LiveTestSupport;
import org.keychain.keymaster.testutil.TestFixtures;

@Tag("live")
@ExtendWith(LiveTestSupport.class)
class LiveInteropTest {
    private static final String PASSPHRASE = "interop passphrase";
    private static final Map<String, Object> CLAIMS = Map.of("email", "jose@example.com", "label", "José 🧪");
    private static final Map<String, Object> METADATA = new LinkedHashMap<>();
    static {
        METADATA.put("nullValue", null);
        METADATA.put("label", "José 🧪");
    }

    @TempDir Path tempDir;

    private Keymaster keymaster() {
        KeymasterOptions options = new KeymasterOptions();
        options.wallet = LiveTestSupport.walletStore(tempDir);
        options.gatekeeper = LiveTestSupport.gatekeeperClient();
        options.passphrase = PASSPHRASE;
        options.defaultRegistry = "local";
        options.didPrefix = "did:interop";
        return new Keymaster(options);
    }

    @Test
    void referenceVerifiesJavaCredentialResponseAndEncryptedWallet() throws Exception {
        Keymaster java = keymaster();
        java.newWallet("abandon  abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", false);
        GatekeeperInterface gatekeeper = LiveTestSupport.gatekeeperClient();
        String cursor = checkpoint(gatekeeper);
        String issuer = java.createId("Issuer");
        String holder = java.createId("Holder");
        String requester = java.createId("Verifier");
        assertTrue(issuer.startsWith("did:interop:"));
        java.setCurrentId("Issuer");
        String schema = java.createSchema(TestFixtures.mockSchema());
        Map<String, Object> bound = java.bindCredential(schema, holder);
        bound.put("credential", CLAIMS);
        String vc = java.issueCredential(bound);
        java.setCurrentId("Holder");
        assertTrue(java.acceptCredential(vc));
        java.setCurrentId("Verifier");
        String challenge = java.createChallenge(Map.of("credentials", List.of(Map.of("schema", schema, "issuers", List.of(issuer)))), LiveTestSupport.localAssets());
        java.setCurrentId("Holder");
        String response = java.createResponse(challenge, LiveTestSupport.localResponse());
        java.setCurrentId("Verifier");
        java.mutateWallet(wallet -> wallet.additionalProperties().put("interop", METADATA));
        JsonNode result = reference("verify", Map.of("wallet", java.exportEncryptedWallet(), "vcDid", vc,
            "responseDid", response, "holderDid", holder, "claims", CLAIMS, "metadata", METADATA, "cursor", cursor));
        assertEquals(1, result.get("receipts").size());
        assertReceipt(java, result.get("receipts").get(0).asText(), issuer, schema, requester);
        assertTrue(java.saveWallet(WalletJsonMapper.mapper().treeToValue(result.get("wallet"), WalletEncFile.class), true));
        assertEquals(METADATA, java.loadWallet().additionalProperties().get("interop"));
        IndexExportResponse index = changes(gatekeeper, cursor);
        assertEquals(WalletJsonMapper.mapper().valueToTree(index), WalletJsonMapper.mapper().valueToTree(
            WalletJsonMapper.mapper().treeToValue(result.get("index"), IndexExportResponse.class)));
        assertTrue(index.operations.stream().anyMatch(record -> record.did.equals(response)));
    }

    @Test
    void javaVerifiesReferenceCredentialResponseAndEncryptedWallet() throws Exception {
        JsonNode data = reference("create", Map.of("schema", TestFixtures.mockSchema(), "claims", CLAIMS, "metadata", METADATA,
            "mnemonic", "ａｂａｎｄｏｎ abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"));
        Keymaster java = keymaster();
        assertTrue(java.saveWallet(WalletJsonMapper.mapper().treeToValue(data.get("wallet"), WalletEncFile.class), true));
        assertEquals(METADATA, java.loadWallet().additionalProperties().get("interop"));
        java.setCurrentId("Holder");
        String vc = data.get("vcDid").asText();
        assertTrue(java.acceptCredential(vc));
        Map<String, Object> credential = java.getCredential(vc);
        assertEquals(CLAIMS, credential.get("credential"));
        assertTrue(java.verifySignature(credential));
        java.setCurrentId("Verifier");
        CreateResponseOptions options = new CreateResponseOptions();
        options.publish = false;
        Map<String, Object> verification = java.verifyResponse(data.get("responseDid").asText(), options);
        assertEquals(true, verification.get("match"));
        assertEquals(1, verification.get("requested"));
        assertEquals(data.get("holderDid").asText(), verification.get("responder"));
        PublishChallengeReceiptOptions receiptOptions = new PublishChallengeReceiptOptions();
        receiptOptions.registry = "local";
        List<String> receipts = java.publishChallengeReceipts(data.get("responseDid").asText(), receiptOptions);
        assertEquals(1, receipts.size());
        assertReceipt(java, receipts.get(0), data.get("issuerDid").asText(), data.get("schemaDid").asText(), data.get("requesterDid").asText());
        IndexExportResponse index = changes(LiveTestSupport.gatekeeperClient(), data.get("cursor").asText());
        assertTrue(index.operations.stream().anyMatch(record -> record.did.equals(vc)));
    }

    private static void assertReceipt(Keymaster keymaster, String did, String issuer, String schema, String requester) {
        Map<?, ?> receipt = (Map<?, ?>) ((Map<?, ?>) keymaster.resolveAsset(did)).get("challengeReceipt");
        assertEquals(issuer, receipt.get("attesterDid"));
        assertEquals(schema, receipt.get("schemaDid"));
        assertEquals(requester, receipt.get("requesterDid"));
        assertTrue(receipt.get("responseCommitment").toString().matches("[a-f0-9]{64}"));
        assertFalse(receipt.containsKey("credential"));
    }

    private static String checkpoint(GatekeeperInterface gatekeeper) {
        IndexExportRequest request = new IndexExportRequest();
        request.mode = "snapshot";
        request.limit = 1;
        return gatekeeper.exportIndex(request).checkpointCursor;
    }

    private static IndexExportResponse changes(GatekeeperInterface gatekeeper, String cursor) {
        IndexExportRequest request = new IndexExportRequest();
        request.mode = "changes";
        request.cursor = cursor;
        request.includeOperations = true;
        request.limit = 5000;
        IndexExportResponse result = gatekeeper.exportIndex(request);
        assertFalse(result.hasMore);
        return result;
    }

    private JsonNode reference(String action, Object input) throws Exception {
        Path inputFile = tempDir.resolve(action + "-input.json");
        Path outputFile = tempDir.resolve(action + "-output.json");
        Path logFile = tempDir.resolve(action + "-node.log");
        WalletJsonMapper.mapper().writeValue(inputFile.toFile(), input);
        Path script = Path.of(getClass().getResource("/interop/reference.mjs").toURI());
        Process child = new ProcessBuilder("node", script.toString(), action, inputFile.toString(), outputFile.toString())
            .redirectErrorStream(true).redirectOutput(logFile.toFile()).start();
        try {
            assertTrue(child.waitFor(45, TimeUnit.SECONDS), "Reference process timed out");
            assertEquals(0, child.exitValue(), () -> {
                try { return Files.readString(logFile); } catch (Exception error) { return error.toString(); }
            });
            return WalletJsonMapper.mapper().readTree(outputFile.toFile());
        } finally {
            child.destroyForcibly();
            child.waitFor(5, TimeUnit.SECONDS);
        }
    }
}
