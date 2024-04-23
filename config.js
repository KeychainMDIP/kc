import dotenv from 'dotenv';

dotenv.config();

const config = {
    didPrefix: process.env.KC_DID_PREFIX || "did:mdip:test",
    gatekeeperPort: process.env.KC_GATEKEEPER_PORT || 4224,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost',
    gatekeeperDb: process.env.KC_GATEKEEPER_DB || 'json',
    nodeName: process.env.KC_NODE_NAME || 'anon',
    mongodbUrl: process.env.KC_MONGODB_URL || 'mongodb://localhost:27017',
    tessHost: process.env.KC_TESS_HOST,
    tessPort: process.env.KC_TESS_PORT,
    tessUser: process.env.KC_TESS_USER,
    tessPass: process.env.KC_TESS_PASS,
    tessStart: process.env.KC_TESS_START,
};

export default config;
