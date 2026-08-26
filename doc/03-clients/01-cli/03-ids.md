---
title: Working with IDs
sidebar_label: IDs
slug: ids
---

The identity operations below meet the specifications defined by [W3C DID Core](https://www.w3.org/TR/did-core/).

## What is an ID?

An ID (identity) is an agent DID stored in a user wallet. Gatekeeper creates the DID immediately in its local database. For a non-local registry, it then queues the signed create operation for distribution.

With the default test prefix, a DID looks like this:

`did:test:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj`

## Creating an ID

Creating a new agent DID uses a wallet-derived key pair to generate a new DID identifier. The registry is selected at creation and cannot be changed later. Omit `--registry` to use `KC_DEFAULT_REGISTRY`:

```sh
$ kc create-id Alice --registry hyperswarm
did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY
```

The new DID and associated name are stored in the user's private wallet:

```console
$ kc show-wallet
{
    "version": 1,
    "seed": {
        "mnemonicEnc": {
            "salt": "...",
            "iv": "...",
            "data": "..."
        }
    },
    "counter": 1,
    "ids": {
        "Alice": {
            "did": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
            "account": 0,
            "index": 0
        }
    },
    "current": "Alice"
}
```

Use another registry only if Gatekeeper is configured to support it. Use `local` for a DID that should not be distributed.

## Resolve Current Agent ID

Resolving an ID means fetching the documents associated with an ID. The current CLI user's agent documents can be displayed using the command `kc resolve-id` without a DID argument:

```console
$ kc resolve-id
{
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
        "verificationMethod": [
            {
                "id": "#key-1",
                "controller": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
                "type": "EcdsaSecp256k1VerificationKey2019",
                "publicKeyJwk": {
                    "crv": "secp256k1",
                    "kty": "EC",
                    "x": "3tJzOiiSFhDIzMcg_YGLtzvBjs5L9DhBvRmUZVEbV5c",
                    "y": "eVUruQfrt1Fx_m2CW7t0KHrRk-JlHzgZLY6LPC3lgjU"
                }
            }
        ],
        "authentication": [
            "#key-1"
        ]
    },
    "didDocumentMetadata": {
        "created": "2024-03-22T14:48:41.213Z",
        "canonicalId": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY"
    },
    "didDocumentData": {},
    "mdip": {
        "registry": "hyperswarm",
        "prefix": "did:test",
        "type": "agent",
        "version": 1
    }
}
```

## Backing up an ID

Backing up an identity is the process of posting an encrypted document DID to the identity's vault. The vault DID document contains the encrypted history of the identity at the time of the backup, enabling recovery of all Verifiable Credentials (VCs) associated with the DID:

```sh
$ kc backup-id
OK
```

After running `backup-id`, note the new `vault` key in this abridged agent document:

```console
$ kc resolve-id
{
    "didDocument": {
        "id": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY"
    },
    "didDocumentData": {
        "vault": "did:test:z3v8AuafhKoRuEkDTjyoabgPXKx4Yi4cPmPdzUgMNyKxkzYNA6u"
    }
}
```

Each wallet and identity has its own backup. An identity backup uses that identity's registry. A `local` identity is not distributed to a network registry.

## Removing an ID

At any time, a user may remove a named DID from their wallet:

```sh
$ kc remove-id Alice
ID Alice removed
```

## Renaming an ID

At any time, a user may rename an ID in their wallet:

```sh
$ kc rename-id Alice Bob
OK
```

## Recovering an ID

Recovery of a DID's history using the Vault DID is possible because the Vault data is encrypted with the wallet's keys. The wallet keys are used to decrypt the Vault DID data containing the DID's private history:

```sh
$ kc recover-id did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY
Alice
```

## Listing IDs

A user's wallet may contain any number of MDIP agent DID identities:

```sh
$ kc create-id Bob
did:test:z3v8AuairhLoGZqf6UDKw7zXyBknTvanvSzFHnLpwy8nwa7WLzk
```

```sh {3}
$ kc list-ids
Alice
Bob  <<< current
```

## Switching IDs

A user can switch between their various MDIP identities:

```sh
kc use-id Alice
OK
```

```sh {2}
$ kc list-ids
Alice  <<< current
Bob
```

## Rotating an ID's Keys

A user can rotate the public keys associated with a particular DID. This is a common privacy and security feature that allows the user to keep the same DID but sign future documents with new keys.

The command `rotate-keys` rotates the keys of the wallet's current ID:

```sh
$ kc rotate-keys
OK
```

Resolve the ID to see the new verification method:

```console
$ kc resolve-id
{
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
        "verificationMethod": [
            {
                "id": "#key-2",
                "controller": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
                "type": "EcdsaSecp256k1VerificationKey2019",
                "publicKeyJwk": {
                    "kty": "EC",
                    "crv": "secp256k1",
                    "x": "e3j21wCPrDSUiY4fQaPYYNLZ-7wcOI6d_WcLy3RTSWc",
                    "y": "9-kZlDiwShHihazR15z9VYEIks9W3PKdt0Cae7FJFA4"
                }
            }
        ],
        "authentication": [
            "#key-2"
        ]
    },
    "didDocumentMetadata": {
        "created": "2024-03-22T14:48:41.213Z",
        "updated": "2024-03-22T14:53:23.565Z",
        "canonicalId": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY"
    },
    "didDocumentData": {
        "vault": "did:test:z3v8AuafhKoRuEkDTjyoabgPXKx4Yi4cPmPdzUgMNyKxkzYNA6u"
    },
    "mdip": {
        "registry": "hyperswarm",
        "prefix": "did:test",
        "type": "agent",
        "version": 1
    }
}
```
