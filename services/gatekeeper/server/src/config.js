import dotenv from 'dotenv';

dotenv.config();

const config = {
    debug: process.env.KC_DEBUG ? process.env.KC_DEBUG === 'true' : false,
    didPrefix: process.env.KC_DID_PREFIX || "did:test",
    gatekeeperVerifyDb: process.env.KC_GATEKEEPER_VERIFY_DB ? process.env.KC_GATEKEEPER_VERIFY_DB === 'true' : true,
    gatekeeperPort: process.env.KC_GATEKEEPER_PORT ? parseInt(process.env.KC_GATEKEEPER_PORT) : 4224,
    gatekeeperDb: process.env.KC_GATEKEEPER_DB || 'json',
    gatekeeperRegistries: process.env.KC_GATEKEEPER_REGISTRIES,
    nodeName: process.env.KC_NODE_NAME || 'anon',
    nodeID: process.env.KC_NODE_ID,
    mongodbUrl: process.env.KC_MONGODB_URL || 'mongodb://localhost:27017',
};

export default config;
