import dotenv from 'dotenv';

dotenv.config();

const config = {
    port: process.env.KC_GATEKEEPER_PORT ? parseInt(process.env.KC_GATEKEEPER_PORT) : 4224,
    db: process.env.KC_GATEKEEPER_DB || 'redis',
    registries: process.env.KC_GATEKEEPER_REGISTRIES,
    gcInterval: process.env.KC_GATEKEEPER_GC_INTERVAL ? parseInt(process.env.KC_GATEKEEPER_GC_INTERVAL) : 15,
};

export default config;
