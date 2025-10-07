---
title: Working with DIDs
sidebar_label: DIDs
slug: dids
---

## What is a DID

A Decentralized Identifier (DID) is an identifier that enables verifiable, decentralized digital identity. DIDs are designed to be decentralized, not requiring a specific identity provider or certificate authority. Developers may think of a DID as a secure pointer. Only the owner of the DID can change the data (DID documents) that it references. For more detailed information, see the W3C's [documentation](https://www.w3.org/TR/did-core/).

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
