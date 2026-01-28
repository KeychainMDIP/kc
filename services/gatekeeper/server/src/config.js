import dotenv from 'dotenv';

dotenv.config();

const config = {
    port: process.env.KC_GATEKEEPER_PORT ? parseInt(process.env.KC_GATEKEEPER_PORT) : 4224,
    db: process.env.KC_GATEKEEPER_DB || 'redis',
    ipfsURL: process.env.KC_IPFS_URL || 'http://localhost:5001/api/v0',
    ipfsClusterURL: process.env.KC_IPFS_CLUSTER_URL,
    ipfsClusterAuthHeader: process.env.KC_IPFS_CLUSTER_AUTH_HEADER,
    didPrefix: process.env.KC_GATEKEEPER_DID_PREFIX || 'did:test',
    registries: process.env.KC_GATEKEEPER_REGISTRIES ? process.env.KC_GATEKEEPER_REGISTRIES.split(',') : undefined,
    jsonLimit: process.env.KC_GATEKEEPER_JSON_LIMIT || '4mb',
    maxOpBytes: process.env.KC_GATEKEEPER_MAX_OP_BYTES ? parseInt(process.env.KC_GATEKEEPER_MAX_OP_BYTES) : undefined,
    gcInterval: process.env.KC_GATEKEEPER_GC_INTERVAL ? parseInt(process.env.KC_GATEKEEPER_GC_INTERVAL) : 15,
    statusInterval: process.env.KC_GATEKEEPER_STATUS_INTERVAL ? parseInt(process.env.KC_GATEKEEPER_STATUS_INTERVAL) : 5,
};

export default config;
