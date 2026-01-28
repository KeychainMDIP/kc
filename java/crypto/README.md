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
