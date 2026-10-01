import type { LoggerLike } from '@mdip/common/logger';

interface ServiceLifecycleOptions {
    start: () => Promise<void>;
    cleanup: () => Promise<void>;
    log: LoggerLike;
    timeoutMs: number;
}

export function isRetryableChainError(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;

    return code === -28
        || typeof code === 'number' && code >= 500 && code <= 599
        || typeof code === 'string' && [
            'ECONNREFUSED',
            'ECONNRESET',
            'EAI_AGAIN',
            'EHOSTUNREACH',
            'ENETUNREACH',
            'ENOTFOUND',
            'ESOCKETTIMEDOUT',
            'ETIMEDOUT',
        ].includes(code);
}

export function runService({ start, cleanup, log, timeoutMs }: ServiceLifecycleOptions): void {
    let stopping = false;
    let shutdownPromise: Promise<void> | null = null;
    let exitCode = 0;

    const shutdown = (code = 0): Promise<void> => {
        exitCode = Math.max(exitCode, code);

        if (!shutdownPromise) {
            stopping = true;
            const timeout = setTimeout(() => {
                log.error(`Mediator shutdown exceeded ${timeoutMs}ms; forcing exit`);
                process.exit(exitCode);
            }, timeoutMs);

            shutdownPromise = cleanup().finally(() => {
                clearTimeout(timeout);
                process.exit(exitCode);
            });
        }

        return shutdownPromise;
    };

    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
    process.on('uncaughtException', (error) => {
        log.error({ error }, 'Unhandled exception caught');
        void shutdown(1);
    });
    process.on('unhandledRejection', (reason, promise) => {
        log.error({ reason, promise }, 'Unhandled rejection caught');
        void shutdown(1);
    });

    start().catch((error) => {
        if (stopping) {
            return;
        }
        log.error({ error }, 'Fatal mediator startup error');
        void shutdown(1);
    });
}
