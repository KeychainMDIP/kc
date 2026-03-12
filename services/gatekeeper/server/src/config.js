import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_RATE_LIMIT_SKIP_PATHS = ['/api/v1/ready'];

function parseBoolean(value, defaultValue) {
    if (value === undefined) {
        return defaultValue;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
        return true;
    }

    if (normalized === 'false') {
        return false;
    }

    return defaultValue;
}

function parsePositiveInteger(value, defaultValue) {
    const parsed = Number.parseInt(value ?? '', 10);

    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }

    return defaultValue;
}

function parseWindowUnit(value) {
    const normalized = (value ?? '').trim().toLowerCase();

    if (normalized === 'second' || normalized === 'seconds') {
        return 'second';
    }

    if (normalized === 'hour' || normalized === 'hours') {
        return 'hour';
    }

    return 'minute';
}

function parseCsv(value) {
    if (!value) {
        return [];
    }

    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

const configuredSkipPaths = parseCsv(process.env.KC_GATEKEEPER_RATE_LIMIT_SKIP_PATHS);

const config = {
    port: process.env.KC_GATEKEEPER_PORT ? parseInt(process.env.KC_GATEKEEPER_PORT) : 4224,
    db: process.env.KC_GATEKEEPER_DB || 'redis',
    ipfsURL: process.env.KC_IPFS_URL || 'http://localhost:5001/api/v0',
    ipfsClusterURL: process.env.KC_IPFS_CLUSTER_URL,
    ipfsClusterAuthHeader: process.env.KC_IPFS_CLUSTER_AUTH_HEADER,
    ipfsEnabled: process.env.KC_IPFS_ENABLE ? process.env.KC_IPFS_ENABLE.toLowerCase() !== 'false' : true,
    didPrefix: process.env.KC_GATEKEEPER_DID_PREFIX || 'did:test',
    registries: process.env.KC_GATEKEEPER_REGISTRIES ? process.env.KC_GATEKEEPER_REGISTRIES.split(',') : undefined,
    jsonLimit: process.env.KC_GATEKEEPER_JSON_LIMIT || '4mb',
    maxOpBytes: process.env.KC_GATEKEEPER_MAX_OP_BYTES ? parseInt(process.env.KC_GATEKEEPER_MAX_OP_BYTES) : undefined,
    gcInterval: process.env.KC_GATEKEEPER_GC_INTERVAL ? parseInt(process.env.KC_GATEKEEPER_GC_INTERVAL) : 15,
    statusInterval: process.env.KC_GATEKEEPER_STATUS_INTERVAL ? parseInt(process.env.KC_GATEKEEPER_STATUS_INTERVAL) : 5,
    gatekeeperTrustProxy: parseBoolean(process.env.KC_GATEKEEPER_TRUST_PROXY, false),
    rateLimitEnabled: parseBoolean(process.env.KC_GATEKEEPER_RATE_LIMIT_ENABLED, false),
    rateLimitWindowValue: parsePositiveInteger(process.env.KC_GATEKEEPER_RATE_LIMIT_WINDOW_VALUE, 1),
    rateLimitWindowUnit: parseWindowUnit(process.env.KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT),
    rateLimitMaxRequests: parsePositiveInteger(process.env.KC_GATEKEEPER_RATE_LIMIT_MAX_REQUESTS, 600),
    rateLimitWhitelist: parseCsv(process.env.KC_GATEKEEPER_RATE_LIMIT_WHITELIST),
    rateLimitSkipPaths: configuredSkipPaths.length > 0 ? configuredSkipPaths : DEFAULT_RATE_LIMIT_SKIP_PATHS,
};

export default config;
