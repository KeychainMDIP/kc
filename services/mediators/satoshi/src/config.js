import dotenv from 'dotenv';

dotenv.config();

const config = {
    nodeID: process.env.KC_NODE_ID,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    chain: process.env.KC_SAT_CHAIN || 'BTC',
    network: process.env.KC_SAT_NETWORK || 'mainnet',
    host: process.env.KC_SAT_HOST || 'localhost',
    port: process.env.KC_SAT_PORT ? parseInt(process.env.KC_SAT_PORT) : 8332,
    wallet: process.env.KC_SAT_WALLET,
    user: process.env.KC_SAT_USER,
    pass: process.env.KC_SAT_PASS,
    importInterval: process.env.KC_SAT_IMPORT_INTERVAL ? parseInt(process.env.KC_SAT_IMPORT_INTERVAL) : 0,
    exportInterval: process.env.KC_SAT_EXPORT_INTERVAL ? parseInt(process.env.KC_SAT_EXPORT_INTERVAL) : 0,
    feeMin: process.env.KC_SAT_FEE_MIN ? parseFloat(process.env.KC_SAT_FEE_MIN) : 0.00002,
    feeMax: process.env.KC_SAT_FEE_MAX ? parseFloat(process.env.KC_SAT_FEE_MAX) : 0.00002,
    feeInc: process.env.KC_SAT_FEE_INC ? parseFloat(process.env.KC_SAT_FEE_INC) : 0.00000,
    startBlock: process.env.KC_SAT_START_BLOCK ? parseInt(process.env.KC_SAT_START_BLOCK) : 0,
    reimport: process.env.KC_SAT_REIMPORT ? (process.env.KC_SAT_REIMPORT === 'true') : true,
};

export default config;
