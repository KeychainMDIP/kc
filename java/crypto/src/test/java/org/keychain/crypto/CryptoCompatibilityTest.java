package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.keychain.crypto.util.Base64Url;
import org.keychain.crypto.util.Hex;

class CryptoCompatibilityTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final JsonNode ROOT = vectors();
    private static final JsonNode COMPAT = ROOT.get("compatibility");
    private final KeymasterCrypto crypto = new KeymasterCryptoImpl();

    @ParameterizedTest(name = "HD JSON {0}")
    @MethodSource("hdCases")
    void restoresTheExtendedKeyAndReferenceDerivation(JsonNode vector) {
        JsonNode input = vector.get("input");
        HdKeyJson json = new HdKeyJson(input.get("xpriv").asText(), input.path("xpub").asText(null),
            input.path("chainCode").asText(null), 999, -1, -1);
        HdKey restored = crypto.generateHdKeyJson(json);
        assertEquals(vector.get("xpriv").asText(null), restored.xpriv);
        assertEquals(vector.get("xpub").asText(), restored.xpub);
        if (vector.has("derivedPrivateHex")) {
            var child = HdKeyUtil.derivePath(HdKeyUtil.fromXpriv(restored.xpriv), 0, 0);
            assertEquals(vector.get("derivedPrivateHex").asText(), Hex.encode(HdKeyUtil.privateKeyBytes(child)));
        } else assertNull(restored.xpriv);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "missing", "empty", "garbage", "checksum"})
    void malformedHdJsonFailsWithoutFallingBackToThePublicField(String defect) {
        String xpriv = ROOT.get("vectors").get("hdKey").get("xpriv").asText();
        if (defect.equals("missing")) xpriv = null;
        if (defect.equals("empty")) xpriv = "";
        if (defect.equals("garbage")) xpriv = "invalid";
        if (defect.equals("checksum")) xpriv = xpriv.substring(0, xpriv.length() - 1) + "1";
        HdKeyJson json = defect.equals("null") ? null : new HdKeyJson(xpriv,
            ROOT.get("vectors").get("hdKey").get("xpub").asText(), null, null, null, null);
        assertThrows(RuntimeException.class, () -> crypto.generateHdKeyJson(json));
    }

    @ParameterizedTest(name = "invalid extended key {0}")
    @MethodSource("invalidExtendedCases")
    void rejectsChecksummedExtendedKeysWithInvalidPrivateScalars(JsonNode vector) {
        HdKeyJson json = new HdKeyJson(vector.get("xpriv").asText(), null, null, null, null, null);
        assertThrows(RuntimeException.class, () -> crypto.generateHdKeyJson(json));
    }

    @ParameterizedTest(name = "canonical {0}")
    @MethodSource("hashCases")
    void canonicalJsonMatchesTheReferenceIncludingNullAndUnicode(JsonNode vector) throws Exception {
        Object input = MAPPER.treeToValue(vector.get("input"), Object.class);
        assertEquals(vector.get("canonical").asText(), CanonicalJson.canonicalize(input));
        assertEquals(vector.get("hash").asText(), crypto.hashJson(input));
        assertEquals(vector.get("hash").asText(), crypto.hashJson(vector.get("input")));
    }

    @Test
    void nonFiniteNumbersCannotBeHashedAsStrings() {
        for (double number : new double[] {Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY}) {
            assertThrows(IllegalArgumentException.class, () -> crypto.hashJson(number));
            assertThrows(IllegalArgumentException.class, () -> crypto.hashJson(Map.of("number", number)));
        }
    }

    @ParameterizedTest(name = "signature {0}")
    @MethodSource("signatureCases")
    void signatureVerificationMatchesTheReference(JsonNode vector) throws Exception {
        JwkPublic pub = publicKey(vector.get("publicJwk"));
        String hash = vector.get("hash").asText(), sig = vector.get("signature").asText();
        if (vector.get("result").isTextual()) assertThrows(RuntimeException.class, () -> crypto.verifySig(hash, sig, pub));
        else assertEquals(vector.get("result").asBoolean(), crypto.verifySig(hash, sig, pub));
    }

    @ParameterizedTest
    @ValueSource(strings = {"00", "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142", "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "01"})
    void rejectsInvalidPrivateScalarsAcrossKeySigningAndEncryption(String hex) throws Exception {
        byte[] secret = hex.equals("00") ? new byte[32] : Hex.decode(hex);
        assertThrows(IllegalArgumentException.class, () -> crypto.generateJwk(secret));
        JsonNode valid = ROOT.get("vectors").get("jwk");
        JwkPrivate privateKey = new JwkPrivate("EC", "secp256k1", valid.get("publicJwk").get("x").asText(),
            valid.get("publicJwk").get("y").asText(), Base64Url.encode(secret));
        JwkPublic publicKey = publicKey(valid.get("publicJwk"));
        assertThrows(IllegalArgumentException.class, () -> crypto.signHash("00".repeat(32), privateKey));
        assertThrows(IllegalArgumentException.class, () -> crypto.encryptBytes(publicKey, privateKey, new byte[0]));
    }

    @Test
    void ecdhUsesTheSameCompressedKeyInterpretationAsTheReference() throws Exception {
        JsonNode v = ROOT.get("vectors");
        JwkPublic original = publicKey(v.get("jwk").get("publicJwk"));
        byte[] y = new byte[32]; y[31] = 1;
        JwkPublic compressedEquivalent = new JwkPublic("EC", "secp256k1", original.x, Base64Url.encode(y));
        JwkPrivate receiver = privateKey(v.get("encrypt").get("receiver").get("privateJwk"));
        assertEquals(v.get("ecdh").get("sharedSecretCompressedHex").asText(),
            Hex.encode(Secp256k1Ecdh.sharedSecretCompressed(compressedEquivalent, receiver)));
    }

    @ParameterizedTest(name = "binary {0}")
    @MethodSource("binaryCases")
    void binaryHashesAndEncryptionRemainCompatible(JsonNode vector) throws Exception {
        JsonNode v = ROOT.get("vectors").get("encrypt");
        JwkPublic sender = publicKey(v.get("sender").get("publicJwk"));
        JwkPrivate receiver = privateKey(v.get("receiver").get("privateJwk"));
        JwkPrivate senderSecret = privateKey(v.get("sender").get("privateJwk"));
        JwkPublic receiverPublic = publicKey(v.get("receiver").get("publicJwk"));
        byte[] expected = Hex.decode(vector.get("hex").asText());
        assertEquals(vector.get("hash").asText(), crypto.hashMessage(expected));
        assertArrayEquals(expected, crypto.decryptBytes(sender, receiver, vector.get("ciphertext").asText()));
        String encrypted = crypto.encryptBytes(receiverPublic, senderSecret, expected);
        assertArrayEquals(expected, crypto.decryptBytes(sender, receiver, encrypted));
        byte[] tampered = Base64Url.decode(encrypted); tampered[tampered.length - 1] ^= 1;
        assertThrows(RuntimeException.class, () -> crypto.decryptBytes(sender, receiver, Base64Url.encode(tampered)));
    }

    @ParameterizedTest(name = "UTF-8 {0}")
    @MethodSource("messageCases")
    void textEncodingMatchesTextEncoderIncludingLoneSurrogates(JsonNode vector) throws Exception {
        String input = vector.get("message").asText();
        assertEquals(vector.get("hash").asText(), crypto.hashMessage(input));
        JsonNode v = ROOT.get("vectors").get("encrypt");
        JwkPublic sender = publicKey(v.get("sender").get("publicJwk"));
        JwkPrivate receiver = privateKey(v.get("receiver").get("privateJwk"));
        JwkPrivate senderSecret = privateKey(v.get("sender").get("privateJwk"));
        JwkPublic receiverPublic = publicKey(v.get("receiver").get("publicJwk"));
        String encrypted = crypto.encryptMessage(receiverPublic, senderSecret, input);
        String normalized = new String(Hex.decode(vector.get("utf8Hex").asText()), java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(normalized, crypto.decryptMessage(sender, receiver, encrypted));
    }

    @ParameterizedTest(name = "UTF-8 decode {0}")
    @MethodSource("decodingCases")
    void textDecryptionMatchesTextDecoderWithoutChangingBinaryPlaintext(JsonNode vector) {
        JsonNode v = ROOT.get("vectors").get("encrypt");
        JwkPublic sender = publicKey(v.get("sender").get("publicJwk"));
        JwkPrivate receiver = privateKey(v.get("receiver").get("privateJwk"));
        String ciphertext = vector.get("ciphertext").asText();
        assertEquals(vector.get("text").asText(), crypto.decryptMessage(sender, receiver, ciphertext));
        byte[] key = Secp256k1Ecdh.deriveKey32(Secp256k1Ecdh.sharedSecretCompressed(sender, receiver));
        assertEquals(vector.get("text").asText(), XChaCha20Util.decryptToString(key, ciphertext));
        assertArrayEquals(Hex.decode(vector.get("hex").asText()), crypto.decryptBytes(sender, receiver, ciphertext));
    }

    @ParameterizedTest(name = "mnemonic text {0}")
    @MethodSource("mnemonicCases")
    void mnemonicTextUsesTheReferenceUtf8Rules(JsonNode vector) {
        EncryptedMnemonic blob = new EncryptedMnemonic(vector.get("salt").asText(), vector.get("iv").asText(), vector.get("data").asText());
        assertEquals(vector.get("decrypted").asText(), MnemonicEncryption.decrypt(blob, vector.get("passphrase").asText()));
        EncryptedMnemonic encrypted = MnemonicEncryption.encrypt(vector.get("mnemonic").asText(), vector.get("passphrase").asText(),
            java.util.Base64.getDecoder().decode(blob.salt), java.util.Base64.getDecoder().decode(blob.iv));
        assertEquals(blob.data, encrypted.data);
    }

    @ParameterizedTest(name = "base64url {0}")
    @MethodSource("encodingCases")
    void base64urlValidationMatchesTheReference(JsonNode vector) {
        if (vector.get("hex").isNull()) assertThrows(IllegalArgumentException.class, () -> Base64Url.decode(vector.get("input").asText()));
        else assertEquals(vector.get("hex").asText(), Hex.encode(Base64Url.decode(vector.get("input").asText())));
    }

    @Test
    void rejectsInternalPaddingFollowedByAnInvalidCharacter() {
        assertThrows(IllegalArgumentException.class, () -> Base64Url.decode("=".repeat(4096) + "?"));
        assertThrows(IllegalArgumentException.class, () -> Base64Url.decode("AA" + "=".repeat(4096) + "?"));
    }

    private static JwkPublic publicKey(JsonNode node) {
        return new JwkPublic(node.get("kty").asText(), node.get("crv").asText(), node.get("x").asText(), node.get("y").asText());
    }
    private static JwkPrivate privateKey(JsonNode node) {
        return new JwkPrivate(node.get("kty").asText(), node.get("crv").asText(), node.get("x").asText(), node.get("y").asText(), node.get("d").asText());
    }
    private static Stream<JsonNode> invalidExtendedCases() { return cases("invalidExtended"); }
    private static Stream<JsonNode> decodingCases() { return cases("utf8Decoding"); }
    private static Stream<JsonNode> mnemonicCases() { return cases("mnemonicText"); }
    private static Stream<JsonNode> hdCases() { return cases("hdJson"); }
    private static Stream<JsonNode> hashCases() { return cases("hashes"); }
    private static Stream<JsonNode> signatureCases() { return cases("signatures"); }
    private static Stream<JsonNode> binaryCases() { return cases("binary"); }
    private static Stream<JsonNode> messageCases() { return cases("messages"); }
    private static Stream<JsonNode> encodingCases() { return cases("base64url"); }
    private static Stream<JsonNode> cases(String name) {
        return java.util.stream.StreamSupport.stream(COMPAT.get(name).spliterator(), false);
    }
    private static JsonNode vectors() {
        try (InputStream input = CryptoCompatibilityTest.class.getResourceAsStream("/vectors/crypto-v1.json")) {
            return MAPPER.readTree(input);
        } catch (Exception e) { throw new AssertionError(e); }
    }
}
