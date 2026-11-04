---
title: Working with Wallets
sidebar_label: Wallets
slug: wallets
---

## What is a Wallet?

The wallet contains a user's private data, including secret keys and associated DIDs. The Keychain-CLI wallet also includes a user's locally named alias for each identity DID.

## Creating a Wallet

Creating a wallet generates a unique seed that is used to derive a hierarchical-deterministic key-pair. This key-pair will be used to generate new unique key-pairs for each future DID generated using this wallet:

> [!NOTE]
> `kc create-wallet` does nothing when you already have a wallet, like the one created by `create-id`.

```console
$ kc create-wallet
{
    "version": 1,
    "seed": {
        "mnemonicEnc": {
            "salt": "...",
            "iv": "...",
            "data": "..."
        }
    },
    "counter": 0,
    "ids": {}
}
```

Use the command `show-wallet` to view the contents of your wallet. Initially, the wallet is empty, but we will see private content added to the wallet as we create MDIP identities and operations:

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
    "counter": 0,
    "ids": {}
}
```

## Backing Up and Recovering a Wallet

To recover the latest DID backup, you need the seed phrase, also called the mnemonic. Keymaster derives a seed-bank DID from that phrase and follows the seed bank's link to the latest wallet backup. Keep the backup DID returned below as a record of the backup, even though `recover-wallet-did` does not require it as an argument.

The mnemonic consists of 12 short words (BIP-39) that are used to generate the wallet's private keys:

```sh
$ kc show-mnemonic
know soon mind pen polar pulse patient salmon wage friend equip rotate
```

Creating a wallet backup encrypts the current state of a user wallet content in a DID Document:

```sh 
$ kc backup-wallet-did
did:test:z3v8Auairrc7XjSdoA1QvuytZXmGdmjcaFsPb2xKjM6TzowPKRn
```

If you lose the wallet file, you can regenerate the private keys from the mnemonic:

```console
$ kc import-wallet "know soon mind pen polar pulse patient salmon wage friend equip rotate"
{
    "version": 1,
    "seed": {
        "mnemonicEnc": {
            "salt": "...",
            "iv": "...",
            "data": "..."
        }
    },
    "counter": 0,
    "ids": {}
}
```

Once the wallet's keys are recreated from the mnemonic, recover its contents from the latest backup linked by the seed bank:

```console
$ kc recover-wallet-did
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
        "extropy": {
            "did": "did:test:z3v8AuaiyHqG3KMpcoBoqvUpMrtCsGsu8iPU1oTEfcsUNxtGyt4",
            "account": 0,
            "index": 0
        }
    },
    "current": "extropy"
}
```

On success, `recover-wallet-did` replaces the Keymaster service's current wallet and prints the recovered contents. Back up any wallet state that must be preserved before running it.
