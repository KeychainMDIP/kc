# MDIP Gatekeeper REST API server

The Gatekeeper service is responsible for guarding the integrity of the local DID database.
Every DID has an associated sequence of operations, starting with a create operation.
The Gatekeeper ensures that only operations with valid signatures are added to the DID database so that it can resolve the correct documents for a given DID.

Operations come from Keymaster clients such as end-user wallets and network mediators such as the Hyperswarm mediator (used to distribute operations between nodes) and Bitcoin mediator (used to impose an objective order on operations for network consensus).

## Environment variables

| variable                        | default                | description                   |
| ------------------------------- | ---------------------- | ----------------------------- |
| `KC_GATEKEEPER_PORT`            | 4224  | Service port                                   |
| `KC_GATEKEEPER_DB`              | redis | DID database adapter, must be `redis`, `json`, `mongodb`, or `sqlite` |
| `KC_GATEKEEPER_DID_PREFIX`      | did:test | Default prefix assigned to DIDs created     |
| `KC_GATEKEEPER_GC_INTERVAL`     |  15 | The number of minutes between garbage collection cycles |
| `KC_GATEKEEPER_STATUS_INTERVAL` |  5 | The number of minutes between logging status updates |
