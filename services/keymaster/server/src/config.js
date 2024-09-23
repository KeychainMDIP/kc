import dotenv from 'dotenv';

dotenv.config();

const config = {
    debug: process.env.KC_DEBUG ? process.env.KC_DEBUG === 'true' : false,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    keymasterPort: process.env.KC_KEYMASTER_PORT ? parseInt(process.env.KC_KEYMASTER_PORT) : 4226,
};

export default config;
