# Gatekeeper Client (Java)

HTTP client for the Gatekeeper REST API.

## Usage

```java
import org.keychain.gatekeeper.GatekeeperClient;
import org.keychain.gatekeeper.GatekeeperClientOptions;
import org.keychain.gatekeeper.model.MdipDocument;

GatekeeperClientOptions options = new GatekeeperClientOptions();
options.baseUrl = "http://localhost:4224";

GatekeeperClient gatekeeper = new GatekeeperClient(options);
MdipDocument doc = gatekeeper.resolveDID("did:test:example", null);
```
