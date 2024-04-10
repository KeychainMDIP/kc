---
title: Working with Wallets
sidebar_label: Wallets
slug: wallets
---

> [!WARNING]
> The Keychain CLI wallet is only to be used for experimental and development purposes.
>
> The Keychain CLI wallet is not encrypted and is stored on the local user's file system. Future MDIP wallets will implement additional capabilities (ex: SIWYS). 3rd party wallet developers will also be invited to create MDIP-compatible user wallet implementations.

## What is a Wallet?

The wallet contains a user's private data, including secret keys and associated DIDs. The Keychain-CLI wallet also includes a user's locally named alias for each identity DID.

## Creating a Wallet

Creating a wallet generates a unique seed that is used to derive a hierarchical-deterministic key-pair. This key-pair will be used to generate new unique key-pairs for each future DID generated using this wallet:

> [!NOTE]
> `kc create-wallet` does nothing when you already have a wallet, like the one created by `create-id`.

```json
$ kc create-wallet
{
    "seed": {
        "mnemonic": "P6f40acil4qA1oIHhoK_qNfBPjvdiTn8djxLtcIGMmu5ojQ0g-fAGLLn33Ix5TavvQTzvc6kXax509bQBZZiXjb7ibTToGyUn0oPeBvSV0RcvHOSXWRmATqIqd7dpQrdXqWAwVuxeQ3vy95e2NU",
        "hdkey": {
            "xpriv": "xprv9s21ZrQH143K2x2kGfQ7tgaVHZYQkQVQKbuHgQ4wG7qjfsBoMQD35Ly6rupdEDED1ZBWKtRGWnjwcf9Wxbyvwn4idCPe1kayCrBoLAp8Hvb",
            "xpub": "xpub661MyMwAqRbcFS7DNgw8FpXDqbNu9sDFgpptUnUYpTNiYfWwtwXHd9HaiD1pEfLtMGVBKpCR9D6Vtriqkv7co4W72stnzpLdxPRmuLWJUHS"
        }
    },
    "counter": 0,
    "ids": {}
}
```

Use the command `show-wallet` to view the contents of your wallet; initially, the wallet is empty, but we will see private content added to the wallet as we create MDIP identities and operations:

```json
$ kc show-wallet
{
    "seed": {
        "mnemonic": "BeSI1tnY5TtWweCdEHESV98MXc8CUCu0pFNZ1tLR-0XaP9PvtCcbcUrGfwwIy4qakOkL0hT88xl4Ko3SXbL3U6pEBY4rcROqEwnUuKUN2z9Dx4nKGNz29SDy1GaLV14NbYc1AEa01TEULJr1xzD5",
        "hdkey": {
            "xpriv": "xprv9s21ZrQH143K3MtcqnFrvMQKXVjV37BpYtZo47Vpy9xt44godPRrhcHgrejDPhBCnBk2K8z6CRzPGMDmeDmQGeuDsFwkmE14mrTEv4R33xy",
            "xpub": "xpub661MyMwAqRbcFqy5wonsHVM45XZySZufv7VPrVuSXVVrvs1xAvk7FQcAhxLja5tXXhAv3nPqqftr3E7TmfbUKRXohhHb53N7AiN1iQvwa8p"
        }
    },
    "counter": 0,
    "ids": {}
}
```

## Backing Up and Recovering a Wallet

To recover a wallet from a backup, you need two pieces of information:
- the seed phrase, aka mnemonic,
- the backup DID.

The mnemonic consists of 12 short words (BIP-39) that are used to generate the wallet's private keys:

```sh
$ kc show-mnemonic
know soon mind pen polar pulse patient salmon wage friend equip rotate
```

Creating a wallet backup encrypts the current state of a user wallet content in a DID Document:

```sh 
$ kc backup-wallet
did:mdip:test:z3v8Auairrc7XjSdoA1QvuytZXmGdmjcaFsPb2xKjM6TzowPKRn
```

If you lose the wallet file, you can regenerate the private keys from the mnemonic:

```json
$ kc import-wallet "know soon mind pen polar pulse patient salmon wage friend equip rotate"
{
    "seed": {
        "mnemonic": "8PnD0nzyjd9TphttasCFXg_HNDntYdQlx_JHG6Y8K-U7nZUmkxeB4BLYv8xA9af-r6OChSul1Lp6gRPve7qnU_pOVTOE9c7qew-X7Nv_Vd6by-3IxI03ryHkgNjNTOxHlA6iae0D9wA6sFak",
        "hdkey": {
            "xpriv": "xprv9s21ZrQH143K4Yd3NBDr5kALF4foaGBbiocmBv9UuMeet9urHgi1LKaB51ud1SrRtfxhtbRTxjjTQMQei1BewYnBVnu3Wp5G13Ab768K7qF",
            "xpub": "xpub661MyMwAqRbcH2hWUCkrSt74o6WHyiuT62YMzJZ6ThBdkxEzqE2Ft7tevKxzKH4xLdXpUqd32whgcTE3TJTmCgJYqoXvXn6sdaEsWAUCBbZ"
        }
    },
    "counter": 0,
    "ids": {}
}
```

Once a wallet's keys are recreated from the mnemonic, you can recover its contents from a backup DID generated using the backup process above:

```json
$ kc recover-wallet did:mdip:z3v8AuaXcTg74E4nWXDkX3wtZXjGjvp55z7QYixWSUHyG89qFTy
{
    "seed": {
        "mnemonic": "P6f40acil4qA1oIHhoK_qNfBPjvdiTn8djxLtcIGMmu5ojQ0g-fAGLLn33Ix5TavvQTzvc6kXax509bQBZZiXjb7ibTToGyUn0oPeBvSV0RcvHOSXWRmATqIqd7dpQrdXqWAwVuxeQ3vy95e2NU",
        "hdkey": {
            "xpriv": "xprv9s21ZrQH143K2x2kGfQ7tgaVHZYQkQVQKbuHgQ4wG7qjfsBoMQD35Ly6rupdEDED1ZBWKtRGWnjwcf9Wxbyvwn4idCPe1kayCrBoLAp8Hvb",
            "xpub": "xpub661MyMwAqRbcFS7DNgw8FpXDqbNu9sDFgpptUnUYpTNiYfWwtwXHd9HaiD1pEfLtMGVBKpCR9D6Vtriqkv7co4W72stnzpLdxPRmuLWJUHS"
        }
    },
    "counter": 1,
    "ids": {
        "extropy": {
            "did": "did:mdip:test:z3v8AuaiyHqG3KMpcoBoqvUpMrtCsGsu8iPU1oTEfcsUNxtGyt4",
            "account": 0,
            "index": 0
        }
    },
    "current": "extropy"
}
```

`recover-wallet` does not overwrite the existing wallet, it only prints the contents of the backup. The output should be redirected to a temporary `wallet.json` file, which can then be copied over the existing wallet in the `./data` folder.

Do not redirect or pipe the output directly to the existing `wallet.json` file, which will cause an error.