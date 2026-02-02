# MDIP Hyperswarm mediator

The Hyperswarm mediator is responsible for distributing unconfirmed MDIP operations to the network and for organizing an IPFS peer network for file-sharing.

When a node gets a new connection, it sends the connection a `sync` message and the connection replies with a series of `batch` messages containing all the operations in the connection's DID database. The nodes imports these operations into its Gatekeeper. The Gatekeeper will add any new operations it hasn't seen before, merge any operations it has already seen, and reject invalid operations.

While running the mediator will poll the Gatekeeper's hyperswarm queue for new operations, and relay them to all of its connections with a `queue` message.
When a node receives a `queue` message it will import the operations like during a `batch` but also relay the message to all of its connections, distributing the new operations with a "gossip protocol".

## Environment variables

| variable                  | default                | description                   |
| ------------------------- | ---------------------- | ----------------------------- |
| `KC_GATEKEEPER_URL`       | http://localhost:4224  | MDIP gatekeeper service URL   |
| `KC_KEYMASTER_URL`        | http://localhost:4226  | MDIP keymaster service URL    |
| `KC_IPFS_URL`             | http://localhost:5001/api/v0  | IPFS RPC URL           |
| `KC_IPFS_ENABLE`          | true                   | Enable IPFS + Keymaster peering integration |
| `KC_NODE_ID       `       | (no default)           | Keymaster node agent name     |
| `KC_NODE_NAME`            | anon                   | Human-readable name for the node |
| `KC_MDIP_PROTOCOL`        | /MDIP/v1.0-public      | MDIP network topic to join    |
| `KC_HYPR_EXPORT_INTERVAL` |  2                     | Seconds between export cycles |

## IPFS disabled mode

Set `KC_IPFS_ENABLE=false` to run the mediator without IPFS or Keymaster integration. In this mode:
- operations still sync and relay over Hyperswarm (batch/queue/sync/ping)
- IPFS peering is disabled and node IPFS info is not published
- `KC_NODE_ID` is not required because Keymaster is not used
