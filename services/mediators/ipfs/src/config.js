import dotenv from 'dotenv';

dotenv.config();

const config = {
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    interval: process.env.KC_IPFS_INTERVAL ? parseInt(process.env.KC_IPFS_INTERVAL) : 60,
    batchSize: process.env.KC_IPFS_BATCH_SIZE ? parseInt(process.env.KC_IPFS_BATCH_SIZE) : 100,
    concurrency: process.env.KC_IPFS_CONCURRENCY ? parseInt(process.env.KC_IPFS_CONCURRENCY) : 10,
};

export default config;
