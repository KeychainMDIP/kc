import dotenv from 'dotenv';

dotenv.config();

const config = {
    port: process.env.KC_GATEKEEPER_PORT ? parseInt(process.env.KC_GATEKEEPER_PORT) : 4224,
    db: process.env.KC_GATEKEEPER_DB || 'redis',
    didPrefix: process.env.KC_GATEKEEPER_DID_PREFIX || 'did:test',
    registries: process.env.KC_GATEKEEPER_REGISTRIES ? process.env.KC_GATEKEEPER_REGISTRIES.split(',') : undefined,
    gcInterval: process.env.KC_GATEKEEPER_GC_INTERVAL ? parseInt(process.env.KC_GATEKEEPER_GC_INTERVAL) : 15,
    statusInterval: process.env.KC_GATEKEEPER_STATUS_INTERVAL ? parseInt(process.env.KC_GATEKEEPER_STATUS_INTERVAL) : 5,
};

export default config;
