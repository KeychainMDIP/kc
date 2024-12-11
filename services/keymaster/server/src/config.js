import dotenv from 'dotenv';

dotenv.config();

const config = {
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    keymasterPort: process.env.KC_KEYMASTER_PORT ? parseInt(process.env.KC_KEYMASTER_PORT) : 4226,
    keymasterPassphrase: process.env.KC_ENCRYPTED_PASSPHRASE,
    walletCache: process.env.KC_WALLET_CACHE ? process.env.KC_WALLET_CACHE === 'true' : false,
};

export default config;
