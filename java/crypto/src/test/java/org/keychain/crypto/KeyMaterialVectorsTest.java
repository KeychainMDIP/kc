package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.bitcoinj.crypto.DeterministicKey;
import org.junit.jupiter.api.Test;

class KeyMaterialVectorsTest {
    @Test
    void mnemonicHdKeyAndJwkMatchVectors() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode vectors;
        try (InputStream input = getClass().getResourceAsStream("/vectors/crypto-v1.json")) {
            assertNotNull(input, "crypto-v1.json should be present in test resources");
            JsonNode root = mapper.readTree(input);
            vectors = root.get("vectors");
        }

        JsonNode mnemonicNode = vectors.get("mnemonic");
        String mnemonic = mnemonicNode.get("phrase").asText();
        assertNotNull(mnemonic);

        DeterministicKey master = HdKeyUtil.masterFromMnemonic(mnemonic);
        HdKey hdKey = HdKeyUtil.toHdKey(master);

        JsonNode hdKeyNode = vectors.get("hdKey");
        assertEquals(hdKeyNode.get("xpriv").asText(), hdKey.xpriv);
        assertEquals(hdKeyNode.get("xpub").asText(), hdKey.xpub);

        int account = hdKeyNode.get("account").asInt();
        int index = hdKeyNode.get("index").asInt();

        DeterministicKey derived = HdKeyUtil.derivePath(master, account, index);
        JwkPair jwkPair = Secp256k1Jwk.fromPrivateKey(HdKeyUtil.privateKeyBytes(derived));

        JsonNode jwkNode = vectors.get("jwk");
        JsonNode publicNode = jwkNode.get("publicJwk");
        JsonNode privateNode = jwkNode.get("privateJwk");

        assertEquals(publicNode.get("kty").asText(), jwkPair.publicJwk.kty);
        assertEquals(publicNode.get("crv").asText(), jwkPair.publicJwk.crv);
        assertEquals(publicNode.get("x").asText(), jwkPair.publicJwk.x);
        assertEquals(publicNode.get("y").asText(), jwkPair.publicJwk.y);

        assertEquals(privateNode.get("d").asText(), jwkPair.privateJwk.d);
    }
}
