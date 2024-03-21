import dotenv from 'dotenv';

dotenv.config();

const config = {
    gatekeeperPort: process.env.GATEKEEPER_PORT || 4224,
    gatekeeperURL: process.env.GATEKEEPER_URL || 'http://localhost',
};

export default config;
