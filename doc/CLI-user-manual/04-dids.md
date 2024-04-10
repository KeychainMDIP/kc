---
title: Working with DIDs
sidebar_label: DIDs
slug: dids
---

## What is a DID

A Decentralized Identifier (DID) is a standardized document to define a digital identity. DIDs are designed to be decentralized, not requiring a specific identity provider or certificate authority. For more detailed information, see the W3C's [documentation](https://www.w3.org/TR/did-core/).

## Resolving a DID

Resolving a DID means fetching the documents associated with a DID. The documents are returned in a single JSON object.

This example returns a Credential object that includes a schema in its `didDocumentData`:

```json {14-30}
$ ./kc resolve-did did:mdip:test:z3v8AuaYLYSWZJUa4bSadeoiNA3ps8dWDYtsmJNMDJhbFDjaKaX
{
    "@context": "https://w3id.org/did-resolution/v1",
    "didDocument": {
        "@context": [
            "https://www.w3.org/ns/did/v1"
        ],
        "id": "did:mdip:test:z3v8AuaYLYSWZJUa4bSadeoiNA3ps8dWDYtsmJNMDJhbFDjaKaX",
        "controller": "did:mdip:test:z3v8AuaaBKfwrt2Y7AAbDaGqLNgyn1BDhP7wUFpEMEngmwYwi17"
    },
    "didDocumentMetadata": {
        "created": "2024-03-21T20:26:01.826Z"
    },
    "didDocumentData": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "properties": {
            "account": {
                "format": "uri",
                "type": "string"
            },
            "service": {
                "type": "string"
            }
        },
        "required": [
            "service",
            "account"
        ],
        "type": "object"
    },
    "mdip": {
        "registry": "hyperswarm",
        "type": "asset",
        "version": 1
    }
}
```

## Exporting an DID

For offline and off-network use, a DID can be exported to file so it can be stored or transported offline. The `export-did` command can be used to export any DID, including both agent or asset documents. The resulting output will include the entire history of a DID, including prior versions of keys:

```json
$ kc export-did did:mdip:z3v8AuagbRf9UrW7AQQqHCGejPYafoczuQ5uTuF3mFuc5vEMUkj
[
    {
        "time": "2024-03-13T17:38:54.926Z",
        "ordinal": 0,
        "did": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj",
        "txn": {
            "op": "create",
            "created": "2024-03-13T17:38:54.926Z",
(...) #Lots of DID history goes here...
            "prev": "523f72b65b66cc3a829a1bf6a0ec058aea29af0f8d2f7fdd1938d282abe6efc4",
            "signature": {
                "signer": "did:mdip:z3v8AuagsGQwffFd2oVhkdcTWRBi2ps5FdRAJD4jzEVMszkYBCj",
                "signed": "2024-03-13T18:30:20.353Z",
                "hash": "5a226a2899c579e5d99055a1d1a2f39a41a8ab44a4891e248fb94d8c44f4e67a",
                "value": "9938df3ed8114d4bf1a78d2829d0ee22d17d7ffb0aa9eef46f2fbf386a9ae8a2158d3555c5495e04c9bd45d1ea090758c4ec30e23703988fe3a5780c62da906d"
            }
        }
    }
]
```

## Importing an DID

For offline and off-network use, a DID can be imported from a file so it can be stored on a new node's registry. The `import-did` command will import DIDs exported by the `export-did` command:

```sh
$ kc import-did exported-DID-file.json
1
```
