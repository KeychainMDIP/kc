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

## Wallet formats

Wallet storage uses v1, which encrypts the mnemonic using the passphrase and
encrypts the remaining wallet data separately. Java also imports the reference
implementation's v0 wallet format through the crypto HD JSON restoration API.

Unknown wallet and identity properties are preserved at their original JSON
locations through loading, mutation, saving and encrypted export. `extras`
objects stay nested. Metadata for features Java does not implement is retained
as opaque data.

Wallet payloads require a nonnegative integer counter and an identity map.
Each identity requires a nonempty DID string and nonnegative integer account
and key indexes. Java rejects missing values, numeric strings, fractional
numbers and values above 2,147,483,647 instead of coercing or wrapping them.
This upper bound reflects Java's integer and HD-derivation limits.
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

Wallet cleanup removes malformed DID strings and references to conclusively
deactivated DIDs. Resolution failures, including not-found responses, abort the
whole cleanup without saving partial removals. Removing the selected identity
selects a remaining identity, or clears the selection when none remain.

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
Issuance and response creation ignore inherited `name` and `controller`
options. Their assets stay controlled by the issuer or responder. Generic asset
and encryption methods support explicit controller selection.
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

## Assets, groups and schemas

`resolveAsset(did, options)` forwards historical version, time and confirmation
options to DID resolution. Resolution failures propagate. Missing asset data,
missing controllers and deactivated assets still return an empty object.
Asset updates use a shallow merge and retain explicit null values.

Group membership edits retain the version originally read. A rejected update
throws and the caller can try again. Edits preserve unrelated asset and group
properties, including the original flat layout of legacy groups. Membership
traversal stops cycles and checks later branches without a depth limit.

Schema templates resolve aliases before setting `$schema`. Listing names with
identity names included returns a separate map without changing the wallet.

## Credential validation

The credential validator requires the v2 base context first, supported HTTP(S)
string contexts, the `VerifiableCredential` type, valid issuer and subject DIDs,
and the reference signature structure. Inline JSON-LD context objects are not
supported. URL checks retain the reference's portable limitation around IPv6,
Unicode hostnames and complete host validation.

Issuance and updates validate the newly signed credential before publishing.
Updates require the initiating issuer and replace the previous signature.
Acceptance requires the holder as subject and a valid signature from the stated
issuer. Credential reads, issued lists and publication share the same structural
validator.

Missing or null validity bounds remain supported. Present dates require an
explicit timezone and a valid Gregorian date, with the reference's support for
fractional seconds and `24:00:00`. The signed validity period must be ordered.
Selection and verification use an inclusive start and exclusive expiry against
one millisecond clock snapshot per response workflow. Fractional boundaries
retain their meaning even below millisecond precision.

Acceptance does not require the credential to be current. A valid expired or
future-dated credential can remain held, while selection and verification skip
it outside its validity period. Invalid candidates are skipped without deleting
them, allowing a later valid alternative to satisfy the challenge.

Challenge selection uses `type[1]` as the schema. An absent or empty issuer list
is unrestricted. Optional schema fields can be omitted when issuing a
credential. Presentations carry the complete signed credential and do not
provide field-level selective disclosure.

## Responses and challenge receipts

Verification authenticates the response controller and encrypted sender, requires
that the selected verifier owns the live challenge, and binds each credential's
subject to the responder. It decrypts the same outer response version it checks.
Presentations must reference live encrypted credentials, have matching declared
hashes and match a SHA-256 hash of the exact decrypted plaintext. Issuer
signatures, structure, validity, schemas and issuer restrictions are checked.
Distinct presentations are assigned to individual requirements without depending
on their order. Repeating one presentation does not satisfy multiple requirements.
Client-supplied counters and match flags cannot authorize a response.

Responses contain a random `responseNonce`. As in the reference,
`verifyResponse(responseDid)` publishes challenge receipts when verification
succeeds. To verify without writing, set `CreateResponseOptions.publish = false`.
A null options argument uses the defaults. Response creation ignores `publish`.

Each public receipt contains only its version, attester DID, schema DID, requester
DID and a commitment computed as `hashJSON({ responseDid, responseNonce })`.
It contains no private credential claims, holder DID, response DID or nonce.
The initiating requester controls the receipt even if the selected identity
changes during verification. Receipts use the normal default registry and have
no expiry unless explicitly configured.

`publishChallengeReceipts(responseDid, options)` supports retries, delay, registry,
expiration and a name for a single receipt. `PublishChallengeReceiptOptions`
can reuse a trusted `verifyResponse()` result through its `verification` field.
Do not populate that field from unverified external input. Without it, the
response is verified again with publication disabled.

A legacy response without a nonce can still verify with `publish = false`, but
cannot publish receipts. This also applies to empty challenges, which otherwise
succeed without writing any receipts. Publication failures propagate. Multiple
receipt writes are separate operations, so a later failure does not undo earlier
receipts. Repeated publication is not guaranteed to be idempotent.

## Deployment options

Use `KeymasterOptions` to configure
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
