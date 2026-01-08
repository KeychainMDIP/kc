package org.keychain.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class Secp256k1JwkTest {
    @Test
    void jwkGenerationProducesExpectedFields() {
        byte[] priv = new byte[32];
        priv[31] = 0x01;
        JwkPair pair = Secp256k1Jwk.fromPrivateKey(priv);

        assertNotNull(pair.publicJwk);
        assertNotNull(pair.privateJwk);
        assertEquals("EC", pair.publicJwk.kty);
        assertEquals("secp256k1", pair.publicJwk.crv);
        assertEquals(pair.publicJwk.x, pair.privateJwk.x);
        assertEquals(pair.publicJwk.y, pair.privateJwk.y);
        assertEquals(43, pair.publicJwk.x.length());
        assertEquals(43, pair.publicJwk.y.length());
        assertEquals(43, pair.privateJwk.d.length());
    }

    @Test
    void compressedKeyMatchesPrefix() {
        byte[] priv = new byte[32];
        priv[31] = 0x01;
        JwkPair pair = Secp256k1Jwk.fromPrivateKey(priv);
        byte[] compressed = Secp256k1Jwk.toCompressed(pair.publicJwk);

        assertEquals(33, compressed.length);
        assertTrue(compressed[0] == 0x02 || compressed[0] == 0x03);
    }
}
