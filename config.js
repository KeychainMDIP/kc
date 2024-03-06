import dotenv from 'dotenv';

dotenv.config();

const config = {
    gatekeeperURL: process.env.GATEKEEPER_URL || 'http://localhost:3000',
};

export default config;
