---
title: Working with IDs
sidebar_position: 30
sidebar_label: IDs
---

The identity operations below meet the specifications defined by [W3C DID Core](https://www.w3.org/TR/did-core/).

## What is an ID?

An ID (identity) refers to the digital identification of an agent DID stored in a user wallet. The user can create new identities on demand, locally, at no cost and with no need of any networking capabilities. An identity's agent DID can be registered with a supported DID registry.

We see examples of these DIDs throughout this document. An MDIP DID example looks like this:

`did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj`

## Creating an ID

Creating a new agent DID uses the wallet's key-pairs to generate a new DID identifier:

```sh
$ kc create-id Alice
did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY
```

The new DID and associated name are stored the user's private wallet:

```json
$ kc show-wallet
{
    "seed": {
        "mnemonic": "MLPxAgU1ym_v_YR2Q6-nY47L8xxMqbJqG_NzRNBh3_MHcZ4QQA2x3DI4fSAG2g-XHC3M_EGtmqY6NhVpsC9yKysFYQmcqjm7cAknpJajZYCVlVs7hJPRLdOqkpy4eotTVblgZdYsYtcgbU9kmYc",
        "hdkey": {
            "xpriv": "xprv9s21ZrQH143K2x2kGfQ7tgaVHZYQkQVQKbuHgQ4wG7qjfsBoMQD35Ly6rupdEDED1ZBWKtRGWnjwcf9Wxbyvwn4idCPe1kayCrBoLAp8Hvb",
            "xpub": "xpub661MyMwAqRbcFS7DNgw8FpXDqbNu9sDFgpptUnUYpTNiYfWwtwXHd9HaiD1pEfLtMGVBKpCR9D6Vtriqkv7co4W72stnzpLdxPRmuLWJUHS"
        }
    },
    "counter": 1,
    "ids": {
        "Alice": {
            "did": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
            "account": 0,
            "index": 0
        }
    },
    "current": "Alice"
}
```

The new DID can also be registered on any MDIP registry the user chooses.

## Resolve Current Agent ID

Resolving an ID means fetching the documents associated with an ID. The current CLI user's agent documents can be displayed using the command `kc resolve-id` without a DID argument:

```json
$ kc resolve-id
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
        "verificationMethod": [
            {
                "id": "#key-1",
                "controller": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
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
        "created": "2024-03-22T14:48:41.213Z"
    },
    "didDocumentData": {},
    "mdip": {
        "registry": "hyperswarm",
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

After running `backup-id`, note the new `vault` key in the agent document:

```json
$ kc resolve-id
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",

    ...

    "didDocumentData": {
        "vault": "did:mdip:test:z3v8AuafhKoRuEkDTjyoabgPXKx4Yi4cPmPdzUgMNyKxkzYNA6u"
    },
    
    ...

}
```

Note that each wallet and each identity have their own backups. This will allow the user to chose a different MDIP registry (or no registry) with different security or permanence attributes for a particular identity (ie: some DIDs will be more valuable than others to the user).

## Removing an ID

At any time, a user may remove a named DID from their wallet:

```sh
$ kc remove-id Alice
ID Alice removed
```

## Recovering an ID

Recovery of a DID's history using the Vault DID is possible because the Vault data is encrypted with the wallet's keys. The wallet keys are used to decrypt the Vault DID data containing the DID's private history:

```sh
$ kc recover-id did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY
Recovered Alice!
```

## Listing IDs

A user's wallet may contain any number of MDIP agent DID identities:

```sh 
$ kc create-id Bob
did:mdip:test:z3v8AuairhLoGZqf6UDKw7zXyBknTvanvSzFHnLpwy8nwa7WLzk
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

The command `rotate-keys` rotates the keys of the wallet's currently active user id:

```json
$ kc rotate-keys
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
        "verificationMethod": [
            {
                "id": "#key-2",
                "controller": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
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
        "updated": "2024-03-22T14:53:23.565Z"
    },
    "didDocumentData": {
        "vault": "did:mdip:test:z3v8AuafhKoRuEkDTjyoabgPXKx4Yi4cPmPdzUgMNyKxkzYNA6u"
    },
    "mdip": {
        "registry": "hyperswarm",
        "type": "agent",
        "version": 1
    }
}
```