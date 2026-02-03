import pino, { type Logger, type LoggerOptions, type ChildLoggerOptions } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
export type LoggerLike = Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;

const DEFAULT_LEVEL: LogLevel = 'info';
const DEFAULT_PRETTY = true;
const LEVEL_ALIASES: Record<string, LogLevel> = {
    warning: 'warn',
};
const LEVELS = new Set<LogLevel>([
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent',
]);

export function createConsoleLogger(consoleLike: {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    log?: (...args: unknown[]) => void;
}): LoggerLike {
    const base = consoleLike.log?.bind(consoleLike);
    const wrap = (fn?: (...args: unknown[]) => void, fallback?: (...args: unknown[]) => void) => {
        if (fn) {
            return (...args: unknown[]) => fn(...args);
        }
        if (fallback) {
            return (...args: unknown[]) => fallback(...args);
        }
        return () => {};
    };

    return {
        debug: wrap(consoleLike.debug?.bind(consoleLike), base),
        info: wrap(consoleLike.info?.bind(consoleLike), base),
        warn: wrap(consoleLike.warn?.bind(consoleLike), base),
        error: wrap(consoleLike.error?.bind(consoleLike), base),
    };
}

function normalizeLevel(level?: string): LogLevel {
    if (!level) {
        return DEFAULT_LEVEL;
    }

    const normalized = level.toLowerCase();
    const alias = LEVEL_ALIASES[normalized];

    if (alias) {
        return alias;
    }

    if (LEVELS.has(normalized as LogLevel)) {
        return normalized as LogLevel;
    }

    return DEFAULT_LEVEL;
}

type Env = Record<string, string | undefined>;

export function getLogLevel(env: Env = process.env): LogLevel {
    return normalizeLevel(env.KC_LOG_LEVEL);
}

export function getPrettyEnabled(): boolean {
    return DEFAULT_PRETTY;
}

export function createLogger(
    options: LoggerOptions = {},
    env: Env = process.env,
): Logger {
    const resolvedLevel = options.level ?? getLogLevel(env);
    const transport = options.transport ?? {
        target: 'pino-pretty',
        options: {
            colorize: false,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname,service',
            singleLine: true,
        },
    };

    const loggerOptions: LoggerOptions = {
        ...options,
        level: resolvedLevel,
        transport,
    };

    return pino(loggerOptions);
}

export let logger = createLogger();

export function setLogger(next: Logger): void {
    logger = next;
}

export function childLogger(bindings: Record<string, unknown>, options?: ChildLoggerOptions): Logger {
    return logger.child(bindings, options);
}

export function asError(err: unknown): Error {
    if (err instanceof Error) {
        return err;
    }

    if (typeof err === 'string') {
        return new Error(err);
    }

    try {
        return new Error(JSON.stringify(err));
    } catch {
        return new Error(String(err));
    }
}

export function logError(err: unknown, msg?: string, log: Logger = logger): void {
    const error = asError(err);
    log.error({ err: error }, msg ?? error.message);
}
