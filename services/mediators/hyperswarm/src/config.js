import dotenv from 'dotenv';

dotenv.config();

function parsePositiveIntEnv(varName, defaultValue, options = {}) {
    const allowZero = options.allowZero === true;
    const raw = process.env[varName];
    if (raw == null || raw === '') {
        return defaultValue;
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0 || (!allowZero && value === 0)) {
        const expected = allowZero ? 'a non-negative integer' : 'a positive integer';
        throw new Error(`Invalid ${varName}; expected ${expected}`);
    }

    return value;
}

function parseFrameSizeLimit() {
    const value = parsePositiveIntEnv('KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT', 0, { allowZero: true });

    if (value > 0 && value < 4096) {
        throw new Error('KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT must be 0 or >= 4096');
    }

    return value;
}

function parseBooleanEnv(varName, defaultValue) {
    const raw = process.env[varName];
    if (raw == null || raw === '') {
        return defaultValue;
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') {
        return true;
    }

    if (normalized === 'false') {
        return false;
    }

    throw new Error(`Invalid ${varName}; expected true or false`);
}

const config = {
    debug: process.env.KC_DEBUG ? process.env.KC_DEBUG === 'true' : false,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    keymasterURL: process.env.KC_KEYMASTER_URL || 'http://localhost:4226',
    ipfsURL: process.env.KC_IPFS_URL || 'http://localhost:5001/api/v0',
    ipfsEnabled: process.env.KC_IPFS_ENABLE ? process.env.KC_IPFS_ENABLE.toLowerCase() !== 'false' : true,
    nodeID: process.env.KC_NODE_ID || '',
    nodeName: process.env.KC_NODE_NAME || 'anon',
    protocol: process.env.KC_MDIP_PROTOCOL || '/MDIP/v1.0-public',
    exportInterval: parsePositiveIntEnv('KC_HYPR_EXPORT_INTERVAL', 2),
    negentropyFrameSizeLimit: parseFrameSizeLimit(),
    negentropyRecentWindowDays: parsePositiveIntEnv('KC_HYPR_NEGENTROPY_RECENT_WINDOW_DAYS', 7),
    negentropyOlderWindowDays: parsePositiveIntEnv('KC_HYPR_NEGENTROPY_OLDER_WINDOW_DAYS', 30),
    negentropyMaxRecordsPerWindow: parsePositiveIntEnv('KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW', 25000),
    negentropyMaxRoundsPerSession: parsePositiveIntEnv('KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION', 64),
    negentropyRepairIntervalSeconds: parsePositiveIntEnv('KC_HYPR_NEGENTROPY_REPAIR_INTERVAL_SECONDS', 300),
    legacySyncEnabled: parseBooleanEnv('KC_HYPR_LEGACY_SYNC_ENABLE', true),
};

export default config;
