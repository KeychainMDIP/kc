import dotenv from 'dotenv';

dotenv.config();

const config = {
    port: process.env.KC_GATEKEEPER_PORT ? parseInt(process.env.KC_GATEKEEPER_PORT) : 4224,
    db: process.env.KC_GATEKEEPER_DB || 'redis',
    registries: process.env.KC_GATEKEEPER_REGISTRIES,
    verifyDb: process.env.KC_GATEKEEPER_VERIFY_DB ? process.env.KC_GATEKEEPER_VERIFY_DB === 'true' : true,
};

export default config;
