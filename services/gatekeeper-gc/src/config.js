import dotenv from 'dotenv';

dotenv.config();

const config = {
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
};

export default config;
