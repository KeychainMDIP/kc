---
title: Working with Challenges and Responses
sidebar_label: Challenges and Responses
slug: challenge-responses
---

## What is a challenge and response?

The VC model enables third parties to issue a Challenge requesting proof from a VC Holder. The VC Holder may respond (at the holder's discretion) with a Verifiable Presentation providing tamper-evident data in response to the Challenge request.

## Creating a Challenge

Use `kc create-challenge` to create a challenge from a JSON challenge object. For the common case of requesting one credential type, `kc create-challenge-cc` accepts the schema DID and builds that object for you.

```sh
$ kc get-name social-media
did:test:z3v8AuaeAPf9JMuyYZ1D79D626uUzDQmRPwq4d8oB1Th6ztzAS7
$ kc create-challenge-cc did:test:z3v8AuaeAPf9JMuyYZ1D79D626uUzDQmRPwq4d8oB1Th6ztzAS7 --name sm-challenge
did:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN
```

In the command above, `social-media` resolves to the schema DID from the earlier examples. `sm-challenge` is a new alias for the challenge DID:

```console
$ kc resolve-did sm-challenge
{
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN",
        "controller": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY"
    },
    "didDocumentMetadata": {
        "created": "2024-03-22T18:18:35.413Z",
        "canonicalId": "did:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN"
    },
    "didDocumentData": {
        "challenge": {
            "credentials": [
                {
                    "schema": "did:test:z3v8AuaeAPf9JMuyYZ1D79D626uUzDQmRPwq4d8oB1Th6ztzAS7"
                }
            ]
        }
    },
    "mdip": {
        "registry": "hyperswarm",
        "prefix": "did:test",
        "type": "asset",
        "version": 1,
        "validUntil": "2024-03-22T19:18:35.413Z"
    }
}
```

## Creating a Verifiable Presentation Response

When presented with a challenge, a user can prepare a Verifiable Presentation of the credentials claims requested in the challenge.

1. The user can first verify that they are using the identity they want to create a Verifiable Presentation for:

    ```sh
    $ kc use-id Bob
    OK
    ```

1. Next, the user can optionally create their own alias to interact with the challenge DID:

    ```sh
    $ kc add-name sm-challenge did:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN
    OK
    ```

    > [!NOTE]
    >If you're testing as both Alice and Bob from a single wallet, you can skip this step.

1. Then the user can create a response:

    ```sh
    $ kc create-response sm-challenge
    did:test:z3v8AuadZ56m4x2UTpeY3HhSFvFQnrCUyASBYA77vqrqQr9SR99
    ```

The command above matched the challenge against Bob's held VCs. The encrypted response links the source VC to a copy encrypted for the requester, Alice.

## Verifying a VP Response

To verify the response received to a challenge, a user passes the DID of the VP received from the VC Holder being challenged. The encrypted response includes its challenge reference.

```console
$ kc use-id Alice
OK
$ kc verify-response did:test:z3v8AuadZ56m4x2UTpeY3HhSFvFQnrCUyASBYA77vqrqQr9SR99
{
    "challenge": "did:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN",
    "credentials": [
        {
            "vc": "did:test:z3v8AuaZAWJuERtD5CwDu2mNpLHjJ6imdNGTwdZpfKY6FK5ASk2",
            "vp": "did:test:z3v8AuacNPvBNSN8o1LgJxSD9jZVQBkre8BfHdrPgSugb7zuhqs"
        }
    ],
    "requested": 1,
    "fulfilled": 1,
    "match": true,
    "responseNonce": "uTn3vMj5VDZscq4pfjA57B3H9Nrr7KwGQeKzDqY3h0Mk",
    "vps": [
    {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        "type": [
            "VerifiableCredential",
            "did:test:z3v8AuaeAPf9JMuyYZ1D79D626uUzDQmRPwq4d8oB1Th6ztzAS7"
        ],
        "issuer": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
        "validFrom": "2024-03-22T15:06:24.773Z",
        "validUntil": null,
        "credentialSubject": {
            "id": "did:test:z3v8AuairhLoGZqf6UDKw7zXyBknTvanvSzFHnLpwy8nwa7WLzk"
        },
        "credential": {
            "account": "https://twitter.com/bob",
            "service": "twitter.com"
        },
        "signature": {
            "signer": "did:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
            "signed": "2024-03-22T18:00:19.405Z",
            "hash": "62f7cb1a31d338d29287f9ce91b4da103391dca88b853ea1b05920c6049ae8ff",
            "value": "37941a42492a431ceaff91c86de55eb0cd3ed98107a3ce19a76d88511b7fe2bc6fcf298c69e431b048ab0786e9624b647e4d03a4c26031c4c6e2b6882223defe"
        }
    }
    ],
    "responder": "did:test:z3v8AuairhLoGZqf6UDKw7zXyBknTvanvSzFHnLpwy8nwa7WLzk"
}
```
