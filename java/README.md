# Java Libraries

This folder contains Java Keymaster libraries and a Gatekeeper REST client.
The Java source packages use `org.keychain.*`. Maven coordinates retain the
`com.selfid` group ID. The Gradle project version is `1.0.1`. Building this
repository does not publish a Maven release.

Modules:
- `cid` — minimal CID validation.
- `crypto` — crypto primitives.
- `gatekeeper` — Gatekeeper REST client.
- `keymaster` — wallet + credential operations.

Compatibility and runtime
- JDK 11 is required (targeted bytecode and test runtime).
- Dependencies are pure-Java artifacts (OkHttp, Jackson, Bouncy Castle, Tink, bitcoinj).
- Gatekeeper default base URL is `http://localhost:4224` (see `GatekeeperClientOptions`).

## Tests

Install JDK 11 and set `JAVA_HOME` to its installation directory if it is not
your default JDK. Gradle uses the Java 11 toolchain without requiring a specific
installation path. The Java tests workflow runs offline and isolated reference integration tests
on pushes affecting Java, the reference packages, the Gatekeeper service or
their dependency files. It also compiles the demo.

From `java/`, run:

```bash
./gradlew test
```

The default suite includes the operation and encrypted-wallet compatibility
vectors and does not require a running Gatekeeper. Unsupported Gatekeeper calls
in offline Keymaster tests fail immediately. Tests tagged `live` are excluded.

To run the integration suite safely from the repository root:

```bash
npm ci
npm ci --prefix services/gatekeeper/server
npm run build
npm run build --prefix services/gatekeeper/server
node java/scripts/live-tests.mjs
```

The runner starts the actual reference Gatekeeper HTTP service on a temporary
port with a temporary JSON database, the local registry only, IPFS disabled and
maintenance disabled. It runs the original live workflows and two cross-language
credential/response scenarios, then stops the service and removes its test data.
It never joins Hyperswarm or touches an existing node. The reference scenarios
exchange encrypted wallets, signatures, receipts and index-export responses.
They also execute the shared browser cipher primitives under Node. They do not
launch a browser.

Gatekeeper startup is limited to 60 seconds, each live test to 60 seconds and
the whole runner to 15 minutes. Test reports and the service log are under
`java/keymaster/build/` and are uploaded by CI. Filter the suite with, for example:

```bash
node java/scripts/live-tests.mjs --tests '*LiveInteropTest'
```

To use an existing **isolated test** Gatekeeper instead, explicitly set its URL:

```bash
cd java
KC_GATEKEEPER_URL=http://localhost:4224 ./gradlew :keymaster:liveTest
```

That node must expose the local registry only. Live tests publish operations and
remove DID test data. Do not point them at a shared or production node.

Quickstart (Gradle)
```gradle
dependencies {
    implementation("com.selfid:cid:1.0.1")
    implementation("com.selfid:crypto:1.0.1")
    implementation("com.selfid:gatekeeper:1.0.1")
    implementation("com.selfid:keymaster:1.0.1")
}
```

Quickstart (Java)
```java
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.keymaster.Keymaster;
import org.keychain.keymaster.model.WalletEncFile;
import org.keychain.keymaster.store.WalletJson;
import org.keychain.keymaster.store.WalletStore;

Path dataDir = Paths.get(System.getProperty("user.home"), ".keymaster");
WalletStore<WalletEncFile> store = new WalletJson<>(WalletEncFile.class, dataDir, "wallet.json");

GatekeeperClientOptions options = new GatekeeperClientOptions();
options.baseUrl = "http://localhost:4224";
GatekeeperClient gatekeeper = new GatekeeperClient(options); // Close when the application stops.

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

## Supported scope

| Area | Java support |
| --- | --- |
| Wallets and identities | v0/v1 wallet loading, encrypted export, backup/recovery, identity names, aliases, key rotation and DID-prefix configuration |
| Assets and schemas | Creation, update, transfer, revocation, historical resolution and the existing minimal schema/template helpers |
| Credentials | Issuance, update, acceptance, holding, publication and revocation |
| Challenges | Credential selection, full signed presentations, response verification and public challenge receipts |
| Groups | Ordinary group membership and traversal |
| Cryptography and CIDs | HD-key JSON restoration, shared signing/encryption formats and reference CID validation |
| Gatekeeper client | Existing DID, registry, queue, CAS and block calls, plus paginated index export |

Images, files/documents, notices, DMail, polls/voting, group vaults, Search,
a remote Keymaster HTTP client and proof-of-work utilities remain outside this
Java subset. The approved additions are challenge receipts, Gatekeeper index
export and completion of the existing HD-key JSON restoration method.

This is compatibility for the supported subset, rather than the entire
TypeScript API. Existing minimal schema helpers require an object containing
`$schema` and `properties` and generate `TBD` fields. They do not implement a
complete JSON Schema validator or schema-based value generator. Java wallet
account and key indexes are bounded by signed 32-bit integers. Cancellation uses
a Java handle and `close()`, rather than `AbortSignal`.

## Compatibility notes

This update retains supported v0/v1 wallet and protocol encodings, including
unknown wallet metadata. Stricter validation rejects malformed wallets,
credentials, signatures and names that earlier Java versions accepted.
Readiness exhaustion, permanent configuration errors, refused persistence,
stale group edits and cleanup resolution failures now report failure.

Response verification publishes receipts by default, matching the reference.
Set `CreateResponseOptions.publish = false` for verification without writes.
Legacy responses without a nonce can verify only with publication disabled.
Receipts contain public identifiers and a response commitment, without private
credential claims. Presentations still carry complete signed credentials and
do not support selective field disclosure.

The obsolete whole-wallet AES wrapper and its outer DTO fields were removed.
JSON wallet storage requires atomic filesystem moves and a single writer per
wallet file. Compact signatures must be low-S. The crypto README explains the
narrow compatibility case for old Java wallets created with malformed UTF-16
passphrases. Caller code constructing Gatekeeper event ordinals must use
`Long` entries, such as `List.of(0L)`.

Module references:

- [CID](cid/README.md)
- [Cryptography](crypto/README.md)
- [Gatekeeper client](gatekeeper/README.md)
- [Keymaster](keymaster/README.md)

## Demo configuration

The Spring demo uses `keymaster.gatekeeperUrl`, `keymaster.registry`,
`keymaster.didPrefix` and `keymaster.gatekeeperCallTimeout` from
[application.yml](demo/src/main/resources/application.yml). The default call
deadline is `60s`. Spring environment variables such as
`KEYMASTER_DID_PREFIX` and `KEYMASTER_GATEKEEPER_CALL_TIMEOUT` can override them.
The configured prefix is retained when creating, resetting or importing a
wallet. The application closes its Gatekeeper client during Spring shutdown,
cancelling active requests and readiness waits.

```bash
cd java
./gradlew :demo:compileJava
./gradlew :demo:bootRun
```
