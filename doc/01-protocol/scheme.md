# MDIP DID Scheme


## Abstract

The MDIP (Multi-Dimensional Identity Protocol) DID method specification conforms to [W3C DID Core](https://www.w3.org/TR/did-core/). For more information about DIDs and DID method specifications, see the [DID Primer](https://w3c-ccg.github.io/did-primer/).

## Introduction

The MDIP DID method (`did:mdip`) is designed to support a P2P identity layer with secure decentralized [verifiable credentials](https://www.w3.org/TR/vc-data-model-2.0/). MDIP DIDs are used for agents (e.g., users, issuers, verifiers, and MDIP nodes) and assets (e.g., verifiable credentials, verifiable presentations, schemas, challenges, and responses).

## MDIP DID Format

MDIP DIDs have the following format:

```
mdip-did        = "did:mdip:" mdip-identifier
mdip-identifier = CID encoded with base58btc
```

Deployments can configure another DID prefix, such as `did:test` for a test network. The signed create operation can carry that prefix in `mdip.prefix`. Otherwise, the receiving Gatekeeper applies its configured fallback.

### Example: MDIP DID

`did:mdip:z3v8AuaYnnFwgRFgkQWnYca2wbvcWN8sa94BfnoJtqbphdTREc6`

## DID Lifecycle

MDIP DIDs are content-addressed. A node canonicalizes the signed create operation, derives its CID, and uses that CID as the DID suffix. The create operation and later updates are recorded as an ordered event history and distributed over Hyperswarm and, where different, through the registry selected at creation, such as a Bitcoin-derived chain.

IPFS integration is optional and is used for content explicitly stored in the CAS. A DID document is generated from its create operation and subsequent ordered events without retrieving data from IPFS.

## DID Creation

A DID is created by submitting a signed create operation to a node. The node validates it, derives the DID, records the create event locally, and queues a non-local operation for Hyperswarm and, when different, its selected registry.

MDIP DIDs support two main types of DID Subject: **agents** and **assets**. Agents have keys and control assets. Assets do not have keys, and are controlled by a single agent (the owner of the asset). The two types have slightly different creation methods.

### Agents

To create an agent DID, the MDIP client must sign and submit a `create` operation to the MDIP node.

1. Generate a new private key
    1. We recommend deriving a new private key from a hierarchical deterministic (HD) wallet (BIP-32).
1. Generate a public key from the private key
1. Convert to JWK (JSON Web Key) format
1. Create an operation object with these fields in any order:
    1. `type`  must be "create"
    1. `mdip` metadata includes:
        1. `version`  number, e.g. 1
        1. `type`  must be "agent"
        1. `registry`  (from a list of valid registries, e.g. `TBTC` or `hyperswarm`)
        1. `prefix` [optional] DID prefix to embed in the new DID
    1. `publicJwk` is the public key in JWK format
    1. `created` time in ISO format
    1. `blockid` [optional] current block ID on registry (if registry is a blockchain)
1. Sign the JSON with the private key corresponding to the public key. This enables the MDIP node to verify that the operation came from the key owner.
1. Submit the operation to the MDIP node. For example, post it to the REST API's `/api/v1/did` endpoint.

Example:
```json
{
    "type": "create",
    "created": "2024-03-21T14:17:00.693Z",
    "mdip": {
        "registry": "hyperswarm",
        "type": "agent",
        "version": 1,
        "prefix": "did:mdip"
    },
    "publicJwk": {
        "crv": "secp256k1",
        "kty": "EC",
        "x": "Mhw_QuIwAqtSC7iGs4a5hTn6o9l3n4e41SVxtwSZHsg",
        "y": "PHqyl-KJ74BGYL19Ou-iQ7M-Adn9zKy9xX4wzVPWkcs"
    },
    "signature": {
        "hash": "5a2b4280bed5adac087afb0a143b3bcf21c9f140937ed1964eb1106b2f5c4bdf",
        "signed": "2024-03-21T14:17:00.703Z",
        "value": "0b087eb5f05cfd3563d56fd1edc2b893b2d27ef096514272f989aabd081d37781a14453e8f36536d391c6539d10f6744b4a06ffbf9c559d9383435e278b71554"
    }
}
```

Upon receiving the operation the MDIP node must:
1. Verify the signature
1. Apply JSON canonicalization scheme to the operation.
1. Derive the operation CID and DID.
1. Record the create event and, for a non-local DID, queue it for Hyperswarm and, when different, the selected registry.

The resulting CID in base58btc encoding is used as the MDIP DID suffix. The operation above corresponds to CID `z3v8AuaWjjt2tN9HHtQf8Au9ARZ25zzjkmWmkfVvYDaoM3xcnUP`, yielding the MDIP DID `did:mdip:z3v8AuaWjjt2tN9HHtQf8Au9ARZ25zzjkmWmkfVvYDaoM3xcnUP`.

### Assets

To create an asset DID, the MDIP client must sign and submit a `create` operation to the MDIP node.

1. Create an operation object with these fields in any order:
    1. `type`  must be "create"
    1. `mdip` metadata includes:
        1. `version`  number, e.g. 1
        1. `type`  must be "asset"
        1. `registry`  (from a list of valid registries, e.g. `TBTC` or `hyperswarm`)
        1. `prefix` [optional] DID prefix to embed in the new DID
    1. `controller` specifies the DID of the owner/controller of the new DID
    1. `data` can contain data in JSON format
    1. `created` time in ISO format
    1. `blockid` [optional] current block ID on registry (if registry is a blockchain)
1. Sign the JSON with the private key of the controller
1. Submit the operation to the MDIP node. For example, post it to the REST API's `/api/v1/did` endpoint.

Example
```json
{
    "type": "create",
    "created": "2024-03-21T18:47:00.655Z",
    "mdip": {
        "version": 1,
        "type": "asset",
        "registry": "hyperswarm",
        "prefix": "did:mdip"
    },
    "controller": "did:mdip:z3v8AuaaBKfwrt2Y7AAbDaGqLNgyn1BDhP7wUFpEMEngmwYwi17",
    "data": {
        "credentials": []
    },
    "signature": {
        "signer": "did:mdip:z3v8AuaaBKfwrt2Y7AAbDaGqLNgyn1BDhP7wUFpEMEngmwYwi17",
        "signed": "2024-03-21T18:47:00.729Z",
        "hash": "3810490d72e7c912d3213d5d96b4f9c184b347038b385aadc568a6624810b0ef",
        "value": "e80a12d81b9be8a63440203dccb90e954d21b91e862b3fe72d0f306877292b9a5f8e00881256132225ab39f2cbe9d47012fb4ac32882ac4bfe3bbb49f80efec4"
    }
}
```

Upon receiving the operation the MDIP node must:
1. Verify the signature is valid for the specified controller.
1. Apply JSON canonicalization scheme to the operation object.
1. Derive the operation CID and DID.
1. Record the create event and, for a non-local DID, queue it for Hyperswarm and, when different, the selected registry.

The operation above corresponds to CID `z3v8AuahaEdEZrY9BGfu4vntYjQECBvDHqCG3mPAfEbn6No7AHh`, yielding the DID `did:mdip:z3v8AuahaEdEZrY9BGfu4vntYjQECBvDHqCG3mPAfEbn6No7AHh`.

## DID Update

A DID update is a change to the document set associated with the DID. To initiate an update, the MDIP client must sign an operation that includes the following fields:

1. Create an operation object with these fields in any order:
    1. `type` must be set to "update"
    1. `did` specifies the DID
    1. `doc` is set to the new version of the document set, which must include:
        1. `didDocument` the main document
        1. `didDocumentMetadata` the document's metadata
        1. `didDocumentData` the document's data
        1. `mdip` the MDIP protocol spec
    1. `previd` the CID of the previous operation
    1. `blockid` [optional] current block ID on registry (if registry is a blockchain)
1. Sign the JSON with the private key of the controller of the DID
1. Submit the operation to the MDIP node. For example, post it to the REST API's `/api/v1/did` endpoint.

The client should fetch the current document set, change it, and submit the complete new version so fields that should not change are preserved.

Example update to rotate keys for an agent DID:
```json
{
    "type": "update",
    "did": "did:mdip:z3v8AuadvRQErtPapNx3ncdUJpPc5dBDGTXXiRxsaH2N8Lj2KzL",
    "doc": {
        "@context": "https://w3id.org/did-resolution/v1",
        "didDocument": {
            "@context": [
                "https://www.w3.org/ns/did/v1"
            ],
            "id": "did:mdip:z3v8AuadvRQErtPapNx3ncdUJpPc5dBDGTXXiRxsaH2N8Lj2KzL",
            "verificationMethod": [
                {
                    "id": "#key-2",
                    "controller": "did:mdip:z3v8AuadvRQErtPapNx3ncdUJpPc5dBDGTXXiRxsaH2N8Lj2KzL",
                    "type": "EcdsaSecp256k1VerificationKey2019",
                    "publicKeyJwk": {
                        "kty": "EC",
                        "crv": "secp256k1",
                        "x": "CkHUpYCLpO-ITepMH8NyR1BinjtC8GEjPZmLbhhvdYQ",
                        "y": "7tbEsQCgPhMx4vgP7anOZEscV0ruXyaEkyKTXaIMniQ"
                    }
                }
            ],
            "authentication": [
                "#key-2"
            ]
        },
        "didDocumentMetadata": {
            "created": "2024-03-25T14:57:20.868Z"
        },
        "didDocumentData": {},
        "mdip": {
            "registry": "hyperswarm",
            "type": "agent",
            "version": 1,
            "prefix": "did:mdip"
        }
    },
    "previd": "z3v8Auaa5U9xP6TRzobvzZE7j6N8nkatxW1UuWiay5xrbAR5D9e",
    "signature": {
        "signer": "did:mdip:z3v8AuadvRQErtPapNx3ncdUJpPc5dBDGTXXiRxsaH2N8Lj2KzL",
        "signed": "2024-03-25T14:57:26.343Z",
        "hash": "575612ed3195eef4e1b7d43b3e40f893d834176321fee8ff6ffe51a79647d912",
        "value": "87571672a51e3558ed9a9d4ef5fcad4dafbf22ee881735e579305b3ebb404a1d0891e3b45c8ad5c11c95e3ae76ca6f2328c87313d58fe80713c0887294d9078a"
    }
}
```

Upon receiving the operation the MDIP node must:
1. Verify the signature is valid for the controller of the DID.
1. Record the operation locally and, for a non-local DID, queue it for Hyperswarm and, when different, the DID's registry.

Bitcoin-derived mediators can queue operations to balance cost and latency. The Satoshi mediator writes a DID for a Hyperswarm batch asset to `OP_RETURN`. The inscription mediator instead writes complete operations to Taproot reveal witnesses and uses `OP_RETURN` only for an MDIP marker. A registry with trivial transaction costs can distribute each operation immediately. MDIP leaves this tradeoff between cost, speed, and security to node operators.

## DID Revocation

Revoking a DID is a special kind of Update that results in the termination of the DID. Revoked DIDs cannot be updated because they have no current controller, therefore they cannot be recovered once revoked. Revoked DIDs can be resolved without error, but resolvers return a document set with `didDocumentMetadata.deactivated` set to `true`, a `didDocument` containing only the DID, and empty `didDocumentData`.

To revoke a DID, the MDIP client must sign and submit a `delete` operation to the MDIP node.

1. Create an operation object with these fields in any order:
    1. `type`  must be "delete"
    1. `did` specifies the DID to be deleted
    1. `previd` the CID of the previous operation
    1. `blockid` [optional] current block ID on registry (if registry is a blockchain)
1. Sign the JSON with the private key of the controller of the DID
1. Submit the operation to the MDIP node. For example, post it to the REST API's `/api/v1/did` endpoint. The older `DELETE /api/v1/did/:did` endpoint is deprecated.


Example deletion operation:
```json
{
    "type": "delete",
    "did": "did:mdip:z3v8AuagQPwk6WhAjauVgkFCBJfHJBVBmNAYEhDNMBEXEmWQrHr",
    "previd": "z3v8AuaWLbUPpU31mCazznLYy6JtTWmgx9QFsDVveDPDU8Na1sJ",
    "signature": {
        "signer": "did:mdip:z3v8Auad6fdVkSZE4khWmMwgTjpoMtv82fiT7c56ivNBdjzeMS2",
        "signed": "2024-02-05T20:00:54.171Z",
        "hash": "ff71d0966ee87d827bf3674cb1511c845e18f010186326b3898f336b30e94662",
        "value": "92f95f431729858c79ec4c10824e5aa996b7ae5277ec5143af43baf55c7c8d2f73931be5be46da0a7795b5c3b773041a91ccc2755857ddfa34758993428e7ad1"
    }
}
```

Upon receiving the operation the MDIP node must:
1. Verify the signature is valid for the controller of the DID.
1. Record the operation locally and, for a non-local DID, queue it for Hyperswarm and, when different, the DID's registry.

After revocation is confirmed on the DID's registry, resolving the DID will result in response like this:
```json
{
    "didDocument": {
        "id": "did:mdip:z3v8AuagQPwk6WhAjauVgkFCBJfHJBVBmNAYEhDNMBEXEmWQrHr"
    },
    "didDocumentMetadata": {
        "created": "2024-03-21T18:47:00.655Z",
        "deactivated": true,
        "deleted": "2024-03-21T18:55:11.530Z",
        "canonicalId": "did:mdip:z3v8AuagQPwk6WhAjauVgkFCBJfHJBVBmNAYEhDNMBEXEmWQrHr",
        "versionId": "z3v8AuaTSeaFJNtXpiSLhiYRW9HBJnaehUhKQFuKsHtGpQa4PMU",
        "version": "2",
        "confirmed": true
    },
    "didDocumentData": {},
    "mdip": {
        "registry": "hyperswarm",
        "type": "asset",
        "version": 1,
        "prefix": "did:mdip"
    },
    "didResolutionMetadata": {
        "retrieved": "2024-03-26T20:01:00.000Z"
    }
}
```

The metadata has `deactivated` set to `true` to conform to the [W3C specification](https://www.w3.org/TR/did-core/#did-document-metadata).

## DID Resolution

Resolution is the operation of responding to a DID with a DID Document. If you think of the DID as a secure reference or pointer, then resolution is equivalent to dereferencing.

The resolver validates the DID, retrieves its ordered events from the local Gatekeeper database, and generates the initial document from the create operation. An agent document contains its public key, while an asset document references its controller and places the asset data in `didDocumentData`.

The resolver then applies update and delete events in order. Resolution can stop at a requested `versionTime` or `versionSequence`. With confirmation enabled, it stops before later events that have not been confirmed by the DID's native registry. With verification enabled, it verifies create, update, and delete signatures and checks `previd` against the preceding operation CID.

Blockchain-backed events can add lower and upper timestamp bounds to the returned version metadata. A DID absent from the local event database returns `notFound`. Resolution does not forward requests to a fallback node.

In pseudo-code:

```
function resolveDid(did, versionTime=now):
    events = retrieve ordered events for did from local database
    if events are empty:
        return notFound
    generate initial document from the create event
    for each later event until versionTime:
        when verification is requested, verify signature and previd
        stop before unconfirmed events when confirmation is requested
        apply update or delete to DID document
    return DID document
```

## DID Recovery

MDIP registries do not escrow private keys. Clients should derive wallet keys from a BIP-39 seed phrase and require users to store that phrase safely.

The seed phrase restores deterministic key material, while encrypted DID backups can restore wallet metadata, identities, and credentials. Backup data must remain encrypted because it is distributed through the same registries as other DID operations.
