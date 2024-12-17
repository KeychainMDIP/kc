import dotenv from 'dotenv';

dotenv.config();

const config = {
    debug: process.env.KC_DEBUG ? process.env.KC_DEBUG === 'true' : false,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    nodeName: process.env.KC_NODE_NAME || 'anon',
    protocol: process.env.KC_MDIP_PROTOCOL || '/MDIP/v24.11.19',
};

export default config;
