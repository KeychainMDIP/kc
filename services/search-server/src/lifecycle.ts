import type { LoggerLike } from '@mdip/common/logger';

export type Shutdown = (exitCode?: number) => Promise<void>;

interface ServiceLifecycleOptions {
    start: (shutdown: Shutdown) => Promise<void>;
    cleanup: () => Promise<void>;
    log: LoggerLike;
    timeoutMs: number;
}

export function runService({ start, cleanup, log, timeoutMs }: ServiceLifecycleOptions): Shutdown {
    let shutdownPromise: Promise<void> | null = null;
    let exitCode = 0;
    let exited = false;

    const exit = () => {
        if (!exited) {
            exited = true;
            process.exit(exitCode);
        }
    };

    const shutdown: Shutdown = (code = 0) => {
        exitCode = Math.max(exitCode, code);

        if (!shutdownPromise) {
            const timeout = setTimeout(() => {
                exitCode = Math.max(exitCode, 1);
                log.error(`Search Server shutdown exceeded ${timeoutMs}ms; forcing exit`);
                exit();
            }, timeoutMs);

            shutdownPromise = (async () => {
                try {
                    await cleanup();
                }
                catch (error) {
                    exitCode = Math.max(exitCode, 1);
                    log.error({ error }, 'Error during shutdown');
                }
                finally {
                    clearTimeout(timeout);
                    exit();
                }
            })();
        }

        return shutdownPromise;
    };

    process.on('SIGTERM', () => shutdown());
    process.on('SIGINT', () => shutdown());
    process.on('uncaughtException', error => {
        log.error({ error }, 'Unhandled exception caught');
        return shutdown(1);
    });
    process.on('unhandledRejection', (reason, promise) => {
        log.error({ reason, promise }, 'Unhandled rejection caught');
        return shutdown(1);
    });

    Promise.resolve()
        .then(() => start(shutdown))
        .catch(error => {
            log.error({ error }, '[search-server] Fatal error');
            return shutdown(1);
        });

    return shutdown;
}
