import dotenv from 'dotenv';

dotenv.config();

const config = {
    debug: process.env.KC_DEBUG ? process.env.KC_DEBUG === 'true' : false,
    didPrefix: process.env.KC_DID_PREFIX || "did:test",
    gatekeeperPort: process.env.KC_GATEKEEPER_PORT ? parseInt(process.env.KC_GATEKEEPER_PORT) : 4224,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost',
    gatekeeperDb: process.env.KC_GATEKEEPER_DB || 'postgresql',
    keymasterPort: process.env.KC_KEYMASTER_PORT ? parseInt(process.env.KC_KEYMASTER_PORT) : 4226,
    nodeName: process.env.KC_NODE_NAME || 'anon',
    nodeID: process.env.KC_NODE_ID,
    mongodbUrl: process.env.KC_MONGODB_URL || 'mongodb://localhost:27017',
    postgresqlURL: process.env.KC_POSTGRESQL_URL || "postgres://postgres:postgres@postgres:5432/mdip",
    tessHost: process.env.KC_TESS_HOST || 'localhost',
    tessPort: process.env.KC_TESS_PORT ? parseInt(process.env.KC_TESS_PORT) : 8333,
    tessUser: process.env.KC_TESS_USER || 'tesseract',
    tessPass: process.env.KC_TESS_PASS || 'tesseract',
    btcHost: process.env.KC_BTC_HOST || 'localhost',
    btcPort: process.env.KC_BTC_PORT ? parseInt(process.env.KC_BTC_PORT) : 8332,
    btcWallet: process.env.KC_BTC_WALLET,
    btcUser: process.env.KC_BTC_USER,
    btcPass: process.env.KC_BTC_PASS,
    btcImportInterval: process.env.KC_BTC_IMPORT_INTERVAL ? parseInt(process.env.KC_BTC_IMPORT_INTERVAL) : 1,
    btcExportInterval: process.env.KC_BTC_EXPORT_INTERVAL ? parseInt(process.env.KC_BTC_EXPORT_INTERVAL) : 60,
    btcFeeMin: process.env.KC_BTC_FEE_MIN ? parseFloat(process.env.KC_BTC_FEE_MIN) : 0.00002,
    btcFeeMax: process.env.KC_BTC_FEE_MAX ? parseFloat(process.env.KC_BTC_FEE_MAX) : 0.00010,
    btcFeeInc: process.env.KC_BTC_FEE_INC ? parseFloat(process.env.KC_BTC_FEE_INC) : 0.00002,
};

export default config;
