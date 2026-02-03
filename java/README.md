# Java Libraries

This folder contains the Java implementations of Keymaster and the Gatekeeper REST client.

Modules:
- `cid` — minimal CID validation.
- `crypto` — crypto primitives.
- `gatekeeper` — Gatekeeper REST client.
- `keymaster` — wallet + credential operations.

Compatibility and runtime
- JDK 11 is required (targeted bytecode and test runtime).
- Dependencies are pure-Java artifacts (OkHttp, Jackson, Bouncy Castle, Tink, bitcoinj).
- Gatekeeper default base URL is `http://localhost:4224` (see `GatekeeperClientOptions`).

Quickstart (Gradle)
```gradle
dependencies {
    implementation("com.selfid:cid:1.0.0")
    implementation("com.selfid:crypto:1.0.0")
    implementation("com.selfid:gatekeeper:1.0.0")
    implementation("com.selfid:keymaster:1.0.0")
}
```

Quickstart (Java)
```java
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import com.selfid.gatekeeper.GatekeeperClient;
import com.selfid.gatekeeper.GatekeeperClientOptions;
import com.selfid.keymaster.Keymaster;
import com.selfid.keymaster.model.WalletEncFile;
import com.selfid.keymaster.store.WalletJson;
import com.selfid.keymaster.store.WalletStore;

Path dataDir = Paths.get(System.getProperty("user.home"), ".keymaster");
WalletStore<WalletEncFile> store = new WalletJson<>(WalletEncFile.class, dataDir, "wallet.json");

GatekeeperClientOptions options = new GatekeeperClientOptions();
options.baseUrl = "http://localhost:4224";
GatekeeperClient gatekeeper = new GatekeeperClient(options);

Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");

String aliceDid = keymaster.createId("Alice", "hyperswarm");
System.out.println("DID: " + aliceDid);

Map<String, Object> emailSchema = new HashMap<>();
emailSchema.put("$schema", "http://json-schema.org/draft-07/schema#");
Map<String, Object> properties = new HashMap<>();
Map<String, Object> email = new HashMap<>();
email.put("format", "email");
email.put("type", "string");
properties.put("email", email);
emailSchema.put("properties", properties);
emailSchema.put("required", List.of("email"));
emailSchema.put("type", "object");

String schemaDid = keymaster.createSchema(emailSchema, "hyperswarm");
Map<String, Object> bound = keymaster.bindCredential(schemaDid, aliceDid);
String credentialDid = keymaster.issueCredential(bound);

keymaster.publishCredential(credentialDid, true);
```

See each module README for usage details:
- `java/cid/README.md`
- `java/crypto/README.md`
- `java/gatekeeper/README.md`
- `java/keymaster/README.md`
