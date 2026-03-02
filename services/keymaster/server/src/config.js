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

const configuredSkipPaths = parseCsv(process.env.KC_KEYMASTER_RATE_LIMIT_SKIP_PATHS);

const config = {
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    searchURL: process.env.KC_SEARCH_URL || 'http://localhost:4002',
    disableSearch: process.env.KC_DISABLE_SEARCH ? process.env.KC_DISABLE_SEARCH === 'true' : false,
    keymasterPort: process.env.KC_KEYMASTER_PORT ? parseInt(process.env.KC_KEYMASTER_PORT) : 4226,
    nodeID: process.env.KC_NODE_ID || '',
    db: process.env.KC_KEYMASTER_DB || 'json',
    keymasterPassphrase: process.env.KC_ENCRYPTED_PASSPHRASE || '',
    walletCache: process.env.KC_WALLET_CACHE ? process.env.KC_WALLET_CACHE === 'true' : false,
    defaultRegistry: process.env.KC_DEFAULT_REGISTRY,
    keymasterTrustProxy: parseBoolean(process.env.KC_KEYMASTER_TRUST_PROXY, false),
    rateLimitEnabled: parseBoolean(process.env.KC_KEYMASTER_RATE_LIMIT_ENABLED, false),
    rateLimitWindowValue: parsePositiveInteger(process.env.KC_KEYMASTER_RATE_LIMIT_WINDOW_VALUE, 1),
    rateLimitWindowUnit: parseWindowUnit(process.env.KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT),
    rateLimitMaxRequests: parsePositiveInteger(process.env.KC_KEYMASTER_RATE_LIMIT_MAX_REQUESTS, 600),
    rateLimitWhitelist: parseCsv(process.env.KC_KEYMASTER_RATE_LIMIT_WHITELIST),
    rateLimitSkipPaths: configuredSkipPaths.length > 0 ? configuredSkipPaths : DEFAULT_RATE_LIMIT_SKIP_PATHS,
};

export default config;
