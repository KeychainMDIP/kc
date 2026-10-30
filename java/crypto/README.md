# Keymaster Crypto (Java)

Core crypto utilities that mirror the JS Keymaster behavior.

## Usage

```java
import org.keychain.crypto.HdKey;
import org.keychain.crypto.JwkPair;
import org.keychain.crypto.KeymasterCrypto;
import org.keychain.crypto.KeymasterCryptoImpl;

KeymasterCrypto crypto = new KeymasterCryptoImpl();

String mnemonic = crypto.generateMnemonic();
HdKey hdKey = crypto.generateHdKey(mnemonic);

JwkPair jwkPair = crypto.generateRandomJwk();
String msgHash = crypto.hashMessage("hello");
String sig = crypto.signHash(msgHash, jwkPair.privateJwk);
boolean ok = crypto.verifySig(msgHash, sig, jwkPair.publicJwk);
```

`generateRandomSalt()` returns 32 cryptographically random bytes encoded as
multibase base64url with the `u` prefix, matching the reference response nonce.
JWK values and ciphertext remain unprefixed base64url. Mnemonic encryption
retains its separate padded base64 encoding.

## HD JSON restoration

`generateHdKeyJson()` restores the Base58 extended key in `HdKeyJson.xpriv`.
The other fields are ignored, matching the reference. It does not fall back to
`xpub` when `xpriv` is absent. Checksums and private scalar ranges are validated.
A public extended key supplied in the `xpriv` field produces a public-only result
with a null private key, as in the reference.

## Encoding and validation

Signature verification requires compact low-S ECDSA signatures. Invalid curve
points return false, while malformed signature encodings throw. Public keys use
the same compressed x-coordinate and y-parity representation as the reference.
Private keys must be 32-byte scalars greater than zero and below the curve order.

Canonical JSON hashes retain explicit nulls and JavaScript number and Unicode
semantics. Non-finite numbers are rejected. Encrypted JSON and HTTP request
bodies preserve escaped lone surrogates so signatures retain their signed
values. String hashing and encryption use
TextEncoder's replacement for malformed UTF-16. Text decryption follows
TextDecoder's initial BOM removal and invalid UTF-8 replacement behavior.
Mnemonic text follows the same rules. Passphrases use TextEncoder's UTF-8
replacement without plaintext BOM removal. SHA-256, ECDH,
XChaCha20-Poly1305 and mnemonic encryption use the reference formats.

HD mnemonic derivation applies BIP39 NFKD normalization and preserves whitespace,
matching the reference. Wallet creation generates a random mnemonic when its
mnemonic argument is null or empty.
