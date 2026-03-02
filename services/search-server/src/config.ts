import dotenv from "dotenv";

dotenv.config();

const DEFAULT_RATE_LIMIT_SKIP_PATHS = ['/api/v1/ready'];

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

const configuredSkipPaths = parseCsv(process.env.SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS);

const config = {
    port: parsePositiveInteger(process.env.SEARCH_SERVER_PORT, 4002),
    gatekeeperURL: process.env.SEARCH_SERVER_GATEKEEPER_URL || 'http://localhost:4224',
    refreshIntervalMs: parsePositiveInteger(process.env.SEARCH_SERVER_REFRESH_INTERVAL_MS, 5000),
    db: process.env.SEARCH_SERVER_DB || 'sqlite',
    trustProxy: parseBoolean(process.env.SEARCH_SERVER_TRUST_PROXY, false),
    jsonLimit: '2mb',
    rateLimitEnabled: parseBoolean(process.env.SEARCH_SERVER_RATE_LIMIT_ENABLED, false),
    rateLimitWindowValue: parsePositiveInteger(process.env.SEARCH_SERVER_RATE_LIMIT_WINDOW_VALUE, 1),
    rateLimitWindowUnit: parseWindowUnit(process.env.SEARCH_SERVER_RATE_LIMIT_WINDOW_UNIT),
    rateLimitMaxRequests: parsePositiveInteger(process.env.SEARCH_SERVER_RATE_LIMIT_MAX_REQUESTS, 600),
    rateLimitWhitelist: parseCsv(process.env.SEARCH_SERVER_RATE_LIMIT_WHITELIST),
    rateLimitSkipPaths: configuredSkipPaths.length > 0 ? configuredSkipPaths : DEFAULT_RATE_LIMIT_SKIP_PATHS,
};

export default config;
