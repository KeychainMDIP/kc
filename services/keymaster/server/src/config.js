import dotenv from 'dotenv';

dotenv.config();

const config = {
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    keymasterPort: process.env.KC_KEYMASTER_PORT ? parseInt(process.env.KC_KEYMASTER_PORT) : 4226,
    nodeID: process.env.KC_NODE_ID || '',
    db: process.env.KC_KEYMASTER_DB || 'json',
    keymasterPassphrase: process.env.KC_ENCRYPTED_PASSPHRASE,
    walletCache: process.env.KC_WALLET_CACHE ? process.env.KC_WALLET_CACHE === 'true' : false,
    defaultRegistry: process.env.KC_DEFAULT_REGISTRY
};

export default config;
