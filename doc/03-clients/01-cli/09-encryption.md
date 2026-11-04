---
title: Working with Encryption
sidebar_label: Encryption
slug: encryption
---

## What is encryption?

Encryption scrambles data so only authorized parties can read it. Keymaster creates encrypted asset DIDs that the intended recipient can decrypt. By default, it also stores a sender-encrypted copy so the sender can read the asset later.

## Encrypting a file

Encrypt a text file for an agent DID or a local alias:

```sh
$ echo 'this is a secret message' > tmp/secret.txt
$ kc encrypt-file tmp/secret.txt bob
did:test:z3v8AuadZVYKXq9oyoWmCgqGREsvMxCKDWxwLHNw3tHpfDyrNr3
```

Resolving the returned DID exposes only the encrypted asset:

```console
$ kc resolve-did did:test:z3v8AuadZVYKXq9oyoWmCgqGREsvMxCKDWxwLHNw3tHpfDyrNr3
{
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:test:z3v8AuacNPvBNSN8o1LgJxSD9jZVQBkre8BfHdrPgSugb7zuhqs",
        "controller": "did:test:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
    },
    "didDocumentMetadata": {
        "created": "2024-03-14T19:39:55.374Z",
        "canonicalId": "did:test:z3v8AuadZVYKXq9oyoWmCgqGREsvMxCKDWxwLHNw3tHpfDyrNr3",
        "versionId": "z3v8AuadZVYKXq9oyoWmCgqGREsvMxCKDWxwLHNw3tHpfDyrNr3",
        "version": "1",
        "confirmed": true
    },
    "didDocumentData": {
        "encrypted": {
            "cipher_hash": null,
            "cipher_receiver": "UsCHFkoWeKbmnPC6rL5K55O2zewCehy9WHGFOuxE_nYZrIpxwn4biSbkqhMO_7iFRWFM7Kv_R78SQOO_GROpF_0ttlQYOg",
            "cipher_sender": "fIhBsmICMqN-2nW2FQ2fk-2-DrvQ0EfPyGRa6YUoEywDJdzEtyAW4PBiYnwrgomA0oC5Ox5SeTtCon0ps7baqvHDFDr3aw",
            "created": "2024-03-14T19:39:55.374Z",
            "sender": "did:test:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
        }
    },
    "mdip": {
        "registry": "hyperswarm",
        "type": "asset",
        "version": 1,
        "prefix": "did:test"
    },
    "didResolutionMetadata": {
        "retrieved": "2024-03-14T19:40:01.000Z"
    }
}
```

## Encrypting a message

Messages use the same encrypted-asset format:

```sh
$ kc encrypt-message 'this is another secret message' bob
did:test:z3v8AuacNPvBNSN8o1LgJxSD9jZVQBkre8BfHdrPgSugb7zuhqs
```

## Decrypting a message or file

The intended recipient, or the sender when a sender copy was stored, can decrypt the asset:

```sh
$ kc decrypt-did did:test:z3v8AuacNPvBNSN8o1LgJxSD9jZVQBkre8BfHdrPgSugb7zuhqs
this is another secret message
```

## Decrypting JSON

Use `decrypt-json` when the plaintext is JSON, such as a verifiable credential:

```console
$ kc decrypt-json charlie-homepage
{
    "@context": [
        "https://www.w3.org/ns/credentials/v2",
        "https://www.w3.org/ns/credentials/examples/v2"
    ],
    "type": [
        "VerifiableCredential",
        "did:test:z3v8AuahM2jN3QRaQ5ZWTmzje9HoNdikuAyNjsGfunGfLCGj87J"
    ],
    "issuer": "did:test:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj",
    "validFrom": "2024-03-13T20:18:13.290Z",
    "validUntil": null,
    "credentialSubject": {
        "id": "did:test:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
    },
    "credential": {
        "account": "https://charliehebdo.fr/",
        "service": "homepage"
    },
    "signature": {
        "signer": "did:test:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj",
        "signed": "2024-03-13T21:01:15.922Z",
        "hash": "da5837c59a2a30a0235668ba8d472dcfc10221a0f01d1d2c9e265ff13436e036",
        "value": "861af32e15e961853b1e84543635249a5f89f22f9360293c05be3a84b53724a934d4e5fc7c6901f503e3df72cb653efa76e8f565dca5c07c7fc9437c95d4355f"
    }
}
```

Anyone without the required wallet keys sees only the encrypted asset returned by `resolve-did`.
