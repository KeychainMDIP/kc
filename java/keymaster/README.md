# Keymaster (Java)

Keymaster manages an encrypted wallet and signs Gatekeeper operations.

## Usage

```java
import java.nio.file.Path;
import java.nio.file.Paths;
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
keymaster.newWallet(null, true);

String did = keymaster.createId("Alice", "hyperswarm");
```
