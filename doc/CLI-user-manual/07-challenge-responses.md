---
title: Working with Challenges and Responses
sidebar_label: Challenges and Responses
slug: challenge-responses
---

## What is a challenge and response?

The VC model enables 3rd party entities to issue a Challenge requesting proof from a VC Holder. The VC Holder may respond (at the holder's discretion) with a Verifiable Presentation providing tamper-proof evidence data in response to the Challenge request.

## Creating a Challenge

The challenge is created from a schema file or from an existing DID pointing to an existing schema credential. To create a challenge from a schema file, use `kc create-challenge`; to create a challenge from an existing credential DID, use `kc create-challenge-cc` instead.

```sh
$ kc create-challenge-cc social-media sm-challenge
did:mdip:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN
```

In the command above, `social-media` is a named alias in Alice's wallet that resolves to the DID of the social-medial credential in examples above. `sm-challenge` is a new named alias in Alice's wallet that contains the DID of the new challenge document:

```json
$ kc resolve-did sm-challenge
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN",
        "controller": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY"
    },
    "didDocumentMetadata": {
        "created": "2024-03-22T18:18:35.413Z"
    },
    "didDocumentData": {
        "credentials": [
            {
                "schema": "did:mdip:test:z3v8AuaeAPf9JMuyYZ1D79D626uUzDQmRPwq4d8oB1Th6ztzAS7"
            }
        ]
    },
    "mdip": {
        "registry": "hyperswarm",
        "type": "asset",
        "version": 1
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
    $ kc add-name sm-challenge did:mdip:test:z3v8AuaaxRxwZCPUnpCc4RoV5CZjeYVJepmJTVeJrpvyyB6LmwN
    ```

    > [!NOTE]
    >If you're testing as both Alice and Bob from a single wallet, you can skip this step.

1. Then the user can create a repsonse:

    ```sh
    $ kc create-response sm-challenge
    did:mdip:test:z3v8AuadZ56m4x2UTpeY3HhSFvFQnrCUyASBYA77vqrqQr9SR99
    ```

The command above mapped the Challenge with previously received VCs and found one matching the request for Bob's twitter account credential. The resulting DID document contains a Verifiable Presentation revealing the twitter account VC data encrypted to the requesting party (Alice).

## Verifying a VP Response

To verify the response received to a challenge, a user simply passes the DID of the VP received from the VC Holder being challenged.

```json
$ kc use-id Alice
OK
kc verify-response did:mdip:test:z3v8AuadZ56m4x2UTpeY3HhSFvFQnrCUyASBYA77vqrqQr9SR99
[
    {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        "type": [
            "VerifiableCredential",
            "did:mdip:test:z3v8AuaeAPf9JMuyYZ1D79D626uUzDQmRPwq4d8oB1Th6ztzAS7"
        ],
        "issuer": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
        "validFrom": "2024-03-22T15:06:24.773Z",
        "validUntil": null,
        "credentialSubject": {
            "id": "did:mdip:test:z3v8AuairhLoGZqf6UDKw7zXyBknTvanvSzFHnLpwy8nwa7WLzk"
        },
        "credential": {
            "account": "https://twitter.com/bob",
            "service": "twitter.com"
        },
        "signature": {
            "signer": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
            "signed": "2024-03-22T18:00:19.405Z",
            "hash": "62f7cb1a31d338d29287f9ce91b4da103391dca88b853ea1b05920c6049ae8ff",
            "value": "37941a42492a431ceaff91c86de55eb0cd3ed98107a3ce19a76d88511b7fe2bc6fcf298c69e431b048ab0786e9624b647e4d03a4c26031c4c6e2b6882223defe"
        }
    }
]
```
