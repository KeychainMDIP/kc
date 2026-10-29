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

## Identity lifecycle

Identity creation persists the account reservation before publishing the DID.
A failed reservation prevents publication. A publication or final wallet-write
failure can leave an account consumed without an identity entry, including
after restart. That account is not reused.
Preparing a `createIdOperation()` remains read-only and does not reserve an account.

Identity and alias names share one namespace. Creation, renaming and recovery
trim whitespace like JavaScript, reject `.` and `..`, and detect collisions
with historical names that contain surrounding whitespace.

Recovery reconciles an older backup with the current `#key-N` index and checks
that the derived key matches the DID's public key before adding the identity.
The wallet counter advances beyond the recovered account without moving
backwards. Values outside Java's account or key-index range fail explicitly.

An unconfirmed version-1 identity may rotate. Later unconfirmed versions must
wait for confirmation. If a successful Gatekeeper response is followed by a
failed wallet write, its key index remains accessible in memory. A later
successful wallet write persists that reconciliation. This does not guarantee
recovery of the updated index across a restart before that write.

## Operation identity and version checks

Asset creation, encryption, credential workflows, identity backups and challenge
responses keep the initiating identity throughout their nested calls. Changing
the current identity during a network call does not change the sender, holder
or wallet entry updated by that operation. An explicit asset controller chooses
the signing identity while the initiating owner tracks the asset.
Issuance and response creation retain their previous handling of inherited
`name` and `controller` options, which are ignored. Their assets stay controlled
by the issuer or responder. Generic asset and encryption methods support
explicit controller selection.
`listIssued(issuer)` decrypts using the requested issuer, even if another
identity is selected. `listIssued()` and `listCredentials()` select the current
identity.

`updateDID()` preserves a supplied `didDocumentMetadata.versionId` as the
version precondition and returns `false` if it is stale, including for an
otherwise unchanged document. Without a precondition it uses the current
version. Signing uses a separate document copy and keeps the caller unchanged.
Unpublishing a credential and recording a wallet-backup link throw if their
update is rejected.

Cryptographic resolution prefers confirmed keys. Only a not-found response
permits fallback to the immutable version-1 key, retaining any historical time
used for decryption. Connection and other resolution failures propagate.

## Deployment options

Existing constructors remain available. Use `KeymasterOptions` to configure
the DID prefix and maximum name length alongside the default registry:

```java
import org.keychain.keymaster.KeymasterOptions;

KeymasterOptions settings = new KeymasterOptions();
settings.wallet = store;
settings.gatekeeper = gatekeeper;
settings.passphrase = "passphrase";
settings.defaultRegistry = "hyperswarm";
settings.didPrefix = "did:example";
settings.maxNameLength = 32;
Keymaster configured = new Keymaster(settings);
```

The prefix must match `did:<lowercase-method>` with letters or digits in the
method. It is included before signing normal identity, asset and wallet-backup
creates. The deterministic seed-bank create operation remains unprefixed to
match the reference. Ephemeral challenges and responses default to Hyperswarm
even when the normal default registry differs. Set their `registry` option
explicitly to override it.
