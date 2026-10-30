# Keymaster Crypto (Java)

Core crypto utilities that mirror the JS Keymaster behavior.

## Usage

```java
import com.selfid.crypto.HdKey;
import com.selfid.crypto.JwkPair;
import com.selfid.crypto.KeymasterCrypto;
import com.selfid.crypto.KeymasterCryptoImpl;

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
