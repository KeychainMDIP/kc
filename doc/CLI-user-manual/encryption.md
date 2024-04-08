---
title: Working with Encryption
sidebar_label: Encryption
sidebar_position: 90
---

## What is encryption?

Encryption is a way to scramble data so that only authorized parties can unscramble it. All data communicated between peers is encrypted such that only the specific agents DIDs involved in the MDIP operation can unscramble it. Each agent DID has its own unique encryption key-pairs derived from the wallet's HD keys.

## Encrypting a file

The MDIP CLI can be used to encrypt a file so that it only can be decrypted by the user controlling a specific agent DID keys:

```sh
$ echo 'this is a secret message' > tmp/secret.txt
$ kc encrypt-file tmp/secret.txt david
did:mdip:z3v8AuadZVYKXq9oyoWmCgqGREsvMxCKDWxwLHNw3tHpfDyrNr3
```

The DID returned by the `encrypt-file` function can only be decrypted by the user controlling "david"'s agent DID keys:

```json
$ kc resolve-did did:mdip:z3v8AuadZVYKXq9oyoWmCgqGREsvMxCKDWxwLHNw3tHpfDyrNr3
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:z3v8AuacNPvBNSN8o1LgJxSD9jZVQBkre8BfHdrPgSugb7zuhqs",
        "controller": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
    },
    "didDocumentMetadata": {
        "created": "2024-03-14T19:39:55.374Z",
        "mdip": {
            "registry": "hyperswarm",
            "type": "asset",
            "version": 1
        },
        "data": {
            "cipher_hash": "b618bf73a5a421ff1ab89cb0a6dd76d296915f8b17f8f899bdbc42ee68906cd6",
            "cipher_receiver": "UsCHFkoWeKbmnPC6rL5K55O2zewCehy9WHGFOuxE_nYZrIpxwn4biSbkqhMO_7iFRWFM7Kv_R78SQOO_GROpF_0ttlQYOg",
            "cipher_sender": "fIhBsmICMqN-2nW2FQ2fk-2-DrvQ0EfPyGRa6YUoEywDJdzEtyAW4PBiYnwrgomA0oC5Ox5SeTtCon0ps7baqvHDFDr3aw",
            "created": "2024-03-14T19:39:55.374Z",
            "sender": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
        }
    }
}
```

## Encrypting a message

The MDIP CLI can be used to encrypt a message that can only be decrypted by the targeted DID:

```sh
$ kc encrypt-msg 'this is another secret message' david
did:mdip:z3v8AuacNPvBNSN8o1LgJxSD9jZVQBkre8BfHdrPgSugb7zuhqs
```

## Decrypting a message or a file

Recipients of MDIP encrypted messages or files can use the command below to decrypt the received content:

```sh
$ kc decrypt-did did:mdip:z3v8AuacNPvBNSN8o1LgJxSD9jZVQBkre8BfHdrPgSugb7zuhqs
this is another secret message
```

## Decrypting JSON from a VC

Some MDIP documents such as VCs are encrypted JSON. This command  combines decrypting with parsing as JSON:

```json
$ kc decrypt-json charlie-homepage
{
    "@context": [
        "https://www.w3.org/ns/credentials/v2",
        "https://www.w3.org/ns/credentials/examples/v2"
    ],
    "type": [
        "VerifiableCredential",
        "did:mdip:z3v8AuahM2jN3QRaQ5ZWTmzje9HoNdikuAyNjsGfunGfLCGj87J"
    ],
    "issuer": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj",
    "validFrom": "2024-03-13T20:18:13.290Z",
    "validUntil": null,
    "credentialSubject": {
        "id": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
    },
    "credential": {
        "account": "https://charliehebdo.fr/",
        "service": "homepage"
    },
    "signature": {
        "signer": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj",
        "signed": "2024-03-13T21:01:15.922Z",
        "hash": "da5837c59a2a30a0235668ba8d472dcfc10221a0f01d1d2c9e265ff13436e036",
        "value": "861af32e15e961853b1e84543635249a5f89f22f9360293c05be3a84b53724a934d4e5fc7c6901f503e3df72cb653efa76e8f565dca5c07c7fc9437c95d4355f"
    }
}
```

Only the MDIP agent DID user with the necessary wallet key-pairs can decrypt the VC "charlie-homepage". Anyone else on the network only sees encrypted content:

```json
$ kc resolve-did did:mdip:z3v8AuaamvoV6JnvnhJk3E1npohd3jxThPSXFAzZZ4WwzMrirbq
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:z3v8AuaamvoV6JnvnhJk3E1npohd3jxThPSXFAzZZ4WwzMrirbq",
        "controller": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
    },
    "didDocumentMetadata": {
        "created": "2024-03-13T21:01:16.102Z",
        "mdip": {
            "registry": "hyperswarm",
            "type": "asset",
            "version": 1
        },
        "data": {
            "cipher_hash": "cb98be9a0f06160ccdff4d35bf00971944b5a27db3e6974b0301cd26018588c1",
            "cipher_receiver": "AG_uM(...)UyV8",
            "cipher_sender": "wcV2W(...)enfc",
            "created": "2024-03-13T21:01:16.100Z",
            "sender": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj"
        }
    }
}
```
