# MDIP Keymaster

Keymaster is a client library for the MDIP.
It manages a wallet with any number of identities.

## Installation

```bash
npm install @mdip/keymaster
```

## Usage

### Library

Construct the library with three dependencies:

- a configured gatekeeper instance
- a wallet database
- a cipher library (@mdip/cipher/node for servers or @mdip/cipher/web for web browsers)

Install the Gatekeeper and cipher packages when using Keymaster as an embedded library:

```bash
npm install @mdip/gatekeeper @mdip/cipher
```

#### Node application

```js
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletJson from '@mdip/keymaster/wallet/json';
import CipherNode from '@mdip/cipher/node';
import Keymaster from '@mdip/keymaster';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});
const wallet = new WalletJson();
const cipher = new CipherNode();
const passphrase = 'SuperSecurePassphrase';
const keymaster = new Keymaster({
    gatekeeper,
    wallet,
    cipher,
    passphrase,
    didPrefix: 'did:test'
});

const newId = await keymaster.createId('Bob');
```

#### Browser wallet

```js
import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletWeb from '@mdip/keymaster/wallet/web';
import CipherWeb from '@mdip/cipher/web';
import Keymaster from '@mdip/keymaster';

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: 'http://gatekeeper-host:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});
const wallet = new WalletWeb();
const cipher = new CipherWeb();
const passphrase = 'SuperSecurePassphrase';
const keymaster = new Keymaster({
    gatekeeper,
    wallet,
    cipher,
    passphrase,
    didPrefix: 'did:test'
});

const newId = await keymaster.createId('Bob');
```

### Client

The KeymasterClient is used to communicate with a keymaster REST API service.

```js
import KeymasterClient from '@mdip/keymaster/client';

const keymaster = new KeymasterClient();
await keymaster.connect({
    url: 'http://keymaster-host:4226',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true
});

const newId = await keymaster.createId('Bob');
```

`KeymasterClient` and `SearchClient` requests time out after 60 seconds by
default. Set `timeoutMs` to use a different positive, finite deadline. Long-running
services can pass an `AbortSignal` as `signal`. Aborting it cancels active
requests and readiness waits.

### Payment-only challenge responses (beta)

An Attestor can create signed Bitcoin payment terms and send them without
disclosing a credential. The same signed packet can later be embedded in the
issued credential and reused by its Subject.

```ts
await keymaster.setCurrentId('Attestor');
const paymentInfo = await keymaster.createPaymentInfo({
    network: 'testnet',
    schema: schemaDid,
    subject: subjectDid,
    outputs: [
        { role: 'subject', address: subjectAddress, amountSats: 1_000 },
        { role: 'attestor', address: attestorAddress, amountSats: 2_000 },
        { role: 'platform', address: platformAddress, amountSats: 500 },
    ],
});

const responseDid = await keymaster.createResponse(challengeDid, {
    paymentOnly: true,
    paymentInfo,
});

await keymaster.setCurrentId('Requester');
const response = await keymaster.verifyResponse(responseDid, { publish: false });

// After payment is observed, issue a credential containing the same packet.
await keymaster.setCurrentId('Attestor');
const credential = await keymaster.bindCredential(schemaDid, subjectDid, {
    credential: { ...claims, paymentInfo },
});
const credentialDid = await keymaster.issueCredential(credential);
```

`createPaymentInfo()` resolves schema and subject names to DIDs, adds the
current payment protocol version and type, validates the terms, and signs them
with the current ID.

A verified payment-only response has no credential presentations, reports
`match: false`, and returns the authenticated responder DID and signed
`paymentInfo`. Keymaster verifies the packet signature and its authorization for
the requested schema. Output `role` values are optional application-defined
labels; the names in the example are not part of the MDIP contract. The
consuming application remains responsible for its recipient policy, Bitcoin
address validation, transaction construction, payment observation, and
comparing the packet with the credential eventually disclosed.

### Wallet cleanup

`fixWallet()` removes malformed DIDs and entries whose resolved DID document is
deactivated. If resolution fails, including a `notFound` result, cleanup stops
without saving any removals. A DID missing from one Gatekeeper may not have
synchronized yet. If cleanup removes the current identity, it selects the first
remaining identity, or clears `current` if none remain.
