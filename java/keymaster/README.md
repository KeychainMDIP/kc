# Keymaster (Java)

Keymaster manages an encrypted wallet and signs Gatekeeper operations.

## Usage

```java
import java.nio.file.Path;
import java.nio.file.Paths;
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
GatekeeperClient gatekeeper = new GatekeeperClient(options);

Keymaster keymaster = new Keymaster(store, gatekeeper, "passphrase");
keymaster.newWallet(null, true);

String did = keymaster.createId("Alice", "hyperswarm");
```

## Wallet compatibility

Java reads supported v0 wallets and upgrades them to v1, which encrypts the
mnemonic using the passphrase and encrypts the remaining wallet data separately.
The deprecated whole-wallet `{ salt, iv, data }` wrapper is no longer supported.
Loading it fails without changing the stored file. The obsolete outer
`WalletEncFile.salt`, `.iv` and `.data` Java fields have been removed. These
names can still be retained as opaque wallet metadata. The `seed.mnemonicEnc`
encryption format is unchanged.

Unknown wallet and identity properties are preserved at their original JSON
locations through loading, mutation, saving and encrypted export. Existing
`extras` objects stay nested as before. Metadata for features Java does not
implement is retained as opaque data.

Wallet payloads require a nonnegative integer counter and an identity map.
Each identity requires a nonempty DID string and nonnegative integer account
and key indexes. Java rejects missing values, numeric strings, fractional
numbers and values above 2,147,483,647 instead of coercing or wrapping them.
This upper bound reflects Java's existing integer and HD-derivation limits.
Malformed encrypted payloads and incorrect passphrases cannot replace a wallet.

## Wallet persistence

One Keymaster instance serializes wallet loading, creation, mutation, replacement
and recovery. Cached wallet data and its derived key are updated together after
a successful write. A refused mutation or failed recovery throws instead of
reporting success. Direct saves still return `false` when overwrite is refused.

The JSON adapter writes and flushes a temporary file in the wallet's directory,
then atomically replaces the old file. Existing POSIX ownership, group and
permissions are retained. If these cannot be retained, the write fails.
If atomic replacement is unsupported or a write fails, the adapter reports the
error and removes the temporary file without replacing the previous wallet.
Use a filesystem that supports atomic file moves and a single writer for each
wallet file. This does not coordinate separate processes or Keymaster instances.
