---
title: What is the DID Manifest?
sidebar_label: DID Manifest
sidebar_position: 60
---

### 

The DID Manifest is a public data container that is returned with the DID document data. Users can chose to publish or reveal any attestation they receive. All information in the manifest is publicly viewable.

Example of `didDocumentData` with a manifest :

```json
{
    "manifest": {
        "did:mdip:test:z3v8Auaf3eZEUqJEu8xu1uUwxK3ZTLLXsfg9U7p6awPzyuD1AAT": {
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
            "credential": null,
            "signature": {
                "signer": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
                "signed": "2024-03-22T18:00:19.405Z",
                "hash": "62f7cb1a31d338d29287f9ce91b4da103391dca88b853ea1b05920c6049ae8ff",
                "value": "37941a42492a431ceaff91c86de55eb0cd3ed98107a3ce19a76d88511b7fe2bc6fcf298c69e431b048ab0786e9624b647e4d03a4c26031c4c6e2b6882223defe"
            }
        }
    }
}
```

### Publishing a Verifiable Credential

Publishing a VC to a DID Manifest will make it known that the DID holder has received a particular Verifiable Credential without revealing the credential's values. In this example, we know that Bob has a social-media attestation, but we do not know the details:

```sh
$ kc add-name bob-twitter did:mdip:test:z3v8Auaf3eZEUqJEu8xu1uUwxK3ZTLLXsfg9U7p6awPzyuD1AAT
OK Saved
```

```json
$ kc publish-credential bob-twitter
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
    "credential": null,
    "signature": {
        "signer": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
        "signed": "2024-03-22T18:00:19.405Z",
        "hash": "62f7cb1a31d338d29287f9ce91b4da103391dca88b853ea1b05920c6049ae8ff",
        "value": "37941a42492a431ceaff91c86de55eb0cd3ed98107a3ce19a76d88511b7fe2bc6fcf298c69e431b048ab0786e9624b647e4d03a4c26031c4c6e2b6882223defe"
    }
}
```

```json
$ kc resolve-id
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:test:z3v8AuairhLoGZqf6UDKw7zXyBknTvanvSzFHnLpwy8nwa7WLzk",
        "verificationMethod": [
            {
                "id": "#key-1",
                "controller": "did:mdip:test:z3v8AuairhLoGZqf6UDKw7zXyBknTvanvSzFHnLpwy8nwa7WLzk",
                "type": "EcdsaSecp256k1VerificationKey2019",
                "publicKeyJwk": {
                    "crv": "secp256k1",
                    "kty": "EC",
                    "x": "IGP1mIaBZPh5QYfvrxxR9JzQWa-hsB4J_bwWwFZjOa4",
                    "y": "wQrOGoP_S5bckp-U8zb2UYxFYM4xLWdIuVZ8c0NRUv4"
                }
            }
        ],
        "authentication": [
            "#key-1"
        ]
    },
    "didDocumentMetadata": {
        "created": "2024-03-22T14:55:27.374Z",
        "updated": "2024-03-22T18:01:00.220Z"
    },
    "didDocumentData": {
        "manifest": {
            "did:mdip:test:z3v8Auaf3eZEUqJEu8xu1uUwxK3ZTLLXsfg9U7p6awPzyuD1AAT": {
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
                "credential": null,
                "signature": {
                    "signer": "did:mdip:test:z3v8AuabRm9DaiakqbwFPgsLd6vSYBQtdj7poQFGYBgsZCfqTvY",
                    "signed": "2024-03-22T18:00:19.405Z",
                    "hash": "62f7cb1a31d338d29287f9ce91b4da103391dca88b853ea1b05920c6049ae8ff",
                    "value": "37941a42492a431ceaff91c86de55eb0cd3ed98107a3ce19a76d88511b7fe2bc6fcf298c69e431b048ab0786e9624b647e4d03a4c26031c4c6e2b6882223defe"
                }
            }
        }
    },
    "mdip": {
        "registry": "hyperswarm",
        "type": "agent",
        "version": 1
    }
}
```

### Revealing a Verifiable Credential

Revealing a VC to a DID Manifest will decrypt and expose the entire VC content to the public:

```json
$ kc reveal-credential bob-twitter
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
```

### Unpublishing a Verifiable Credential

At any time, a VC holder can decide to remove VCs published on their DID Manifest.

```sh
$ kc unpublish-credential bob-twitter
OK
```