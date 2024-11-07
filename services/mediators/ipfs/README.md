# MDIP IPFS mediator

The IPFS mediator exports all DIDs from the gatekeeper and saves the operations to IPFS for posterity if the DID is not ephemeral and not local.

## Environment variables

| variable              | default                | description                   |
| --------------------- | ---------------------- | ----------------------------- |
| `KC_GATEKEEPER_URL`   | http://localhost:4224  | MDIP gatekeeper service URL   |
| `KC_IPFS_INTERVAL`    |  60 | Time (minutes) between import loops              |
| `KC_IPFS_BATCH_SIZE`  | 100 | Number of DIDs to export from gatekeeper at once |
| `KC_IPFS_CONCURRENCY` |  10 | Number of concurrent saves to IPFS               |
