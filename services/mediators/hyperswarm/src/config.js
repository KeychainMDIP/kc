import dotenv from 'dotenv';

dotenv.config();

const config = {
    debug: process.env.KC_DEBUG ? process.env.KC_DEBUG === 'true' : false,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    keymasterURL: process.env.KC_KEYMASTER_URL || 'http://localhost:4226',
    ipfsURL: process.env.KC_IPFS_URL || 'http://localhost:5001/api/v0',
    ipfsEnabled: process.env.KC_IPFS_ENABLE ? process.env.KC_IPFS_ENABLE.toLowerCase() !== 'false' : true,
    nodeID: process.env.KC_NODE_ID || '',
    nodeName: process.env.KC_NODE_NAME || 'anon',
    protocol: process.env.KC_MDIP_PROTOCOL || '/MDIP/v1.0-public',
    exportInterval: process.env.KC_HYPR_EXPORT_INTERVAL ? parseInt(process.env.KC_HYPR_EXPORT_INTERVAL) : 2,
};

export default config;
