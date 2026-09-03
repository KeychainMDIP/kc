import { loadEnv } from "@mdip/common/env";

loadEnv();

const DEFAULT_RATE_LIMIT_SKIP_PATHS = ['/api/v1/ready', '/api/v1/status'];
export type SearchDb = 'sqlite' | 'postgres' | 'memory';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
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

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
    const parsed = Number.parseInt(value ?? '', 10);

    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }

    return defaultValue;
}

function parseWindowUnit(value: string | undefined): 'second' | 'minute' | 'hour' {
    const normalized = (value ?? '').trim().toLowerCase();

    if (normalized === 'second' || normalized === 'seconds') {
        return 'second';
    }

    if (normalized === 'hour' || normalized === 'hours') {
        return 'hour';
    }

    return 'minute';
}

function parseCsv(value: string | undefined): string[] {
    if (!value) {
        return [];
    }

    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

export function parseDidPrefix(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized) {
        return undefined;
    }
    if (/^did:[^:]+$/.test(normalized)) {
        return normalized;
    }
    throw new Error('KC_SEARCH_SERVER_DID_PREFIX must be a did:<method> prefix or empty');
}

export function parseSearchDb(value: string | undefined): SearchDb {
    const db = value || 'sqlite';

    if (db === 'sqlite' || db === 'postgres' || db === 'memory') {
        return db;
    }

    throw new Error(`Unsupported KC_SEARCH_SERVER_DB "${db}", expected sqlite, postgres, or memory`);
}

const configuredSkipPaths = parseCsv(process.env.KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS);

const config = {
    port: parsePositiveInteger(process.env.KC_SEARCH_SERVER_PORT, 4002),
    gatekeeperURL: process.env.KC_SEARCH_SERVER_GATEKEEPER_URL || 'http://localhost:4224',
    refreshIntervalMs: parsePositiveInteger(process.env.KC_SEARCH_SERVER_REFRESH_INTERVAL_MS, 5000),
    metricsRefreshIntervalMs: parsePositiveInteger(
        process.env.KC_SEARCH_SERVER_METRICS_REFRESH_INTERVAL_MS,
        60 * 60 * 1000
    ),
    didPrefix: parseDidPrefix(process.env.KC_SEARCH_SERVER_DID_PREFIX),
    db: parseSearchDb(process.env.KC_SEARCH_SERVER_DB),
    postgresURL: process.env.KC_SEARCH_SERVER_POSTGRES_URL
        || process.env.KC_POSTGRES_URL
        || 'postgresql://mdip:mdip@localhost:5432/mdip',
    trustProxy: parseBoolean(process.env.KC_SEARCH_SERVER_TRUST_PROXY, false),
    jsonLimit: '2mb',
    rateLimitEnabled: parseBoolean(process.env.KC_SEARCH_SERVER_RATE_LIMIT_ENABLED, false),
    rateLimitWindowValue: parsePositiveInteger(process.env.KC_SEARCH_SERVER_RATE_LIMIT_WINDOW_VALUE, 1),
    rateLimitWindowUnit: parseWindowUnit(process.env.KC_SEARCH_SERVER_RATE_LIMIT_WINDOW_UNIT),
    rateLimitMaxRequests: parsePositiveInteger(process.env.KC_SEARCH_SERVER_RATE_LIMIT_MAX_REQUESTS, 600),
    rateLimitWhitelist: parseCsv(process.env.KC_SEARCH_SERVER_RATE_LIMIT_WHITELIST),
    rateLimitSkipPaths: configuredSkipPaths.length > 0 ? configuredSkipPaths : DEFAULT_RATE_LIMIT_SKIP_PATHS,
};

export default config;
