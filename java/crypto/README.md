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
