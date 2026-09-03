import { loadEnv } from '@mdip/common/env';

loadEnv();

const DEFAULT_RATE_LIMIT_SKIP_PATHS = ['/api/v1/ready'];

function parseRequired(name, value, trim = false) {
    if (!value || !value.trim()) {
        throw new Error(`${name} is required`);
    }

    return trim ? value.trim() : value;
}

function parseDatabase(value) {
    const db = value || 'json';

    switch (db) {
    case 'redis':
    case 'json':
    case 'mongodb':
    case 'sqlite':
    case 'postgres':
        return db;
    default:
        throw new Error(`Invalid KC_KEYMASTER_DB "${db}", expected redis, json, mongodb, sqlite, or postgres`);
    }
}

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

function parseDidPrefix(value) {
    const normalized = value?.trim();

    if (!normalized) {
        return undefined;
    }

    if (/^did:[a-z0-9]+$/.test(normalized)) {
        return normalized;
    }

    throw new Error('KC_KEYMASTER_DID_PREFIX must be a did:<method> prefix using lowercase letters and digits, or empty');
}

const configuredSkipPaths = parseCsv(process.env.KC_KEYMASTER_RATE_LIMIT_SKIP_PATHS);

const config = {
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    searchURL: process.env.KC_SEARCH_URL || 'http://localhost:4002',
    disableSearch: process.env.KC_DISABLE_SEARCH ? process.env.KC_DISABLE_SEARCH === 'true' : false,
    keymasterPort: process.env.KC_KEYMASTER_PORT ? parseInt(process.env.KC_KEYMASTER_PORT) : 4226,
    nodeID: parseRequired('KC_NODE_ID', process.env.KC_NODE_ID, true),
    db: parseDatabase(process.env.KC_KEYMASTER_DB),
    keymasterPassphrase: parseRequired('KC_ENCRYPTED_PASSPHRASE', process.env.KC_ENCRYPTED_PASSPHRASE),
    walletCache: process.env.KC_WALLET_CACHE ? process.env.KC_WALLET_CACHE === 'true' : false,
    defaultRegistry: process.env.KC_DEFAULT_REGISTRY,
    didPrefix: parseDidPrefix(process.env.KC_KEYMASTER_DID_PREFIX),
    keymasterTrustProxy: parseBoolean(process.env.KC_KEYMASTER_TRUST_PROXY, false),
    rateLimitEnabled: parseBoolean(process.env.KC_KEYMASTER_RATE_LIMIT_ENABLED, false),
    rateLimitWindowValue: parsePositiveInteger(process.env.KC_KEYMASTER_RATE_LIMIT_WINDOW_VALUE, 1),
    rateLimitWindowUnit: parseWindowUnit(process.env.KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT),
    rateLimitMaxRequests: parsePositiveInteger(process.env.KC_KEYMASTER_RATE_LIMIT_MAX_REQUESTS, 600),
    rateLimitWhitelist: parseCsv(process.env.KC_KEYMASTER_RATE_LIMIT_WHITELIST),
    rateLimitSkipPaths: configuredSkipPaths.length > 0 ? configuredSkipPaths : DEFAULT_RATE_LIMIT_SKIP_PATHS,
};

export default config;
